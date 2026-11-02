// Remembers the last Streak-freeze and Friend-challenge data per user (localStorage + memory) so Home paints them
// instantly and "intact" on every refresh, then quietly updates them in the background.
const uid = () => {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.id || u._id || 'anon'; } catch { return 'anon'; }
};
const mem = new Map();
const k = (name) => `engage:${name}:v1:${uid()}`;

export const readEngage = (name) => {
  const key = k(name);
  if (mem.has(key)) return mem.get(key);
  try { const v = JSON.parse(localStorage.getItem(key)); if (v && typeof v === 'object') { mem.set(key, v); return v; } } catch {}
  return null;
};
export const writeEngage = (name, value) => {
  const v = { ...value, savedAt: Date.now() };
  mem.set(k(name), v);
  try { localStorage.setItem(k(name), JSON.stringify(v)); } catch {}
};
if (typeof window !== 'undefined') {
  window.addEventListener('logout', () => {
    mem.clear();
    try { Object.keys(localStorage).filter((x) => x.startsWith('engage:')).forEach((x) => localStorage.removeItem(x)); } catch {}
  });
}
