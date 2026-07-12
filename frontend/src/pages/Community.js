import React, { useEffect, useState } from 'react';
import API from '../services/api';
import BackButton from '../components/BackButton';
import './Community.css';

const dailyQuote = 'Progress is earned in the quiet grind, not the spotlight.';

const trendingChallenges = [
  { title: '30-Day Core Boost', detail: 'Daily core circuits + mobility routines.', icon: '🔥' },
  { title: 'Hydration Hero', detail: 'Drink 2L water each day for 7 days.', icon: '💧' },
  { title: 'Weekend Warrior', detail: 'Complete 3 strength sessions this weekend.', icon: '⚡' },
];

const Community = () => {
  const [content, setContent] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [imageData, setImageData] = useState('');
  const [posts, setPosts] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [commentsOpen, setCommentsOpen] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [editingPostId, setEditingPostId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [postError, setPostError] = useState('');
  const [activeUsers, setActiveUsers] = useState([]);

  const currentUser = (() => {
    try { return JSON.parse(localStorage.getItem('user')) || {}; } catch { return {}; }
  })();
  const currentUserId = currentUser._id || currentUser.id || '';

  const loadFeed = async () => {
    try {
      const response = await API.get('/posts/feed');
      setPosts(response.data.posts || []);
    } catch (error) { console.error(error); }
  };

  const loadActiveUsers = async () => {
    try {
      const res = await API.get('/friends/list');
      const friends = (res.data.friends || []).filter(Boolean);
      setActiveUsers(friends.slice(0, 5));
    } catch { setActiveUsers([]); }
  };

  useEffect(() => { loadFeed(); loadActiveUsers(); }, []);

  const handleImageChange = (event) => {
    const file = event.target.files[0];
    if (!file) { setImagePreview(''); setImageData(''); return; }
    const reader = new FileReader();
    reader.onloadend = () => { setImagePreview(reader.result); setImageData(reader.result); };
    reader.readAsDataURL(file);
  };

  const handlePost = async () => {
    setPostError('');
    if (!content.trim() && !imageData) { setPostError('Please write something or upload an image.'); return; }
    setSubmitting(true);
    try {
      const res = await API.post('/posts', { content: content.trim(), image: imageData || null });
      if (res.data.success) {
        setContent(''); setImagePreview(''); setImageData(''); setCommentsOpen({});
        await loadFeed();
      } else { setPostError(res.data.message || 'Failed to post. Try again.'); }
    } catch { setPostError('Something went wrong. Please try again.'); }
    finally { setSubmitting(false); }
  };

  const toggleComments = (postId) => setCommentsOpen(prev => ({ ...prev, [postId]: !prev[postId] }));

  const handleLike = async (postId) => {
    try { await API.post(`/posts/${postId}/like`); await loadFeed(); } catch (e) { console.error(e); }
  };

  const handleComment = async (postId) => {
    if (!commentText.trim()) return;
    try {
      await API.post(`/posts/${postId}/comment`, { comment: commentText.trim() });
      setCommentText(''); await loadFeed();
    } catch (e) { console.error(e); }
  };

  const handleDeletePost = async (postId) => {
    if (!window.confirm('Delete this post?')) return;
    try { await API.delete(`/posts/${postId}`); setPosts(prev => prev.filter(p => p.id !== postId)); }
    catch (e) { console.error(e); }
  };

  const handleStartEdit = (post) => { setEditingPostId(post.id); setEditContent(post.content); };

  const handleSaveEdit = async (postId) => {
    if (!editContent.trim()) return;
    try {
      await API.put(`/posts/${postId}`, { content: editContent.trim() });
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, content: editContent.trim() } : p));
      setEditingPostId(null);
    } catch (e) { console.error(e); }
  };

  const formatTime = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

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
        {/* Header */}
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
          {/* Feed */}
          <div className="comm-main">
            {/* Create post */}
            <div className="comm-create glass-panel">
              <div className="comm-create-header">
                <div className="comm-create-avatar">{currentUser?.full_name?.charAt(0) || 'U'}</div>
                <textarea
                  className="comm-create-input"
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="Share your fitness progress, workout wins, or motivation..."
                  rows={3}
                />
              </div>
              {postError && <p className="comm-post-error">{postError}</p>}
              {imagePreview && <img className="comm-img-preview" src={imagePreview} alt="Preview" />}
              <div className="comm-create-footer">
                <label className="comm-upload-btn">
                  📷 Photo
                  <input type="file" accept="image/*" onChange={handleImageChange} style={{display:'none'}} />
                </label>
                <button className="comm-post-btn" onClick={handlePost} disabled={submitting}>
                  {submitting ? 'Posting…' : '🚀 Post'}
                </button>
              </div>
            </div>

            {/* Posts */}
            <div className="comm-feed">
              {posts.length === 0 ? (
                <div className="comm-empty glass-panel">
                  <span>🏋️</span>
                  <p>No posts yet. Share your first fitness update and check back for friend activity.</p>
                </div>
              ) : (
                posts.map(post => {
                  const isAuthor = currentUserId && post.user_id === currentUserId;
                  const isEditing = editingPostId === post.id;
                  return (
                    <article key={post.id} className="comm-post glass-panel">
                      <div className="comm-post-header">
                        <div className="comm-post-avatar">{post.author?.full_name?.charAt(0) || 'U'}</div>
                        <div className="comm-post-meta">
                          <strong>{post.author?.full_name}</strong>
                          <span>{formatTime(post.createdAt)}</span>
                        </div>
                        {isAuthor && (
                          <div className="comm-post-actions">
                            <button className="comm-ghost-btn" onClick={() => handleStartEdit(post)} title="Edit">✏️</button>
                            <button className="comm-ghost-btn" onClick={() => handleDeletePost(post.id)} title="Delete">🗑️</button>
                          </div>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="comm-edit-area">
                          <textarea
                            className="comm-edit-input"
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                          />
                          <div className="comm-edit-btns">
                            <button className="comm-post-btn" onClick={() => handleSaveEdit(post.id)}>Save</button>
                            <button className="comm-cancel-btn" onClick={() => setEditingPostId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <p className="comm-post-text">{post.content}</p>
                      )}
                      {post.image && <img className="comm-post-img" src={post.image} alt="Shared" />}
                      <div className="comm-post-footer">
                        <button className="comm-react-btn" onClick={() => handleLike(post.id)}>
                          ❤️ <span>{post.likes}</span>
                        </button>
                        <button className="comm-react-btn" onClick={() => toggleComments(post.id)}>
                          💬 <span>{post.commentsCount}</span>
                        </button>
                      </div>
                      {commentsOpen[post.id] && (
                        <div className="comm-comments">
                          {post.comments.length === 0
                            ? <p className="comm-hint">No comments yet.</p>
                            : post.comments.map(c => (
                              <div key={c.id} className="comm-comment-item">
                                <strong>{c.username}</strong>
                                <span>{c.text}</span>
                              </div>
                            ))
                          }
                          <div className="comm-comment-input-row">
                            <input
                              value={commentText}
                              onChange={e => setCommentText(e.target.value)}
                              placeholder="Write a comment..."
                              className="comm-comment-input"
                              onKeyDown={e => e.key === 'Enter' && handleComment(post.id)}
                            />
                            <button className="comm-post-btn small" onClick={() => handleComment(post.id)}>Send</button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="comm-sidebar">
            <div className="comm-sidebar-card glass-panel">
              <div className="comm-sidebar-title">⚡ Trending Challenges</div>
              {trendingChallenges.map(ch => (
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
              <div className="comm-sidebar-title">🏃 Most Active Friends</div>
              {activeUsers.length === 0 ? (
                <p className="comm-hint" style={{padding:'8px 0'}}>Add friends to see them here.</p>
              ) : (
                activeUsers.map(u => (
                  <div key={u.id} className="comm-sidebar-item">
                    <div className="comm-sidebar-avatar">{u.full_name?.charAt(0) || 'U'}</div>
                    <div>
                      <strong>{u.full_name}</strong>
                      <span>{u.username || u.email}</span>
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
