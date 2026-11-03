// Dedicated axios client for the admin portal. Uses `admin_token` (NOT the user app's `token`),
// so being signed in as a normal user and as an admin in the same browser never interferes.
import axios from 'axios';
import { BACKEND_URL } from '../services/api';
import { cachedGet, clearAdminCache } from './adminCache';
import { getDemoSession, rememberDemoSession, DEMO_SESSION_HEADER } from '../utils/demoSession';

export const TOKEN_KEY = 'admin_token';
export { BACKEND_URL };

const ADMIN = axios.create({ baseURL: `${BACKEND_URL}/api/admin`, timeout: 30000 });

// Every admin GET goes through the saved-copy layer (adminCache.js); other methods are untouched.
const rawGet = ADMIN.get.bind(ADMIN);
ADMIN.get = (url, config) => cachedGet(rawGet, url, config);

ADMIN.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const demoSid = getDemoSession();
  if (demoSid) config.headers[DEMO_SESSION_HEADER] = demoSid; // only used by the server for the public demo accounts
  return config;
});

ADMIN.interceptors.response.use(
  rememberDemoSession,
  (error) => {
    const url = error.config?.url || '';
    if (error.response?.status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      clearAdminCache();
      window.dispatchEvent(new Event('admin-logout'));
    }
    return Promise.reject(error);
  }
);

export const errMsg = (e) => e?.response?.data?.message || (e?.code === 'ERR_NETWORK' ? 'Cannot reach the server' : e?.message) || 'Something went wrong';

// Authenticated file download (CSV exports): the Authorization header can't be sent by a plain <a href>.
export async function downloadFile(path, params, filename) {
  const res = await ADMIN.get(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default ADMIN;
