// Community feed cache + prefetch.
// - First paint: the last feed we saw is shown instantly, then refreshed in the background.
// - Prefetch: Home warms this cache (and the Community code chunk) so the page opens ready.
// Photos are NOT in this cache (they're plain image URLs the browser caches itself), so it stays tiny.
import API, { BACKEND_URL } from '../services/api';

const PAGE = 10;
const prefix = 'feed:v1:';

const uid = () => {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.id || u._id || 'anon'; } catch { return 'anon'; }
};
const key = () => `${prefix}${uid()}`;

// Posts carry a relative photo URL from the API; resolve it against the backend.
export const imageSrc = (post) => post.image || (post.imageUrl ? `${BACKEND_URL}${post.imageUrl}` : null);

export function readFeedCache() {
  try {
    const c = JSON.parse(localStorage.getItem(key()));
    return c && Array.isArray(c.posts) ? c : null;
  } catch { return null; }
}

export function writeFeedCache(posts, hasMore, nextBefore) {
  try {
    const first = posts.slice(0, PAGE).map((p) => ({ ...p, image: null }));   // never persist inline data-URLs
    const last = first[first.length - 1];
    localStorage.setItem(key(), JSON.stringify({
      t: Date.now(),
      posts: first,
      hasMore: posts.length > PAGE || !!hasMore,
      nextBefore: posts.length > PAGE ? last?.createdAt || null : nextBefore || null,
    }));
  } catch { /* storage full / unavailable: cache is optional */ }
}

let inflight = null;
export function prefetchFeed({ maxAgeMs = 15000 } = {}) {
  const cached = readFeedCache();
  if (cached && Date.now() - cached.t < maxAgeMs) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = API.get('/posts/feed', { params: { limit: PAGE } })
    .then((res) => {
      const d = res.data;
      if (d?.success) writeFeedCache(d.posts || [], d.hasMore, d.nextBefore);
      return d;
    })
    .catch(() => null)
    .finally(() => { inflight = null; });
  return inflight;
}

if (typeof window !== 'undefined') {
  window.addEventListener('logout', () => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(prefix)).forEach((k) => localStorage.removeItem(k));
    } catch {}
  });
}
