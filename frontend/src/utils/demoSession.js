// Every browser gets its own private demo sandbox on the server. The server hands out its id at demo sign-in
// (`demo_session`); we keep it and send it with the next demo sign-in so the demo admin and the demo members opened in
// this browser share ONE world, while other visitors' demos stay separate. Not a secret and never sent for real accounts' data.
const KEY = 'aivo_demo_session';

export const DEMO_SESSION_HEADER = 'X-Demo-Session';

export const getDemoSession = () => {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
};

// axios response interceptor: remember the sandbox id whenever a sign-in response carries one
export const rememberDemoSession = (res) => {
  const sid = res?.data?.demo_session;
  if (sid) { try { localStorage.setItem(KEY, sid); } catch { /* storage blocked: next sign-in just gets a new sandbox */ } }
  return res;
};
