// Stale-while-revalidate data cache for Progress, Leaderboard and Profile (same idea as the Community feed cache).
//  - The last data we saw is shown instantly (memory while you move around, localStorage after a reload),
//    then refreshed quietly in the background, so these pages never open on a spinner or skeleton again.
//  - Warm-up: the data is fetched while the app is idle / when you hover a menu link, so it is usually ready
//    before you tap. Calls for the same data share one request.
//  - Private per member, wiped on logout. Profile photos are never stored here (they are big; Profile keeps its own).
import { useCallback, useEffect, useRef, useState } from 'react';
import API from '../services/api';

const PREFIX = 'dc:v1:';
const mem = new Map();        // key -> { data, t }
const inflight = new Map();   // key -> Promise
const subs = new Map();       // key -> Set<fn>

const uid = () => {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.id || u._id || 'anon'; } catch { return 'anon'; }
};
const fullKey = (name) => `${PREFIX}${uid()}:${name}`;

// What to fetch for each name. `lb:<scope>`, `badges-of:<id>` are parameterised.
const SOURCES = {
  progress: async () => {
    const res = await API.get('/analytics/progress-summary');
    if (!res.data?.success) throw new Error('progress');
    return res.data;
  },
  profile: async () => {
    const p = await API.get('/auth/profile');
    if (!p.data?.success) { const e = new Error(p.data?.message || 'Failed to load profile.'); e.userMessage = e.message; throw e; }
    let metrics = null;
    try { const m = await API.get('/auth/calculate-health-metrics'); if (m.data?.success) metrics = m.data.metrics; } catch { /* optional */ }
    return { user: p.data.user, metrics };
  },
  badges: async () => (await API.get('/badges')).data,
  plans: async () => (await API.get('/plans')).data,
  announcements: async () => (await API.get('/announcements/active')).data,
};
const sourceFor = (name) => {
  if (SOURCES[name]) return SOURCES[name];
  if (name.startsWith('lb:')) {
    const scope = name.slice(3);
    return async () => {
      const res = await API.get('/workouts/leaderboard', { params: { scope } });
      if (!res.data?.success) throw new Error('leaderboard');
      return res.data;
    };
  }
  if (name.startsWith('badges-of:')) {
    const id = name.slice(10);
    return async () => (await API.get(`/badges/user/${id}`)).data;
  }
  return null;
};

// keep photos out of localStorage
const forStorage = (name, data) => {
  if (name === 'profile' && data?.user?.profile_picture) return { ...data, user: { ...data.user, profile_picture: null } };
  return data;
};

export function readData(name) {
  const key = fullKey(name);
  if (mem.has(key)) return mem.get(key);
  try {
    const c = JSON.parse(localStorage.getItem(key));
    if (c && c.data !== undefined) { mem.set(key, c); return c; }
  } catch { /* corrupt entry: ignore */ }
  return null;
}

export function writeData(name, data) {
  const key = fullKey(name);
  const entry = { data, t: Date.now() };
  mem.set(key, entry);
  try { localStorage.setItem(key, JSON.stringify({ ...entry, data: forStorage(name, data) })); } catch { /* storage full: memory copy still works */ }
  subs.get(key)?.forEach((fn) => fn(data));
}

// Fetch fresh data (shared request). With maxAge, a copy that is young enough is reused instead.
export function refreshData(name, { maxAge = 0 } = {}) {
  const key = fullKey(name);
  const hit = readData(name);
  if (maxAge && hit && Date.now() - hit.t < maxAge) return Promise.resolve(hit.data);
  if (inflight.has(key)) return inflight.get(key);
  const src = sourceFor(name);
  if (!src) return Promise.reject(new Error(`No data source for ${name}`));
  const p = src().then((data) => { writeData(name, data); return data; }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const prefetchData = (name) => refreshData(name, { maxAge: 20000 }).catch(() => null);

// Which data each page needs (used by warm-up and by menu-link hover)
const ROUTE_DATA = {
  '/home': ['announcements'],
  '/progress': ['progress'],
  '/leaderboard': ['lb:friends', 'lb:global'],
  '/profile': ['profile', 'badges', 'plans'],
};
export function prefetchRouteData(path) {
  const key = Object.keys(ROUTE_DATA).find((k) => path === k || path.startsWith(`${k}/`));
  if (key && localStorage.getItem('token')) ROUTE_DATA[key].forEach(prefetchData);
}
export function warmData() {
  if (!localStorage.getItem('token')) return;
  Object.keys(ROUTE_DATA).forEach((p, i) => setTimeout(() => prefetchRouteData(p), 400 + i * 300));
}

// React hook: { data, loading, error, reload }. `loading` is only true when there is nothing saved to show yet.
export function useCachedData(name) {
  const [data, setData] = useState(() => readData(name)?.data ?? null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(() => !readData(name));
  const alive = useRef(true);

  const reload = useCallback(() => {
    setError(null);
    return refreshData(name)
      .then((d) => { if (alive.current) { setData(d); setPending(false); } return d; })
      .catch((e) => { if (alive.current) { setError(e); setPending(false); } return null; });
  }, [name]);

  useEffect(() => {
    alive.current = true;
    const hit = readData(name);
    setData(hit?.data ?? null);
    setPending(!hit);
    const key = fullKey(name);
    const fn = (d) => { if (alive.current) setData(d); };
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(fn);
    reload();
    return () => { alive.current = false; subs.get(key)?.delete(fn); };
  }, [name, reload]);

  return { data, loading: pending && data == null, error: data == null ? error : null, reload };
}

if (typeof window !== 'undefined') {
  window.addEventListener('logout', () => {
    mem.clear();
    try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  });
}
