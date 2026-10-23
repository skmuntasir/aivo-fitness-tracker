import React, { memo, useCallback, useEffect, useState } from 'react';
import API from '../services/api';
import BackButton from '../components/BackButton';
import { useChat } from '../components/ChatContext';
import { useFeedback } from '../components/Feedback';
import { compressImage } from '../utils/image';
import { formatDateTime } from '../utils/time';
import { imageSrc, readFeedCache, writeFeedCache } from '../utils/feedCache';
import './Community.css';

const dailyQuote = 'Progress is earned in the quiet grind, not the spotlight.';

const trendingChallenges = [
  { title: '30-Day Core Boost', detail: 'Daily core circuits + mobility routines.', icon: '🔥' },
  { title: 'Hydration Hero', detail: 'Drink 2L water each day for 7 days.', icon: '💧' },
  { title: 'Weekend Warrior', detail: 'Complete 3 strength sessions this weekend.', icon: '⚡' },
];

const getCurrentUser = () => {
  try { return JSON.parse(localStorage.getItem('user')) || {}; } catch { return {}; }
};

// Memoised: liking/commenting on one post no longer re-renders (or re-downloads) the others.
const PostCard = memo(function PostCard({ post, isAuthor, eager, onLike, onComment, onDelete, onEdit }) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentText, setCommentText] = useState('');   // per post (was one shared state for all posts)
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [report, setReport] = useState(null);   // null | { reason, details, state }
  const photo = imageSrc(post);

  const submitComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    setCommentText('');
    await onComment(post.id, text);
  };

  return (
    <article className="comm-post glass-panel">
      <div className="comm-post-header">
        <div className="comm-post-avatar">{post.author?.full_name?.charAt(0) || 'U'}</div>
        <div className="comm-post-meta">
          <strong>{post.author?.full_name}</strong>
          <span>{formatDateTime(post.createdAt)}</span>
        </div>
        {isAuthor && (
          <div className="comm-post-actions">
            <button className="comm-ghost-btn" onClick={() => { setEditContent(post.content); setEditing(true); }} title="Edit">✏️</button>
            <button className="comm-ghost-btn" onClick={() => onDelete(post.id)} title="Delete">🗑️</button>
          </div>
        )}
        {!isAuthor && (
          <div className="comm-post-actions">
            <button className="comm-ghost-btn" onClick={() => setReport(report ? null : { reason: 'spam', details: '', state: 'idle' })} title="Report this post" aria-label="Report this post">🚩</button>
          </div>
        )}
      </div>

      {report && (
        <div className="comm-report">
          {report.state === 'done' ? <span>✅ Thanks — our team will review this post.</span> : (
            <>
              <select value={report.reason} onChange={(e) => setReport({ ...report, reason: e.target.value })}>
                <option value="spam">Spam</option><option value="harassment">Harassment</option>
                <option value="inappropriate">Inappropriate</option><option value="misinformation">Misinformation</option><option value="other">Other</option>
              </select>
              <input placeholder="Add a note (optional)" maxLength={300} value={report.details} onChange={(e) => setReport({ ...report, details: e.target.value })} />
              {report.error && <span className="comm-report-err">{report.error}</span>}
              <div className="comm-report-actions">
                <button className="comm-post-btn" disabled={report.state === 'sending'} onClick={async () => {
                  setReport({ ...report, state: 'sending', error: '' });
                  try { await API.post(`/posts/${post.id}/report`, { reason: report.reason, details: report.details }); setReport({ ...report, state: 'done' }); }
                  catch (e) { setReport({ ...report, state: 'idle', error: e.response?.data?.message || 'Could not send report' }); }
                }}>{report.state === 'sending' ? 'Sending…' : 'Submit report'}</button>
                <button className="comm-ghost-btn" onClick={() => setReport(null)}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {editing ? (
        <div className="comm-edit-area">
          <textarea className="comm-edit-input" value={editContent} onChange={(e) => setEditContent(e.target.value)} />
          <div className="comm-edit-btns">
            <button className="comm-post-btn" onClick={async () => { if (await onEdit(post.id, editContent)) setEditing(false); }}>Save</button>
            <button className="comm-cancel-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="comm-post-text">{post.content}</p>
      )}

      {photo && (
        <img
          className={`comm-post-img${imgLoaded ? ' loaded' : ''}`}
          src={photo}
          alt="Shared"
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'auto'}
          decoding="async"
          ref={(el) => { if (el && el.complete && el.naturalWidth) setImgLoaded(true); }}   // already-cached photos
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgLoaded(true)}
        />
      )}

      <div className="comm-post-footer">
        <button className="comm-react-btn" onClick={() => onLike(post.id)} style={post.likedByUser ? { color: '#f87171', fontWeight: 700 } : undefined}>
          {post.likedByUser ? '❤️' : '🤍'} <span>{post.likes}</span>
        </button>
        <button className="comm-react-btn" onClick={() => setCommentsOpen((o) => !o)}>
          💬 <span>{post.commentsCount}</span>
        </button>
      </div>

      {commentsOpen && (
        <div className="comm-comments">
          {post.comments.length === 0
            ? <p className="comm-hint">No comments yet.</p>
            : post.comments.map((c) => (
              <div key={c.id} className="comm-comment-item">
                <strong>{c.username}</strong>
                <span>{c.text}</span>
              </div>
            ))}
          <div className="comm-comment-input-row">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Write a comment..."
              className="comm-comment-input"
              maxLength={500}
              onKeyDown={(e) => e.key === 'Enter' && submitComment()}
            />
            <button className="comm-post-btn small" onClick={submitComment}>Send</button>
          </div>
        </div>
      )}
    </article>
  );
});

