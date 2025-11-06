import { parseISO, isValid, subMonths, isAfter } from 'date-fns';
import { CORRIDOR_SET, VERY_HIGH_RISK, INCREASED_MONITORING, RISK_SOURCES } from './countryRisk.js';
import { monthsBetween } from './utils.js';

/**
 * Explainable, rules-first scoring with caps by family.
 * Bands: High ≥30, Medium ≥15, else Low.
 */
export function scoreAllClients(clients, txs) {
  // Determine lookback end: latest tx date or today
  const latestDate = txs.reduce((acc, t) => {
    const d = parseISO(t.date);
    return (isValid(d) && (!acc || isAfter(d, acc))) ? d : acc;
  }, null);
  const lookbackEnd = latestDate || new Date();
  const lookbackStart = subMonths(lookbackEnd, 18);

  // Group tx by client
  const byClient = new Map();
  for (const t of txs) {
    if (!byClient.has(t.client_id)) byClient.set(t.client_id, []);
    byClient.get(t.client_id).push(t);
  }

  // Build a header mapping + rejects (from normalize)
  const headerMap = txs.__headerMap || {};
  const rejects = txs.__rejects || [];

  const clientScores = clients.map(c => {
    const cid = c.client_id || c.id || c.customer_id || 'unknown';
    const myTx = (byClient.get(cid) || []).filter(t => {
      const d = parseISO(t.date);
      return isValid(d) && d >= lookbackStart && d <= lookbackEnd;
    });

    const reasons = [];
    const family = { profile: 0, behavior: 0, corridor: 0 };

    // PROFILE SIGNALS
    if (truthy(c.pep_flag)) {
      reasons.push(reason('PEP flag present', 30, 'profile'));
      family.profile += 30;
    }
    if (truthy(c.sanctions_flag)) {
      reasons.push(reason('Sanctions flag present (DFAT/Consolidated)', 30, 'profile'));
      family.profile += 30;
    }
    // Stale KYC (12+ months)
    if (c.kyc_last_reviewed_at) {
      const months = monthsBetween(c.kyc_last_reviewed_at, lookbackEnd.toISOString().slice(0,10));
      if (months != null && months >= 12) {
        reasons.push(reason(`KYC last reviewed ${months} months ago (≥12)`, 10, 'profile'));
        family.profile += 10;
      }
    }
    // Services risk
    if ((c.services || '').toString().toLowerCase().match(/remittance|property|real ?estate/)) {
      reasons.push(reason('Higher-risk services (remittance/property)', 8, 'profile'));
      family.profile += 8;
    }
    // Non-resident
    const resCtry = (c.residency_country || '').toString().trim().toUpperCase();
    if (resCtry && resCtry !== 'AU') {
      reasons.push(reason(`Non-resident (${resCtry})`, 6, 'profile'));
      family.profile += 6;
    }

    // BEHAVIOURAL SIGNALS
    // Structuring: ≥4 cash deposits between 9600–9999 in a 7-day window
    const cashIn = myTx.filter(t => t.direction === 'in' && t.method === 'cash' && t.amount >= 9600 && t.amount <= 9999);
    const structuring = hasNInWindow(cashIn, 4, 7);
    if (structuring) {
      reasons.push(reason('Structuring: ≥4 cash deposits A$9,600–9,999 within 7 days', 25, 'behavior'));
      family.behavior += 25;
    }

    // Large domestic transfers ≥100k (out)
    const largeDomestic = myTx.some(t => t.direction === 'out' && t.amount >= 100000 && (!t.counterparty_country || t.counterparty_country === 'AU'));
    if (largeDomestic) {
      reasons.push(reason('Large domestic transfer ≥ A$100k', 15, 'behavior'));
      family.behavior += 15;
    }

    // CORRIDOR SIGNALS
    // ≥2 international transfers to RU/CN/HK/AE/IN/IR with at least one ≥20k
    const corridorTx = myTx.filter(t => t.direction === 'out' && CORRIDOR_SET.includes(t.counterparty_country));
    const corridorCount = corridorTx.length;
    const corridorBig = corridorTx.some(t => t.amount >= 20000);
    if (corridorCount >= 2 && corridorBig) {
      reasons.push(reason(`High-risk corridor: ${corridorCount} transfers to ${uniqueCountries(corridorTx)} (≥1 ≥ A$20k)`, 20, 'corridor'));
      family.corridor += 20;
    }

    // COUNTRY LIST CONTEXT (non-scoring, append context)
    // If any corridor country is FATF call-for-action / grey list, append note
    const corridorSet = new Set(corridorTx.map(t => t.counterparty_country));
    for (const cc of corridorSet) {
      if (VERY_HIGH_RISK.includes(cc)) {
        reasons.push(context(`Destination ${cc} on FATF call-for-action (as-at ${RISK_SOURCES.fatf_call_for_action_as_at})`));
      } else if (INCREASED_MONITORING.includes(cc)) {
        reasons.push(context(`Destination ${cc} on FATF increased monitoring (as-at ${RISK_SOURCES.fatf_grey_list_as_at})`));
      }
    }

    // CAPS BY FAMILY
    const caps = { profile: 20, behavior: 25, corridor: 20 };
    const total = Math.min(family.profile, caps.profile)
                + Math.min(family.behavior, caps.behavior)
                + Math.min(family.corridor, caps.corridor);

    const band = total >= 30 ? 'High' : total >= 15 ? 'Medium' : 'Low';

    return {
      client_id: cid,
      score: total,
      band,
      reasons
    };
  });

  const cases = buildCases(byClientMap(txs), lookbackStart, lookbackEnd);

  return {
    clientScores,
    cases,
    meta: {
      ruleset: {
        id: 'dnfbp-2025.11-starter',
        lookback_months: 18,
        bands: { High: '≥30', Medium: '≥15', Low: '<15' },
        caps: { profile: 20, behavior: 25, corridor: 20 },
        sources: RISK_SOURCES
      },
      headerMap: txs.__headerMap || {},
      rejects: txs.__rejects || []
    }
  };
}

