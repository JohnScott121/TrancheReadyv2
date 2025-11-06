import { parseISO, isValid } from 'date-fns';
import { CORRIDOR_SET } from './countryRisk.js';

export function buildCases(txs, lookback) {
  const from = parseISO(lookback.start);
  const to = parseISO(lookback.end);
  const byClient = new Map();
  for (const t of txs) {
    const d = parseISO(t.date);
    if (!isValid(d) || d < from || d > to) continue;
    if (!byClient.has(t.client_id)) byClient.set(t.client_id, []);
    byClient.get(t.client_id).push(t);
  }

  const cases = [];
  for (const [cid, list] of byClient.entries()) {
    const cashIn = list.filter(t => t.direction === 'in' && t.method === 'cash' && t.amount >= 9600 && t.amount <= 9999)
                       .sort((a,b)=>a.date.localeCompare(b.date));
    if (hasNInWindow(cashIn, 4, 7)) {
      cases.push({
        type: 'structuring',
        client_id: cid,
        rule: '≥4 cash deposits A$9,600–9,999 within 7 days',
        samples: cashIn.slice(0,5).map(t => pickTx(t))
      });
    }
    const corridor = list.filter(t => t.direction === 'out' && CORRIDOR_SET.includes(t.counterparty_country));
    if (corridor.length >= 2 && corridor.some(t => t.amount >= 20000)) {
      cases.push({
        type: 'corridor',
        client_id: cid,
        rule: '≥2 transfers to RU/CN/HK/AE/IN/IR with ≥1 ≥ A$20k',
        countries: [...new Set(corridor.map(t=>t.counterparty_country))],
        samples: corridor.slice(0,5).map(t => pickTx(t))
      });
    }
    const large = list.filter(t => t.direction === 'out' && t.amount >= 100000 && (!t.counterparty_country || t.counterparty_country === 'AU'));
    if (large.length) {
      cases.push({
        type: 'large_domestic',
        client_id: cid,
        rule: 'Domestic transfer ≥ A$100k',
        samples: large.slice(0,5).map(t => pickTx(t))
      });
    }
  }
  return cases;
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
function pickTx(t){ return { tx_id: t.tx_id ?? null, date: t.date, amount: t.amount, currency: t.currency, method: t.method, counterparty_country: t.counterparty_country }; }
