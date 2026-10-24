import React, { useEffect, useRef, useState } from 'react';
import API from '../services/api';
import BackButton from '../components/BackButton';
import { useChat } from '../components/ChatContext';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import { lastSeenText } from '../utils/time';
import './Friends.css';

const Skeleton = () => (
  <div className="friend-card" style={{ opacity: 0.5 }}>
    <div className="sk" style={{ width: 44, height: 44, borderRadius: '50%' }} />
    <div className="friend-info"><div className="sk" style={{ width: 110, height: 12 }} /><div className="sk" style={{ width: 70, height: 10, marginTop: 6 }} /></div>
  </div>
);

const Friends = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const { confirm, toast } = useFeedback();

  // Friends + requests come from the shared ChatContext (kept live by the socket),
  // so this page no longer re-fetches them on every visit.
  const { conversations: friends, friendsLoaded, requests, refreshFriends, refreshRequests, openChat } = useChat();

  const searchUsers = async (value) => {
    const q = value.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const response = await API.get('/users/search', { params: { query: q } });
      if (seq === searchSeq.current) setResults((response.data.users || []).filter(Boolean)); // ignore stale responses
    } catch (e) { console.error(e); }
    finally { if (seq === searchSeq.current) setSearching(false); }
  };

  useEffect(() => {
    const t = setTimeout(() => searchUsers(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const setRelation = (id, relation) =>
    setResults((prev) => prev.map((u) => (u.id === id ? { ...u, relation } : u)));

  const handleSendRequest = async (userId) => {
    setRelation(userId, 'request_sent'); // optimistic
    try { await API.post(`/friends/request/${userId}`); }
    catch (e) { setRelation(userId, 'none'); console.error(e); }
  };
  const handleRemoveFriend = async (friendId) => {
    if (!(await confirm({ title: 'Remove this friend?', message: 'You will no longer be able to chat privately. You can send a new request later.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    try { await API.delete(`/friends/remove/${friendId}`); await refreshFriends(); toast('Friend removed.', 'success'); }
    catch (e) { console.error(e); toast('Could not remove friend. Please try again.', 'error'); }
  };
  const handleAccept = async (requestId, userId) => {
    try {
      await API.put(`/friends/accept/${requestId}`);
      if (userId) setRelation(userId, 'friends');
      await Promise.all([refreshFriends(), refreshRequests()]);
    } catch (e) { console.error(e); }
  };
  const handleReject = async (requestId, userId) => {
    try {
      await API.put(`/friends/reject/${requestId}`);
      if (userId) setRelation(userId, 'none');
      await refreshRequests();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="friends-page">
      <div className="home-bg-gradient"></div>
      <div className="home-bg-orbs">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>
      <BackButton />
      <div className="friends-content">
        <header className="friends-header glass-panel">
          <div>
            <span className="pg-eyebrow">FRIEND SYSTEM</span>
            <h1 className="friends-title">Connect with your <span className="friends-accent">fitness squad</span></h1>
            <p className="friends-sub">Search users, send requests, and start private chats with friends in your community.</p>
          </div>
          <div className="friends-header-stats">
            <div className="fh-stat">
              <span className="fh-stat-val">{friendsLoaded ? friends.length : '–'}</span>
              <span className="fh-stat-lbl">Friends</span>
            </div>
            <div className="fh-divider"/>
            <div className="fh-stat">
              <span className="fh-stat-val">{requests.length}</span>
              <span className="fh-stat-lbl">Requests</span>
            </div>
          </div>
        </header>

        {requests.length > 0 && (
          <section className="friends-requests glass-panel">
            <div className="friends-section-title"><Icon name="inbox" size={16} /> Incoming Requests</div>
            <div className="friends-requests-grid">
              {requests.map((req) => (
                <div key={req.requestId} className="freq-card">
                  <div className="freq-avatar">{req.sender.full_name?.charAt(0) || 'U'}</div>
                  <div className="freq-info">
                    <strong>{req.sender.full_name}</strong>
                    <span>{req.sender.email}</span>
                  </div>
                  <div className="freq-actions">
                    <button className="friends-btn-primary" onClick={() => handleAccept(req.requestId, req.sender.id)}>Accept</button>
                    <button className="friends-btn-secondary" onClick={() => handleReject(req.requestId, req.sender.id)}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="friends-grid">
          <section className="friends-search glass-panel">
            <div className="friends-section-title"><Icon name="search" size={16} /> Find People</div>
            <div className="friends-search-wrap">
              <span className="friends-search-icon"><Icon name="search" size={16} /></span>
              <input
                className="friends-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, username or email"
              />
            </div>
            <div className="friends-search-results">
              {query.trim().length === 0 && (
                <EmptyState icon="userPlus" title="Find your fitness squad" text="Search by name, username or email to send a friend request." />
              )}
              {query.trim().length === 1 && <p className="friends-hint">Type at least 2 characters…</p>}
              {searching && (
                <div className="friends-list"><Skeleton /><Skeleton /></div>
              )}
              {!searching && results.length === 0 && query.trim().length >= 2 && (
                <EmptyState compact icon="search" title="No matches found" text="Check the spelling or try a different name or email." />
              )}
              {results.map((user) => (
                <div key={user.id} className="friends-result-card">
                  <div className="friends-result-avatar">{user.full_name?.charAt(0) || 'U'}</div>
                  <div className="friends-result-info">
                    <strong>{user.full_name}</strong>
                    <span>{user.email}</span>
                  </div>
                  <div className="friends-result-action">
                    {user.relation === 'friends' ? (
                      <button className="friends-btn-secondary" disabled>✓ Friends</button>
                    ) : user.relation === 'request_sent' ? (
                      <button className="friends-btn-secondary" disabled>Sent</button>
                    ) : user.relation === 'request_received' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        {/* was passing the USER id here, but the API needs the REQUEST id */}
                        <button className="friends-btn-primary small" onClick={() => handleAccept(user.request_id, user.id)}>Accept</button>
                        <button className="friends-btn-secondary small" onClick={() => handleReject(user.request_id, user.id)}>Decline</button>
                      </div>
                    ) : (
                      <button className="friends-btn-primary" onClick={() => handleSendRequest(user.id)}>+ Add</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="friends-list-panel glass-panel">
            <div className="friends-section-title"><Icon name="users" size={16} /> Your Friends ({friendsLoaded ? friends.length : '…'})</div>
            {!friendsLoaded ? (
              <div className="friends-list"><Skeleton /><Skeleton /><Skeleton /></div>
            ) : friends.length === 0 ? (
              <EmptyState icon="users" title="No friends yet" text="Use Find People to search for other members and send your first request." />
            ) : (
              <div className="friends-list">
                {friends.map((friend) => (
                  <div key={friend.id} className="friend-card">
                    <Avatar name={friend.full_name} online={!!friend.online} size={44} />
                    <div className="friend-info">
                      <strong>{friend.full_name}</strong>
                      <span className={friend.online ? 'friend-online-text' : ''}>
                        {friend.online ? 'Online now' : (lastSeenText(friend.last_active) || friend.username || friend.email)}
                      </span>
                    </div>
                    <div className="friend-actions">
                      <button className="friends-btn-primary small" onClick={() => openChat(friend.id)}>
                        <Icon name="message" size={14} /> Chat{friend.unread_count > 0 ? ` (${friend.unread_count})` : ''}
                      </button>
                      <button className="friends-btn-secondary small" onClick={() => handleRemoveFriend(friend.id)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default Friends;
