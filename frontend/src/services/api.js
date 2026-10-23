import axios from 'axios';
import { userTimeZone } from '../utils/time';

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

const API = axios.create({ baseURL: `${BACKEND_URL}/api`, timeout: 20000 });

API.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    config.headers['X-Timezone'] = userTimeZone; // lets the server group days in the user's timezone
    return config;
  },
  (error) => Promise.reject(error)
);

API.interceptors.response.use(
  (response) => response,
  (error) => {
    const { status, data } = error.response || {};
    if (status === 403 && data?.code === 'suspended') {   // suspended by an admin while signed in
      sessionStorage.setItem('aivo_notice', data.message || 'Your account has been suspended.');
      localStorage.removeItem('token'); localStorage.removeItem('user');
      window.dispatchEvent(new Event('logout'));
      if (window.location.pathname !== '/login') window.location.href = '/login';
    } else if (status === 503 && data?.code === 'maintenance') {
      window.dispatchEvent(new CustomEvent('maintenance', { detail: data.message }));
    }
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ── Tiny GET cache with in-flight de-duplication ─────────────────────────────
// Several pages used to fetch the same endpoint (e.g. /friends/list) independently.
const cache = new Map();
const inflight = new Map();

export function cachedGet(url, { ttl = 30000, force = false } = {}) {
  const key = `${localStorage.getItem('token') || ''}|${url}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.t < ttl) return Promise.resolve(hit.data);
  if (inflight.has(key)) return inflight.get(key);
  const p = API.get(url)
    .then((res) => { cache.set(key, { t: Date.now(), data: res.data }); return res.data; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const invalidateCache = (prefix = '') => {
  for (const k of cache.keys()) if (k.split('|')[1]?.startsWith(prefix)) cache.delete(k);
};
window.addEventListener('logout', () => cache.clear());
window.addEventListener('authUpdated', () => cache.clear());

export default API;
