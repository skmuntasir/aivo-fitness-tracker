import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useChat } from './ChatContext';
import Icon from './Icon';
import './NavIcons.css';

// Unread count + friend requests now come from ChatContext (kept live over the socket),
// instead of this component polling the server every 30s.
const NavIcons = () => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);
  const { openChat, totalUnread, requests, refreshRequests, refreshFriends } = useChat();

  useEffect(() => {
    const onBodyClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onBodyClick);
    return () => document.removeEventListener('mousedown', onBodyClick);
  }, []);

  const handleAccept = async (requestId) => {
    try { await API.put(`/friends/accept/${requestId}`); await Promise.all([refreshRequests(), refreshFriends()]); } catch { /* ignore */ }
  };
  const handleReject = async (requestId) => {
    try { await API.put(`/friends/reject/${requestId}`); await refreshRequests(); } catch { /* ignore */ }
  };

  return (
    <div className="nav-icons-wrapper" ref={ref}>
      <button className="nav-icon-btn" onClick={() => navigate('/friends')} aria-label="Friends"><Icon name="users" size={18} /></button>

      <button className="nav-icon-btn chat-toggle-btn" onClick={() => openChat()} aria-label="Chat">
        <Icon name="message" size={18} />
        {totalUnread > 0 && (
          <span className="notification-badge msg-badge">{totalUnread > 9 ? '9+' : totalUnread}</span>
        )}
      </button>

      <button className="nav-icon-btn notification-btn" onClick={() => setDropdownOpen((prev) => !prev)} aria-label="Notifications">
        <Icon name="bell" size={18} />
        {requests.length > 0 && <span className="notification-badge">{requests.length}</span>}
      </button>

      {dropdownOpen && (
        <div className="notification-dropdown">
          <h4>Friend Requests</h4>
          {requests.length === 0 ? (
            <div className="notification-empty">No new requests</div>
          ) : (
            requests.map((req) => (
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