function reason(text, points, family) {
  return { type: 'reason', family, points, text };
}
function context(text) {
  return { type: 'context', text };
}

function byClientMap(txs) {
  const m = new Map();
  for (const t of txs) {
    if (!m.has(t.client_id)) m.set(t.client_id, []);
    m.get(t.client_id).push(t);
  }
  return m;
}

function hasNInWindow(txList, required, windowDays) {
  if (txList.length < required) return false;
  const dates = txList.map(t => parseISO(t.date)).filter(isValid).sort((a,b)=>a-b);
  if (!dates.length) return false;
  for (let i=0; i<=dates.length - required; i++) {
    const start = dates[i];
    const end = dates[i + required - 1];
    const diff = (end - start) / (24*3600*1000);
    if (diff <= windowDays - 0.0001) return true;
  }
  return false;
}

function uniqueCountries(tx) {
  return [...new Set(tx.map(t => t.counterparty_country))].join(',');
}

function buildCases(byClient, from, to) {
  const cases = [];
  for (const [cid, list] of byClient.entries()) {
    const txs = list.filter(t => {
      const d = parseISO(t.date);
      return isValid(d) && d >= from && d <= to;
    });
    // Structuring case
    const cashIn = txs.filter(t => t.direction === 'in' && t.method === 'cash' && t.amount >= 9600 && t.amount <= 9999);
    if (hasNInWindow(cashIn, 4, 7)) {
      cases.push({
        type: 'structuring',
        client_id: cid,
        rule: '≥4 cash deposits A$9,600–9,999 within 7 days',
        tx_count: cashIn.length,
        window_days: 7,
        sample_tx_ids: cashIn.slice(0,5).map(t => t.tx_id || null)
      });
    }
    // High-risk corridors case
    const corridorTx = txs.filter(t => t.direction === 'out' && CORRIDOR_SET.includes(t.counterparty_country));
    if (corridorTx.length >= 2 && corridorTx.some(t => t.amount >= 20000)) {
      cases.push({
        type: 'corridor',
        client_id: cid,
        rule: '≥2 transfers to RU/CN/HK/AE/IN/IR with ≥1 ≥ A$20k',
        tx_count: corridorTx.length,
        countries: uniqueCountries(corridorTx),
        sample_tx_ids: corridorTx.slice(0,5).map(t => t.tx_id || null)
      });
    }
    // Large domestic case
    const largeOut = txs.filter(t => t.direction === 'out' && t.amount >= 100000 && (!t.counterparty_country || t.counterparty_country === 'AU'));
    if (largeOut.length) {
      cases.push({
        type: 'large_domestic',
        client_id: cid,
        rule: 'Domestic transfer ≥ A$100k',
        tx_count: largeOut.length,
        sample_tx_ids: largeOut.slice(0,5).map(t => t.tx_id || null)
      });
    }
  }
  return cases;
}

function truthy(v) {
  const s = (v ?? '').toString().trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}
