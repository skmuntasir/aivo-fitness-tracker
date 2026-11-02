// "Remember me" on the sign-in form.
//   checked   -> stay signed in across browser restarts (until the login itself expires)
//   unchecked -> signed out as soon as the browser has been closed and re-opened
// Implemented with a tiny session cookie (`aivo_alive`): it is shared by every tab and disappears when the browser
// closes. On start-up, if the person chose NOT to be remembered and that cookie is gone, the saved sign-in is dropped.
// Accounts that signed in before this existed have no choice stored and are treated as remembered.
const FLAG = 'aivo_remember';
const COOKIE = 'aivo_alive';
const SESSION_KEYS = ['token', 'user', 'admin_token'];

const alive = () => document.cookie.split('; ').some((c) => c.startsWith(`${COOKIE}=`));
const markAlive = () => { document.cookie = `${COOKIE}=1; path=/; SameSite=Lax`; };

export const wantsRemember = () => {
  try { return localStorage.getItem(FLAG) !== '0'; } catch { return true; }
};

export function setRememberChoice(remember) {
  try { localStorage.setItem(FLAG, remember ? '1' : '0'); } catch { /* storage unavailable */ }
  markAlive();
}

export function applyRememberChoice() {
  try {
    if (localStorage.getItem(FLAG) === '0' && navigator.cookieEnabled && !alive()) {
      SESSION_KEYS.forEach((k) => localStorage.removeItem(k));
    }
    markAlive();
  } catch { /* storage unavailable */ }
}
