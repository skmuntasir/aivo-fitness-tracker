// Route code prefetching.
// Pages are code-split (lazy). To make navigation feel instant we download the other pages'
// chunks while the browser is idle, and again on hover/touch of a link. Each import() is cached
// by the module system, so calling these repeatedly is free.
const loaders = {
  '/home': () => import('../pages/Home'),
  '/progress': () => import('../pages/Progress'),
  '/community': () => import('../pages/Community'),
  '/friends': () => import('../pages/Friends'),
  '/profile': () => import('../pages/Profile'),
  '/leaderboard': () => import('../components/LeaderboardPage'),
  '/chat': () => import('../pages/Chat'),
  '/register': () => import('../pages/Register'),
};

const done = new Set();
export function prefetchRoute(path) {
  const key = Object.keys(loaders).find((k) => path === k || path.startsWith(`${k}/`));
  if (!key || done.has(key)) return;
  done.add(key);
  loaders[key]().catch(() => done.delete(key));   // allow a retry if the network blinked
}

const idle = (fn, timeout = 2500) =>
  ('requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout }) : setTimeout(fn, 1200));

// Skip on data-saver / very slow connections so we never cost the user bandwidth they asked to save
const canPrefetch = () => {
  const c = navigator.connection;
  return !(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
};

export function warmUp() {
  if (!canPrefetch()) return;
  // Only warm pages for signed-in users (everything except login/register needs a session)
  idle(() => {
    if (!localStorage.getItem('token')) { prefetchRoute('/register'); return; }
    ['/home', '/progress', '/community', '/friends', '/profile', '/leaderboard'].forEach((p, i) =>
      setTimeout(() => prefetchRoute(p), i * 250));
  });
}

// Delegated hover/touch prefetch for any <a href="/route"> (NavLink, nav icons, bottom bar)
if (typeof document !== 'undefined') {
  const onIntent = (e) => {
    const a = e.target.closest && e.target.closest('a[href^="/"]');
    if (a && canPrefetch()) prefetchRoute(a.getAttribute('href'));
  };
  document.addEventListener('pointerover', onIntent, { passive: true });
  document.addEventListener('touchstart', onIntent, { passive: true });
  document.addEventListener('focusin', onIntent);
}
