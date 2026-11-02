import React, { useEffect, useRef, useState } from 'react';
import API from '../services/api';
import { useChat } from '../components/ChatContext';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import ChallengesPanel, { useStartChallenge } from '../components/Challenges';
import { lastSeenText } from '../utils/time';
import './Friends.css';
import '../components/Engage.css';

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
  const [tab, setTab] = useState('friends');   // phones show one panel at a time
  const { confirm, toast } = useFeedback();
  const [chKey, setChKey] = useState(0);
  const startChallenge = useStartChallenge(() => setChKey((k) => k + 1));

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
      <div className="friends-content">
        <header className="page-head friends-header">
          <div>
            <h1>Friends</h1>
            <p>Find people, accept requests and start a private chat.</p>
          </div>
          <div className="friends-header-stats">
            <span className="chip"><Icon name="users" size={14} /> {friendsLoaded ? friends.length : '–'} friends</span>
            {requests.length > 0 && <span className="chip brand"><Icon name="inbox" size={14} /> {requests.length} new</span>}
          </div>
        </header>

        {requests.length > 0 && (
          <section className="friends-requests card">
            <div className="friends-section-title"><Icon name="inbox" size={17} /> Friend requests</div>
            <div className="friends-requests-grid">
              {requests.map((req) => (
                <div key={req.requestId} className="freq-card">
                  <Avatar name={req.sender.full_name} size={44} showPresence={false} />
                  <div className="freq-info">
                    <strong>{req.sender.full_name}</strong>
                    <span>{req.sender.email}</span>
                  </div>
                  <div className="freq-actions">
                    <button className="friends-btn-primary small" onClick={() => handleAccept(req.requestId, req.sender.id)}>Accept</button>
                    <button className="friends-btn-secondary small" onClick={() => handleReject(req.requestId, req.sender.id)}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <ChallengesPanel refreshKey={chKey} />

        <div className="friends-tabs" role="tablist" aria-label="Friends sections">
          <button role="tab" aria-selected={tab === 'friends'} className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')}>Your friends</button>
          <button role="tab" aria-selected={tab === 'find'} className={tab === 'find' ? 'on' : ''} onClick={() => setTab('find')}>Find people</button>
        </div>

        <div className="friends-grid">
          <section className={`friends-list-panel card ${tab === 'friends' ? 'is-active' : ''}`}>
            <div className="friends-section-title"><Icon name="users" size={17} /> Your friends <span className="friends-count">{friendsLoaded ? friends.length : '…'}</span></div>
            {!friendsLoaded ? (
              <div className="friends-list"><Skeleton /><Skeleton /><Skeleton /></div>
            ) : friends.length === 0 ? (
              <EmptyState icon="users" title="No friends yet" text="Search for other members and send your first request."
                action={<button type="button" className="friends-btn-primary" onClick={() => setTab('find')}>Find people</button>} />
            ) : (
              <div className="friends-list">
                {friends.map((friend) => (
                  <div key={friend.id} className="friend-card">
                    <Avatar name={friend.full_name} online={!!friend.online} size={46} />
                    <div className="friend-info">
                      <strong>{friend.full_name}</strong>
                      <span className={friend.online ? 'friend-online-text' : ''}>
                        {friend.online ? 'Online now' : (lastSeenText(friend.last_active) || friend.username || friend.email)}
                      </span>
                    </div>
                    <div className="friend-actions">
                      <button className="friends-btn-primary small" onClick={() => openChat(friend.id)}>
                        <Icon name="message" size={15} /> Chat{friend.unread_count > 0 ? <span className="friend-unread">{friend.unread_count}</span> : null}
                      </button>
                      <button className="friends-btn-secondary small friend-challenge-btn" onClick={() => startChallenge(friend)} title="Most minutes this week">
                        <Icon name="swords" size={15} /> Challenge
                      </button>
                      <button className="friends-btn-secondary small icon" onClick={() => handleRemoveFriend(friend.id)} aria-label={`Remove ${friend.full_name}`} title="Remove friend">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={`friends-search card ${tab === 'find' ? 'is-active' : ''}`}>
            <div className="friends-section-title"><Icon name="search" size={17} /> Find people</div>
            <div className="friends-search-wrap">
              <span className="friends-search-icon"><Icon name="search" size={17} /></span>
              <input
                className="friends-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, username or email"
                autoComplete="off"
              />
            </div>
            <div className="friends-search-results">
              {query.trim().length === 0 && (
                <EmptyState compact icon="userPlus" title="Search for members" text="Type a name, username or email to send a friend request." />
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
                  <Avatar name={user.full_name} size={42} showPresence={false} />
                  <div className="friends-result-info">
                    <strong>{user.full_name}</strong>
                    <span>{user.email}</span>
                  </div>
                  <div className="friends-result-action">
                    {user.relation === 'friends' ? (
                      <button className="friends-btn-secondary small" disabled><Icon name="check" size={14} /> Friends</button>
                    ) : user.relation === 'request_sent' ? (
                      <button className="friends-btn-secondary small" disabled>Request sent</button>
                    ) : user.relation === 'request_received' ? (
                      <div className="friends-result-pair">
                        {/* the API needs the REQUEST id here, not the user id */}
                        <button className="friends-btn-primary small" onClick={() => handleAccept(user.request_id, user.id)}>Accept</button>
                        <button className="friends-btn-secondary small" onClick={() => handleReject(user.request_id, user.id)}>Decline</button>
                      </div>
                    ) : (
                      <button className="friends-btn-primary small" onClick={() => handleSendRequest(user.id)}><Icon name="plus" size={15} /> Add</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Friends;
