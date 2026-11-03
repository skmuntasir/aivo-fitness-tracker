// Stale-while-revalidate for the admin console (same idea as the member app's dataCache.js).
//  - Every admin GET is remembered (memory + sessionStorage, so it also survives a reload of the tab).
//  - useFetch (ui.jsx) shows the remembered answer instantly and refreshes it quietly, so pages never open on a spinner
//    after the first visit. Identical requests running at the same time share one network call.
//  - warmAdmin() fetches the main pages' data while the console is idle, so even the first visit is usually instant.
//  - Private to the signed-in admin session; wiped on sign-in, sign-out and session expiry. Works the same for the demo admin.

const PREFIX = 'adm:v1:';
const mem = new Map();        // key -> { data, t }
const inflight = new Map();   // key -> Promise
let probing = false;          // true while useFetch "peeks" at what a request would return

const scope = () => (localStorage.getItem('admin_token') || '').slice(-14) || 'none';
const stable = (v) => {
  if (v == null || v === '') return undefined;
  if (Array.isArray(v)) return v.map(stable);
  if (typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach((k) => { const x = stable(v[k]); if (x !== undefined) out[k] = x; });
    return out;
  }
  return v;
};
export const requestKey = (url, params) => `${scope()}|${url}|${JSON.stringify(stable(params) || {})}`;

const read = (key) => {
  if (mem.has(key)) return mem.get(key);
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw) { const e = JSON.parse(raw); mem.set(key, e); return e; }
  } catch { /* unreadable entry: ignore */ }
  return null;
};
const write = (key, data) => {
  const entry = { data, t: Date.now() };
  mem.set(key, entry);
  try {
    const s = JSON.stringify(entry);
    if (s.length < 400000) sessionStorage.setItem(PREFIX + key, s);
  } catch { /* storage full: the memory copy still works */ }
};

export function clearAdminCache() {
  mem.clear(); inflight.clear();
  try { Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => sessionStorage.removeItem(k)); } catch { /* ignore */ }
}

// A tiny synchronous "promise": lets useFetch run the page's own `.then((r) => r.data...)` on remembered data
// without waiting a tick, so the first paint already has the numbers.
const syncThen = (value, active) => ({ then: (cb) => (active && cb ? syncThen(cb(value), true) : syncThen(undefined, false)), catch: () => syncThen(value, active) });

// Wraps `ADMIN.get` (see adminApi.js). Normal calls: shared request + remember the answer.
export function cachedGet(rawGet, url, config) {
  if (config?.responseType) return rawGet(url, config);              // file downloads are never remembered
  const key = requestKey(url, config?.params);
  if (probing) {
    probing.key = key;
    const hit = read(key);
    probing.hit = !!hit;
    return syncThen(hit ? { data: hit.data } : undefined, !!hit);
  }
  const hit = config?.maxAge ? read(key) : null;
  if (hit && Date.now() - hit.t < config.maxAge) return Promise.resolve({ data: hit.data });
  if (inflight.has(key)) return inflight.get(key);
  const p = rawGet(url, config)
    .then((res) => { write(key, res.data); return res; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// What would `fn()` (a function that issues one ADMIN.get) return from the remembered data? { hit, value }
export function peek(fn) {
  const probe = { key: null, hit: false };
  let value;
  probing = probe;
  try { const r = fn(); if (probe.hit && r && typeof r.then === 'function') r.then((v) => { value = v; }); }
  catch { probe.hit = false; }
  finally { probing = false; }
  return { hit: probe.hit, value, key: probe.key };
}

// ── warm-up ────────────────────────────────────────────────────────────────
// The first screen of every page, as the page itself asks for it (same URL + params => same remembered answer).
const common = [
  ['/dashboard/overview'], ['/dashboard/charts', { days: 30 }], ['/workouts/stats'], ['/workouts', { page: 1, limit: 20 }],
  ['/users', { sort: 'created_at', order: 'desc', page: 1, limit: 20 }], ['/reports', { status: 'open', page: 1, limit: 10 }],
  ['/reports', { status: 'open', limit: 1 }], ['/posts', { page: 1, limit: 10 }],
];
const adminOnly = [['/system/health'], ['/leaderboard', { limit: 50 }], ['/announcements'], ['/audit', { page: 1, limit: 30 }]];

export function warmAdmin(get, role) {
  if (!localStorage.getItem('admin_token')) return;
  const list = role === 'admin' ? [...common, ...adminOnly] : common;
  list.forEach(([url, params], i) => setTimeout(() => { if (!document.hidden) get(url, { params, maxAge: 20000 }).catch(() => {}); }, 150 + i * 220));
}

if (typeof window !== 'undefined') window.addEventListener('admin-logout', clearAdminCache);