const FeedSkeleton = () => (
  <>
    {[0, 1].map((i) => (
      <div key={i} className="comm-post glass-panel" style={{ minHeight: 120, opacity: 0.5 }}>
        <div className="comm-post-header"><div className="comm-post-avatar">&nbsp;</div></div>
      </div>
    ))}
  </>
);

const Community = () => {
  const [content, setContent] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  // Seed from the last feed we saw (or what Home prefetched): posts are on screen on the FIRST paint,
  // then refreshed from the server in the background.
  const [cached] = useState(() => readFeedCache());
  const [posts, setPosts] = useState(() => cached?.posts || []);
  const [loading, setLoading] = useState(() => !cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => !!cached?.hasMore);
  const [nextBefore, setNextBefore] = useState(() => cached?.nextBefore || null);
  const [submitting, setSubmitting] = useState(false);
  const [postError, setPostError] = useState('');

  const { confirm, toast } = useFeedback();
  const { conversations: friends } = useChat();   // shared friends list, no extra request
  const currentUser = getCurrentUser();
  const currentUserId = currentUser._id || currentUser.id || '';

  const loadFeed = useCallback(async ({ more = false, before = null } = {}) => {
    try {
      if (more) setLoadingMore(true);
      else if (!readFeedCache()) setLoading(true);   // cached posts => no skeleton, silent refresh
      const response = await API.get('/posts/feed', { params: { limit: 10, ...(before ? { before } : {}) } });
      const data = response.data;
      setPosts((prev) => (more ? [...prev, ...(data.posts || [])] : data.posts || []));
      setHasMore(!!data.hasMore);
      setNextBefore(data.nextBefore || null);
      if (!more) writeFeedCache(data.posts || [], data.hasMore, data.nextBefore);
    } catch (error) { console.error(error); }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  // Keep the cache in step with local changes so a quick revisit never shows a deleted/old state.
  useEffect(() => {
    if (!loading && posts.length) writeFeedCache(posts, hasMore, nextBefore);
  }, [posts]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImageChange = async (event) => {
    const file = event.target.files[0];
    if (!file) { setImagePreview(''); return; }
    try { setImagePreview(await compressImage(file)); }   // resized to <=1280px JPEG before upload
    catch { setPostError('Could not read that image.'); }
  };

  const handlePost = async () => {
    setPostError('');
    if (!content.trim() && !imagePreview) { setPostError('Please write something or upload an image.'); return; }
    setSubmitting(true);
    try {
      const res = await API.post('/posts', { content: content.trim(), image: imagePreview || null });
      if (res.data.success) {
        setContent(''); setImagePreview('');
        setPosts((prev) => [{ ...res.data.post, image: imagePreview || null }, ...prev]);   // no reload; reuse the local preview
      } else { setPostError(res.data.message || 'Failed to post. Try again.'); }
    } catch (err) { setPostError(err?.response?.data?.message || 'Something went wrong. Please try again.'); }
    finally { setSubmitting(false); }
  };

  // Optimistic like: UI updates instantly, server result reconciles (reverts on failure).
  const handleLike = useCallback(async (postId) => {
    const patch = (fn) => setPosts((prev) => prev.map((p) => (p.id === postId ? fn(p) : p)));
    patch((p) => ({ ...p, likedByUser: !p.likedByUser, likes: p.likes + (p.likedByUser ? -1 : 1) }));
    try {
      const res = await API.post(`/posts/${postId}/like`);
      patch((p) => ({ ...p, likedByUser: res.data.liked, likes: res.data.likes }));
    } catch {
      patch((p) => ({ ...p, likedByUser: !p.likedByUser, likes: p.likes + (p.likedByUser ? -1 : 1) }));
    }
  }, []);

  const handleComment = useCallback(async (postId, text) => {
    try {
      const res = await API.post(`/posts/${postId}/comment`, { comment: text });
      const c = res.data.comment;
      setPosts((prev) => prev.map((p) => (p.id === postId
        ? { ...p, comments: [...p.comments, c], commentsCount: p.commentsCount + 1 } : p)));
    } catch (e) { console.error(e); }
  }, []);

  const handleDelete = useCallback(async (postId) => {
    if (!(await confirm({ title: 'Delete this post?', message: 'This will permanently remove your post and its comments.', confirmLabel: 'Delete post', tone: 'danger' }))) return;
    try { await API.delete(`/posts/${postId}`); setPosts((prev) => prev.filter((p) => p.id !== postId)); toast('Post deleted.', 'success'); }
    catch (e) { console.error(e); toast('Could not delete the post. Please try again.', 'error'); }
  }, [confirm, toast]);

  const handleEdit = useCallback(async (postId, newContent) => {
    const trimmed = newContent.trim();
    if (!trimmed) return false;
    try {
      await API.put(`/posts/${postId}`, { content: trimmed });
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, content: trimmed } : p)));
      return true;
    } catch (e) { console.error(e); return false; }
  }, []);

  return (
    <div className="community-page">
      <div className="home-bg-gradient"></div>
      <div className="home-bg-orbs">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>
      <BackButton />
      <div className="community-content">
        <header className="comm-header glass-panel">
          <div className="comm-header-left">
            <span className="pg-eyebrow">FITNESS FEED</span>
            <h1 className="comm-title">Share, support & <span className="comm-accent">train together</span></h1>
            <p className="comm-sub">Posts are visible only to you and your friends. Create, like, and comment on fitness moments.</p>
          </div>
          <div className="comm-header-quote">
            <span className="comm-quote-icon">💬</span>
            <p>"{dailyQuote}"</p>
          </div>
        </header>

        <div className="community-grid">
          <div className="comm-main">
            <div className="comm-create glass-panel">
              <div className="comm-create-header">
                <div className="comm-create-avatar">{currentUser?.full_name?.charAt(0) || 'U'}</div>
                <textarea
                  className="comm-create-input"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Share your fitness progress, workout wins, or motivation..."
                  rows={3}
                  maxLength={2000}
                />
              </div>
              {postError && <p className="comm-post-error">{postError}</p>}
              {imagePreview && <img className="comm-img-preview" src={imagePreview} alt="Preview" />}
              <div className="comm-create-footer">
                <label className="comm-upload-btn">
                  📷 Photo
                  <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
                </label>
                <button className="comm-post-btn" onClick={handlePost} disabled={submitting}>
                  {submitting ? 'Posting…' : '🚀 Post'}
                </button>
              </div>
            </div>

            <div className="comm-feed">
              {loading ? (
                <FeedSkeleton />
              ) : posts.length === 0 ? (
                <div className="comm-empty glass-panel">
                  <span>🏋️</span>
                  <p>No posts yet. Share your first fitness update and check back for friend activity.</p>
                </div>
              ) : (
                <>
                  {posts.map((post, idx) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      eager={idx < 2}
                      isAuthor={!!currentUserId && post.user_id === currentUserId}
                      onLike={handleLike}
                      onComment={handleComment}
                      onDelete={handleDelete}
                      onEdit={handleEdit}
                    />
                  ))}
                  {hasMore && (
                    <button className="comm-post-btn" style={{ alignSelf: 'center' }} disabled={loadingMore}
                      onClick={() => loadFeed({ more: true, before: nextBefore })}>
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <aside className="comm-sidebar">
            <div className="comm-sidebar-card glass-panel">
              <div className="comm-sidebar-title">⚡ Trending Challenges</div>
              {trendingChallenges.map((ch) => (
                <div key={ch.title} className="comm-sidebar-item">
                  <span className="comm-sidebar-item-icon">{ch.icon}</span>
                  <div>
                    <strong>{ch.title}</strong>
                    <span>{ch.detail}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="comm-sidebar-card glass-panel">
              <div className="comm-sidebar-title">👥 Your Friends</div>
              {friends.length === 0 ? (
                <p className="comm-hint" style={{ padding: '8px 0' }}>Add friends to see them here.</p>
              ) : (
                friends.slice(0, 5).map((u) => (
                  <div key={u.id} className="comm-sidebar-item">
                    <div className="comm-sidebar-avatar">{u.full_name?.charAt(0) || 'U'}</div>
                    <div>
                      <strong>{u.full_name}</strong>
                      <span>{u.online ? '● Online' : (u.username || u.email)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default Community;
