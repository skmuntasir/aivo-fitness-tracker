// The AI coach conversation, kept per member until they log out: it survives moving between pages and reloads, and
// is what gets sent to the coach as history, so it remembers what it just said. Wiped on logout.
// (What the coach remembers across days is stored on the server: backend ai/memory.py.)
const PREFIX = 'coach:chat:v1:';
const MAX_MESSAGES = 60;       // plenty for the model (it reads the last 20) and small for localStorage
const MAX_TEXT = 8000;

const uid = () => {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.id || u._id || 'anon'; } catch { return 'anon'; }
};
const key = () => `${PREFIX}${uid()}`;
let mem = null;                // { key, messages }

export function loadChat() {
  const k = key();
  if (mem && mem.key === k) return mem.messages;
  try {
    const list = JSON.parse(localStorage.getItem(k));
    if (Array.isArray(list) && list.length) { mem = { key: k, messages: list }; return list; }
  } catch { /* corrupt entry: start fresh */ }
  return null;
}

export function saveChat(messages) {
  if (!localStorage.getItem('token')) return;                // signed out: never write it back
  const clean = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'ai') && typeof m.text === 'string')
    .slice(-MAX_MESSAGES)
    .map(({ id, role, text, saved, timerDone }) => ({ id, role, text: text.slice(0, MAX_TEXT), ...(saved ? { saved } : {}), ...(timerDone ? { timerDone } : {}) }));
  mem = { key: key(), messages: clean };
  try { localStorage.setItem(key(), JSON.stringify(clean)); } catch { /* storage full: the in-memory copy still works this session */ }
}

export function clearChat() {
  mem = null;
  try { localStorage.removeItem(key()); } catch { /* ignore */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('logout', () => {
    mem = null;
    try { Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  });
}
