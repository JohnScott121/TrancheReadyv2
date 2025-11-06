// Timestamped context so auditors see when lists were last reviewed.
export const RISK_SOURCES = {
  fatf_call_for_action_as_at: "2025-10-24",
  fatf_grey_list_as_at: "2025-06-13",
  au_tranche2_context_as_at: "2025-10-20"
};

// FATF call-for-action (very high risk) — sample set
export const VERY_HIGH_RISK = ['IR', 'KP', 'RU'];

// Increased monitoring (grey list) — sample subset for demo
export const INCREASED_MONITORING = ['AE','TR','MY','PH','BG','MA'];

// Corridor rule per your brief
export const CORRIDOR_SET = ['RU','CN','HK','AE','IN','IR'];
