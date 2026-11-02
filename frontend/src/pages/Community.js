import React, { memo, useCallback, useEffect, useState } from 'react';
import API from '../services/api';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import { useChat } from '../components/ChatContext';
import { useFeedback } from '../components/Feedback';
import { compressImage } from '../utils/image';
import { formatDateTime } from '../utils/time';
import { imageSrc, readFeedCache, writeFeedCache } from '../utils/feedCache';
import './Community.css';

const dailyQuote = 'Progress is earned in the quiet grind, not the spotlight.';

const trendingChallenges = [
  { title: '30-Day Core Boost', detail: 'Daily core circuits + mobility routines.', icon: 'flame' },
  { title: 'Hydration Hero', detail: 'Drink 2L water each day for 7 days.', icon: 'activity' },
  { title: 'Weekend Warrior', detail: 'Complete 3 strength sessions this weekend.', icon: 'zap' },
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
    <article className="comm-post card">
      <div className="comm-post-header">
        <Avatar name={post.author?.full_name || 'U'} size={44} showPresence={false} />
        <div className="comm-post-meta">
          <strong>{post.author?.full_name}</strong>
          <span>{formatDateTime(post.createdAt)}</span>
        </div>
        {isAuthor && (
          <div className="comm-post-actions">
            <button className="comm-ghost-btn" onClick={() => { setEditContent(post.content); setEditing(true); }} title="Edit" aria-label="Edit post"><Icon name="edit" size={16} /></button>
            <button className="comm-ghost-btn" onClick={() => onDelete(post.id)} title="Delete" aria-label="Delete post"><Icon name="trash" size={16} /></button>
          </div>
        )}
        {!isAuthor && (
          <div className="comm-post-actions">
            <button className="comm-ghost-btn" onClick={() => setReport(report ? null : { reason: 'spam', details: '', state: 'idle' })} title="Report this post" aria-label="Report this post"><Icon name="flag" size={16} /></button>
          </div>
        )}
      </div>

      {report && (
        <div className="comm-report">
          {report.state === 'done' ? <span className="comm-report-done"><Icon name="check" size={16} strokeWidth={2.6} /> Thanks, our team will review this post.</span> : (
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
        <button className={`comm-react-btn${post.likedByUser ? ' liked' : ''}`} onClick={() => onLike(post.id)} aria-pressed={!!post.likedByUser} aria-label="Like">
          <Icon name="heart" size={18} className={post.likedByUser ? 'is-filled' : ''} /> <span>{post.likes}</span>
        </button>
        <button className={`comm-react-btn${commentsOpen ? ' on' : ''}`} onClick={() => setCommentsOpen((o) => !o)} aria-expanded={commentsOpen} aria-label="Comments">
          <Icon name="message" size={18} /> <span>{post.commentsCount}</span>
        </button>
      </div>

      {commentsOpen && (
        <div className="comm-comments">
          {post.comments.length === 0
            ? <p className="comm-hint">No comments yet. Be the first.</p>
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
              placeholder="Write a comment"
              className="comm-comment-input"
              maxLength={500}
              onKeyDown={(e) => e.key === 'Enter' && submitComment()}
            />
            <button className="comm-post-btn small" onClick={submitComment}>Post</button>
          </div>
        </div>
      )}
    </article>
  );
});

const FeedSkeleton = () => (
  <>
    {[0, 1].map((i) => (
      <div key={i} className="comm-post card comm-skeleton">
        <div className="comm-post-header"><div className="sk" style={{ width: 44, height: 44, borderRadius: '50%' }} /><div style={{ display: 'grid', gap: 8 }}><div className="sk" style={{ width: 120, height: 12 }} /><div className="sk" style={{ width: 80, height: 10 }} /></div></div>
        <div className="sk" style={{ height: 14, width: '80%' }} />
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
      <div className="community-content">
        <header className="page-head comm-header">
          <div className="comm-header-left">
            <h1 className="comm-title">Community</h1>
            <p className="comm-sub">Posts are visible to you and your friends. Share a win, cheer someone on.</p>
          </div>
        </header>

        <div className="community-grid">
          <div className="comm-main">
            <div className="comm-create card">
              <div className="comm-create-header">
                <Avatar name={currentUser?.full_name || 'U'} size={44} showPresence={false} />
                <textarea
                  className="comm-create-input"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Share a workout, a win or some motivation"
                  rows={3}
                  maxLength={2000}
                />
              </div>
              {postError && <p className="comm-post-error" role="alert">{postError}</p>}
              {imagePreview && (
                <div className="comm-img-wrap">
                  <img className="comm-img-preview" src={imagePreview} alt="Preview" />
                  <button type="button" className="comm-img-remove" onClick={() => setImagePreview('')} aria-label="Remove photo"><Icon name="x" size={16} /></button>
                </div>
              )}
              <div className="comm-create-footer">
                <label className="comm-upload-btn">
                  <Icon name="image" size={18} /> Add photo
                  <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
                </label>
                <button className="comm-post-btn" onClick={handlePost} disabled={submitting}>
                  {submitting ? 'Posting…' : 'Post'}
                </button>
              </div>
            </div>

            <div className="comm-feed">
              {loading ? (
                <FeedSkeleton />
              ) : posts.length === 0 ? (
                <div className="comm-empty card">
                  <span className="comm-empty-icon"><Icon name="users" size={26} /></span>
                  <strong>Nothing here yet</strong>
                  <p>Share your first update. Posts from your friends will show up here too.</p>
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
                    <button className="comm-ghost-btn comm-more" disabled={loadingMore}
                      onClick={() => loadFeed({ more: true, before: nextBefore })}>
                      {loadingMore ? 'Loading…' : 'Load more posts'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <aside className="comm-sidebar">
            <div className="comm-sidebar-card card comm-quote-card">
              <p>“{dailyQuote}”</p>
            </div>

            <div className="comm-sidebar-card card">
              <div className="comm-sidebar-title">Challenges to try</div>
              {trendingChallenges.map((ch) => (
                <div key={ch.title} className="comm-sidebar-item">
                  <span className="comm-sidebar-item-icon"><Icon name={ch.icon} size={18} /></span>
                  <div>
                    <strong>{ch.title}</strong>
                    <span>{ch.detail}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="comm-sidebar-card card">
              <div className="comm-sidebar-title">Your friends</div>
              {friends.length === 0 ? (
                <p className="comm-hint">Add friends to see them here.</p>
              ) : (
                friends.slice(0, 5).map((u) => (
                  <div key={u.id} className="comm-sidebar-item">
                    <Avatar name={u.full_name || 'U'} online={!!u.online} size={38} />
                    <div>
                      <strong>{u.full_name}</strong>
                      <span className={u.online ? 'is-online' : ''}>{u.online ? 'Online now' : (u.username || u.email)}</span>
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
