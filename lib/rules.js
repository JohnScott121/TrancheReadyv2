import { parseISO, isValid } from 'date-fns';
import { CORRIDOR_SET, RISK_SOURCES, VERY_HIGH_RISK, INCREASED_MONITORING } from './countryRisk.js';
import { monthsBetween } from './utils.js';

/**
 * Rules-first explainable scoring.
 * Bands: High ≥30, Medium ≥15, else Low.
 * Family caps: profile 20, behavior 25, corridor 20.
 */
export async function scoreAll(clients, txs, lookback, openaiApiKey) {
  // group tx by client and filter to lookback window
  const from = parseISO(lookback.start);
  const to = parseISO(lookback.end);
  const byClient = new Map();
  for (const t of txs) {
    const d = parseISO(t.date);
    if (!isValid(d) || d < from || d > to) continue;
    if (!byClient.has(t.client_id)) byClient.set(t.client_id, []);
    byClient.get(t.client_id).push(t);
  }

  const scores = [];
  for (const c of clients) {
    const cid = c.client_id || c.id || c.customer_id || 'unknown';
    const my = byClient.get(cid) || [];

    const reasons = [];
    const fam = { profile: 0, behavior: 0, corridor: 0 };

    // PROFILE
    if (truthy(c.pep_flag)) { addReason('PEP flag present', 30, 'profile'); }
    if (truthy(c.sanctions_flag)) { addReason('Sanctions flag present (DFAT/Consolidated)', 30, 'profile'); }

    const kycMonths = c.kyc_last_reviewed_at ? monthsBetween(c.kyc_last_reviewed_at, lookback.end) : null;
    if (kycMonths != null && kycMonths >= 12) addReason(`KYC last reviewed ${kycMonths} months ago (≥12)`, 10, 'profile');

    if ((c.services || '').toString().toLowerCase().match(/remittance|property|real ?estate/)) {
      addReason('Higher-risk services (remittance/property)', 8, 'profile');
    }
    const resCtry = (c.residency_country || '').toString().trim().toUpperCase();
    if (resCtry && resCtry !== 'AU') addReason(`Non-resident (${resCtry})`, 6, 'profile');

    // BEHAVIOUR
    const cashIn = my.filter(t => t.direction === 'in' && t.method === 'cash' && t.amount >= 9600 && t.amount <= 9999);
    if (hasNInWindow(cashIn, 4, 7)) addReason('Structuring: ≥4 cash deposits A$9,600–9,999 within 7 days', 25, 'behavior');

    const largeDomestic = my.some(t => t.direction === 'out' && t.amount >= 100000 && (!t.counterparty_country || t.counterparty_country === 'AU'));
    if (largeDomestic) addReason('Large domestic transfer ≥ A$100k', 15, 'behavior');

    // CORRIDOR
    const corridorTx = my.filter(t => t.direction === 'out' && CORRIDOR_SET.includes(t.counterparty_country));
    if (corridorTx.length >= 2 && corridorTx.some(t => t.amount >= 20000)) {
      const countries = [...new Set(corridorTx.map(t => t.counterparty_country))].join(',');
      addReason(`High-risk corridor: ${corridorTx.length} transfers to ${countries} (≥1 ≥ A$20k)`, 20, 'corridor');
    }

    // Context notes (non-scoring)
    const corrSet = new Set(corridorTx.map(t => t.counterparty_country));
    for (const cc of corrSet) {
      if (VERY_HIGH_RISK.includes(cc)) reasons.push(context(`Destination ${cc} on FATF call-for-action (as-at ${RISK_SOURCES.fatf_call_for_action_as_at})`));
      else if (INCREASED_MONITORING.includes(cc)) reasons.push(context(`Destination ${cc} on FATF increased monitoring (as-at ${RISK_SOURCES.fatf_grey_list_as_at})`));
    }

    // Caps & band
    const caps = { profile: 20, behavior: 25, corridor: 20 };
    const total = Math.min(fam.profile, caps.profile) + Math.min(fam.behavior, caps.behavior) + Math.min(fam.corridor, caps.corridor);
    const band = total >= 30 ? 'High' : total >= 15 ? 'Medium' : 'Low';

    // Optional super-short AI narrative (never required)
    let narrative = null;
    if (openaiApiKey) {
      try {
        const { default: OpenAI } = await import('openai');
        const openai = new OpenAI({ apiKey: openaiApiKey });
        const prompt = `Write a single sentence (<=35 words) compliance summary for a client risk band and reasons.
Band: ${band}. Reasons: ${reasons.filter(r=>r.type==='reason').map(r=>r.text).join(' | ')}. No advice, just summary.`;
        const resp = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 80
        });
        narrative = resp.choices?.[0]?.message?.content?.trim() || null;
      } catch { /* ignore AI errors entirely */ }
    }

    scores.push({ client_id: cid, score: total, band, reasons, ...(narrative ? { narrative } : {}) });

    function addReason(text, points, family) { reasons.push(reason(text, points, family)); fam[family] += points; }
  }

  const rulesMeta = {
    id: 'dnfbp-2025.11',
    lookback_months: 18,
    bands: { High: '≥30', Medium: '≥15', Low: '<15' },
    caps: { profile: 20, behavior: 25, corridor: 20 },
    corridor_countries: CORRIDOR_SET,
    sources: RISK_SOURCES
  };

  return { scores, rulesMeta };
}

function hasNInWindow(txList, required, windowDays) {
  if (txList.length < required) return false;
  const dates = txList.map(t => parseISO(t.date)).filter(isValid).sort((a,b)=>a-b);
  for (let i=0; i<=dates.length - required; i++) {
    const spanDays = (dates[i + required - 1] - dates[i]) / (24*3600*1000);
    if (spanDays <= windowDays - 1e-9) return true;
  }
  return false;
}

function reason(text, points, family) {
  return { type: 'reason', family, points, text };
}
function context(text) {
  return { type: 'context', text };
}
function truthy(v) {
  const s = (v ?? '').toString().trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}
