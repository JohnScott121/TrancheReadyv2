// Keep these small & editable (timestamp your real lists at runtime).
export const RISK_SOURCES = {
  fatf_call_for_action_as_at: "2025-10-24",
  fatf_grey_list_as_at: "2025-06-13",
  au_tranche2_context_as_at: "2025-10-20"
};

// Very-high (example): countries subject to FATF call-for-action
export const VERY_HIGH_RISK = ['IR', 'KP', 'RU']; // Iran, North Korea, Russia

// Increased monitoring (“grey”): sample; keep timestamped
export const INCREASED_MONITORING = ['AE','TR','MY','PH','BG','MA']; // examples

// Your corridor rule (per brief) emphasises RU/CN/HK/AE/IN/IR
export const CORRIDOR_SET = ['RU','CN','HK','AE','IN','IR'];
