import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useChat } from './ChatContext';
import './NavIcons.css';

const NavIcons = () => {
  const [requests, setRequests] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);
  const { openChat } = useChat();

  const loadRequests = async () => {
    try {
      const response = await API.get('/friends/requests');
      const allRequests = response.data.requests || [];
      setRequests(allRequests.filter(req => req.sender != null));
    } catch { console.error('Failed to load requests'); }
  };

  const loadUnreadMessages = async () => {
    try {
      const response = await API.get('/messages/unread-count');
      setUnreadCount(response.data.unread_count || 0);
    } catch {
      // silently fail — badge just won't show if endpoint isn't up yet
      setUnreadCount(0);
    }
  };

  useEffect(() => {
    loadRequests();
    loadUnreadMessages();
    // Poll for new messages every 30s
    const interval = setInterval(loadUnreadMessages, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const onBodyClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onBodyClick);
    return () => document.removeEventListener('mousedown', onBodyClick);
  }, []);

  const handleAccept = async (requestId) => {
    try { await API.put(`/friends/accept/${requestId}`); await loadRequests(); } catch { }
  };
  const handleReject = async (requestId) => {
    try { await API.put(`/friends/reject/${requestId}`); await loadRequests(); } catch { }
  };

  const handleOpenChat = () => {
    setUnreadCount(0); // optimistically clear badge
    openChat();
  };

  const badgeCount = requests.length;

  return (
    <div className="nav-icons-wrapper" ref={ref}>
      {/* Friends */}
      <button className="nav-icon-btn" onClick={() => navigate('/friends')} aria-label="Friends">
        👥
      </button>

      {/* Messages with unread badge */}
      <button className="nav-icon-btn chat-toggle-btn" onClick={handleOpenChat} aria-label="Chat">
        💬
        {unreadCount > 0 && (
          <span className="notification-badge msg-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
        )}
      </button>

      {/* Notifications */}
      <button className="nav-icon-btn notification-btn" onClick={() => setDropdownOpen(prev => !prev)} aria-label="Notifications">
        🔔
        {badgeCount > 0 && <span className="notification-badge">{badgeCount}</span>}
      </button>

      {dropdownOpen && (
        <div className="notification-dropdown">
          <h4>Friend Requests</h4>
          {requests.length === 0 ? (
            <div className="notification-empty">No new requests</div>
          ) : (
            requests.map(req => (
              <div className="notification-card" key={req.requestId}>
                <div>
                  <strong>{req.sender.full_name}</strong>
                  <p>{req.sender.email}</p>
                </div>
                <div className="notification-actions">
                  <button onClick={() => handleAccept(req.requestId)}>Accept</button>
                  <button onClick={() => handleReject(req.requestId)}>Reject</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default NavIcons;
