// Activity colour steps - ONE definition shared by the streak heatmap, the week dots and the workout timer.
// Value = total seconds trained that day (heatmap) or in the running session (timer).
//   1-2 min -> deep | 2-3 min -> royal | 3-5 min -> electric | 5-8 min -> neon | 8+ min -> glowing ultraviolet
// (a session under 1 min isn't logged, so it just shows the first step while the timer runs)
export const HEAT_STEPS = [
  { key: 'l1', upTo: 120,      name: 'Deep purple',       range: '1–2 min',        color: '#51249b', bright: '#7a47d9' },
  { key: 'l2', upTo: 180,      name: 'Royal purple',      range: '2–3 min',        color: '#7135c9', bright: '#9158ee' },
  { key: 'l3', upTo: 300,      name: 'Electric purple',   range: '3–5 min',        color: '#8a4cf0', bright: '#a975ff' },
  { key: 'l4', upTo: 480,      name: 'Neon purple',       range: '5–8 min',        color: '#985bff', bright: '#c39aff' },
  { key: 'l5', upTo: Infinity, name: 'Glowing ultraviolet', range: '8 min or more', color: '#b98cff', bright: '#e4d0ff' },
];

// 'l0' = nothing trained, 'l1'..'l5' = the steps above
export const heatLevel = (seconds) => {
  if (!(seconds > 0)) return 'l0';
  return (HEAT_STEPS.find((s) => seconds < s.upTo) || HEAT_STEPS[HEAT_STEPS.length - 1]).key;
};

export const heatStep = (seconds) => HEAT_STEPS.find((s) => s.key === heatLevel(seconds)) || null;
