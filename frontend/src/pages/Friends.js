import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';
import BackButton from '../components/BackButton';
import { useChat } from '../components/ChatContext';
import './Friends.css';

const Friends = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const { openChat } = useChat();

  const loadFriends = async () => {
    try {
      const response = await API.get('/friends/list');
      setFriends((response.data.friends || []).filter(f => f != null));
    } catch (e) { console.error(e); }
  };

  const loadRequests = async () => {
    try {
      const response = await API.get('/friends/requests');
      setRequests((response.data.requests || []).filter(r => r.sender != null));
    } catch (e) { console.error(e); }
  };

  const searchUsers = async (value) => {
    if (!value.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const response = await API.get(`/users/search?query=${encodeURIComponent(value)}`);
      setResults((response.data.users || []).filter(u => u != null));
    } catch (e) { console.error(e); }
    finally { setSearching(false); }
  };

  useEffect(() => { loadFriends(); loadRequests(); }, []);
  useEffect(() => {
    const t = setTimeout(() => searchUsers(query), 220);
    return () => clearTimeout(t);
  }, [query]);

  const handleSendRequest = async (userId) => {
    try { await API.post(`/friends/request/${userId}`); searchUsers(query); } catch (e) { console.error(e); }
  };
  const handleRemoveFriend = async (friendId) => {
    try { await API.delete(`/friends/remove/${friendId}`); loadFriends(); } catch (e) { console.error(e); }
  };
  const handleAccept = async (requestId) => {
    try { await API.put(`/friends/accept/${requestId}`); loadFriends(); loadRequests(); } catch (e) { console.error(e); }
  };
  const handleReject = async (requestId) => {
    try { await API.put(`/friends/reject/${requestId}`); loadRequests(); } catch (e) { console.error(e); }
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
        {/* Header */}
        <header className="friends-header glass-panel">
          <div>
            <span className="pg-eyebrow">FRIEND SYSTEM</span>
            <h1 className="friends-title">Connect with your <span className="friends-accent">fitness squad</span></h1>
            <p className="friends-sub">Search users, send requests, and start private chats with friends in your community.</p>
          </div>
          <div className="friends-header-stats">
            <div className="fh-stat">
              <span className="fh-stat-val">{friends.length}</span>
              <span className="fh-stat-lbl">Friends</span>
            </div>
            <div className="fh-divider"/>
            <div className="fh-stat">
              <span className="fh-stat-val">{requests.length}</span>
              <span className="fh-stat-lbl">Requests</span>
            </div>
          </div>
        </header>

        {/* Pending requests (shown only if any) */}
        {requests.length > 0 && (
          <section className="friends-requests glass-panel">
            <div className="friends-section-title">📬 Incoming Requests</div>
            <div className="friends-requests-grid">
              {requests.map(req => (
                <div key={req.requestId} className="freq-card">
                  <div className="freq-avatar">{req.sender.full_name?.charAt(0) || 'U'}</div>
                  <div className="freq-info">
                    <strong>{req.sender.full_name}</strong>
                    <span>{req.sender.email}</span>
                  </div>
                  <div className="freq-actions">
                    <button className="friends-btn-primary" onClick={() => handleAccept(req.requestId)}>Accept</button>
                    <button className="friends-btn-secondary" onClick={() => handleReject(req.requestId)}>Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="friends-grid">
          {/* Search */}
          <section className="friends-search glass-panel">
            <div className="friends-section-title">🔍 Find People</div>
            <div className="friends-search-wrap">
              <span className="friends-search-icon">🔍</span>
              <input
                className="friends-search-input"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by name, username or email"
              />
            </div>
            <div className="friends-search-results">
              {searching && <p className="friends-hint">Searching...</p>}
              {!searching && results.length === 0 && query.trim() && <p className="friends-hint">No matches found.</p>}
              {results.map(user => (
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
                      <div style={{display:'flex',gap:6}}>
                        <button className="friends-btn-primary small" onClick={() => handleAccept(user.id)}>Accept</button>
                        <button className="friends-btn-secondary small" onClick={() => handleReject(user.id)}>Decline</button>
                      </div>
                    ) : (
                      <button className="friends-btn-primary" onClick={() => handleSendRequest(user.id)}>+ Add</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Friend list */}
          <section className="friends-list-panel glass-panel">
            <div className="friends-section-title">👥 Your Friends ({friends.length})</div>
            {friends.length === 0 ? (
              <div className="friends-empty">
                <span>🤝</span>
                <p>No friends yet. Search above to find and connect with other users.</p>
              </div>
            ) : (
              <div className="friends-list">
                {friends.map(friend => (
                  <div key={friend.id} className="friend-card">
                    <div className="friend-avatar">{friend.full_name?.charAt(0) || 'F'}</div>
                    <div className="friend-info">
                      <strong>{friend.full_name}</strong>
                      <span>{friend.username || friend.email}</span>
                    </div>
                    <div className="friend-actions">
                      <button className="friends-btn-primary small" onClick={() => openChat(friend.id)}>💬 Chat</button>
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
