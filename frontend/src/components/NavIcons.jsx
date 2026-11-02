import React, { useEffect, useState, useRef } from 'react';
import API from '../services/api';
import { useChat } from './ChatContext';
import Icon from './Icon';
import Avatar from './Avatar';
import './NavIcons.css';

// Top-bar quick actions: messages + friend-request notifications.
// Unread count + friend requests come from ChatContext (kept live over the socket).
const NavIcons = () => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
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
      <button className="nav-icon-btn chat-toggle-btn hide-on-mobile" onClick={() => openChat()} aria-label="Messages">
        <Icon name="message" size={19} />
        {totalUnread > 0 && <span className="notification-badge">{totalUnread > 9 ? '9+' : totalUnread}</span>}
      </button>

      <button className="nav-icon-btn notification-btn" onClick={() => setDropdownOpen((prev) => !prev)} aria-label="Notifications" aria-expanded={dropdownOpen}>
        <Icon name="bell" size={19} />
        {requests.length > 0 && <span className="notification-badge">{requests.length}</span>}
      </button>

      {dropdownOpen && (
        <div className="notification-dropdown">
          <h4>Friend requests</h4>
          {requests.length === 0 ? (
            <div className="notification-empty"><Icon name="check" size={16} /> You’re all caught up</div>
          ) : (
            requests.map((req) => (
              <div className="notification-card" key={req.requestId}>
                <Avatar name={req.sender.full_name} size={38} showPresence={false} />
                <div className="notification-who">
                  <strong>{req.sender.full_name}</strong>
                  <p>{req.sender.email}</p>
                </div>
                <div className="notification-actions">
                  <button className="na-accept" onClick={() => handleAccept(req.requestId)}>Accept</button>
                  <button className="na-reject" onClick={() => handleReject(req.requestId)} aria-label="Reject request"><Icon name="x" size={15} /></button>
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
