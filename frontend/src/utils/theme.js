// Member-app light / dark theme. The choice is remembered in localStorage and applied as
// <html data-theme="light|dark"> (index.html applies it before first paint, so there is no flash).
const KEY = 'aivo_theme';
const listeners = new Set();

export const getTheme = () => {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
};

export const applyTheme = (theme) => {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.colorScheme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'light' ? '#f3f4fa' : '#070a17');
  return t;
};

export const setTheme = (theme) => {
  const t = applyTheme(theme);
  try { localStorage.setItem(KEY, t); } catch { /* private mode: still works for this visit */ }
  listeners.forEach((fn) => fn(t));
  return t;
};

export const toggleTheme = () => setTheme(getTheme() === 'light' ? 'dark' : 'light');
export const subscribeTheme = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
