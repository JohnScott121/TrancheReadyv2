// Minimal placeholder rules to keep the starter working.
// Replace with your full rules engine.
export function runRules(clients, txs){
  const scores = clients.map(c => ({
    client_id: c.client_id || c.ClientID || c.customer_id || 'unknown',
    score: 10,
    band: 'Low',
    reasons: ['Starter rules applied. Replace with full engine.']
  }));
  const cases = [];
  return { scores, cases };
}
