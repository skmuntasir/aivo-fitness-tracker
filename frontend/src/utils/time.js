// Server timestamps are UTC. Older rows were serialised WITHOUT a "Z", which browsers
// parse as *local* time (=> times shifted by the user's UTC offset). Normalise here.
export const userTimeZone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

export function parseServerDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  let s = String(ts);
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const formatClock = (ts) =>
  parseServerDate(ts)?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) ?? '';

export const formatDateTime = (ts) =>
  parseServerDate(ts)?.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) ?? '';

// YYYY-MM-DD in the user's LOCAL timezone (toISOString() is UTC and shifts the day).
export const localDateKey = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// "Active 5m ago" style text for presence. Returns '' when we have no timestamp.
export const lastSeenText = (ts) => {
  const d = parseServerDate(ts);
  if (!d) return '';
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'Last seen just now';
  if (s < 3600) return `Last seen ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `Last seen ${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `Last seen ${Math.floor(s / 86400)}d ago`;
  return `Last seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
};
