// Dedicated axios client for the admin portal. Uses `admin_token` (NOT the user app's `token`),
// so being signed in as a normal user and as an admin in the same browser never interferes.
import axios from 'axios';
import { BACKEND_URL } from '../services/api';

export const TOKEN_KEY = 'admin_token';
export { BACKEND_URL };

const ADMIN = axios.create({ baseURL: `${BACKEND_URL}/api/admin`, timeout: 30000 });

ADMIN.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

ADMIN.interceptors.response.use(
  (r) => r,
  (error) => {
    const url = error.config?.url || '';
    if (error.response?.status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
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
