import { parseISO, isValid } from 'date-fns';

const CLIENT_SYNONYMS = {
  client_id: ['clientid','client_id','clientid','customer_id','customerid','id'],
  full_name: ['full_name','name','client_name','fullname'],
  dob: ['dob','date_of_birth','birthdate'],
  residency_country: ['residency_country','country','country_of_residence','residence_country'],
  pep_flag: ['pep','pep_flag','is_pep'],
  sanctions_flag: ['sanctions','sanctions_flag','is_sanctioned'],
  kyc_last_reviewed_at: ['kyc_last_reviewed_at','kyc_date','kyc_last_reviewed','last_kyc'],
  services: ['services','service','products']
};

const TX_SYNONYMS = {
  tx_id: ['tx_id','transaction_id','id'],
  client_id: ['client_id','clientid','customer_id'],
  date: ['date','tx_date','timestamp','posted_at'],
  amount: ['amount','amt','value'],
  currency: ['currency','ccy'],
  direction: ['direction','dr_cr','in_out','flow'], // e.g., in/out
  method: ['method','instrument','channel'],       // cash, wire, eft, cheque, mo
  counterparty_name: ['counterparty_name','payer_name','payee_name','beneficiary'],
  counterparty_country: ['counterparty_country','cp_country','country_to','country_from','destination_country','origin_country'],
  matter_id: ['matter_id','file_id','case_id','engagement_id']
};

const CASH_KEYWORDS = ['cash','notes','cash_deposit','branch_cash'];
const OUT_KEYWORDS = ['out','debit','send'];
const IN_KEYWORDS = ['in','credit','receive'];

export function normalizeHeaders(rows) {
  if (!rows.length) return rows;
  const header = Object.keys(rows[0]);
  const map = {};
  const lower = (s) => (s || '').toString().trim().toLowerCase();

  function pick(synMap, key) {
    const target = lower(key);
    for (const canonical in synMap) {
      const synonyms = synMap[canonical];
      if (synonyms.includes(target)) return canonical;
    }
    return null;
  }

  const newRows = rows.map(r => {
    const out = {};
    for (const k of Object.keys(r)) {
      const lk = lower(k);
      const v = r[k];
      const c1 = pick(CLIENT_SYNONYMS, lk);
      const c2 = pick(TX_SYNONYMS, lk);
      const canonical = c1 || c2 || lk;
      if (out[canonical] === undefined) out[canonical] = v;
    }
    return out;
  });

  // attach __headerMap for audit
  const first = rows[0];
  const headerMap = {};
  for (const k of Object.keys(first)) {
    const lk = lower(k);
    headerMap[k] = pick(CLIENT_SYNONYMS, lk) || pick(TX_SYNONYMS, lk) || lk;
  }
  newRows.__headerMap = headerMap;

  return newRows;
}

export function coerceTransactions(rows) {
  // pull out headerMap if attached
  const headerMap = rows.__headerMap; delete rows.__headerMap;

  const rejects = [];
  const clean = rows.map((t, i) => {
    const out = { ...t };

    // date
    let d = typeof t.date === 'string' ? parseISO(t.date) : null;
    if (!d || !isValid(d)) d = null;
    out.date = d ? d.toISOString().slice(0,10) : null;

    // amount
    let amt = typeof t.amount === 'string' ? Number(t.amount.replace(/[^0-9.-]/g, '')) : Number(t.amount);
    if (!Number.isFinite(amt)) amt = null;
    out.amount = amt;

    // currency
    out.currency = (t.currency || 'AUD').toString().trim().toUpperCase();

    // direction
    const dirRaw = (t.direction || '').toString().toLowerCase();
    out.direction = OUT_KEYWORDS.some(k => dirRaw.includes(k)) ? 'out'
                   : IN_KEYWORDS.some(k => dirRaw.includes(k)) ? 'in'
                   : (dirRaw === 'in' || dirRaw === 'out') ? dirRaw
                   : null;

    // method
    const mRaw = (t.method || '').toString().toLowerCase();
    if (CASH_KEYWORDS.some(k => mRaw.includes(k))) out.method = 'cash';
    else if (mRaw.includes('wire') || mRaw.includes('swift') || mRaw.includes('intl')) out.method = 'wire';
    else if (mRaw.includes('eft') || mRaw.includes('ach') || mRaw.includes('transfer')) out.method = 'eft';
    else if (mRaw.includes('cheque') || mRaw.includes('check')) out.method = 'cheque';
    else if (mRaw.includes('mo') || mRaw.includes('money order')) out.method = 'money_order';
    else out.method = mRaw || null;

    // country
    out.counterparty_country = (t.counterparty_country || '').toString().trim().toUpperCase();

    // basic validation
    if (!out.client_id || !out.date || !Number.isFinite(out.amount)) {
      rejects.push({ index: i, reason: 'Missing client_id/date/amount', row: t });
      return null;
    }
    return out;
  }).filter(Boolean);

  clean.__headerMap = headerMap;
  clean.__rejects = rejects;
  return clean;
}
