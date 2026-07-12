import React, { useEffect, useRef, useState } from 'react';
import API from '../services/api';
import './ChatSidebar.css';

const ChatSidebar = ({ open, onClose }) => {
  const [friends, setFriends] = useState([]);
  const [query, setQuery] = useState('');
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    loadFriends();
  }, [open]);

  useEffect(() => {
    if (selectedFriend) loadMessages(selectedFriend.id);
  }, [selectedFriend]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadFriends = async () => {
    try {
      const response = await API.get('/friends/list');
      const list = response.data.friends || [];
      setFriends(list);
      if (!selectedFriend && list.length) setSelectedFriend(list[0]);
    } catch (error) {
      console.error('Failed to load chat friends', error);
    }
  };

  const loadMessages = async (friendId) => {
    if (!friendId) return;
    setChatLoading(true);
    try {
      const response = await API.get(`/messages/${friendId}`);
      setMessages(response.data.messages || []);
    } catch (error) {
      console.error('Failed to load messages', error);
      setMessages([]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedFriend || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    try {
      await API.post('/messages', { receiverId: selectedFriend.id, message: text });
      await loadMessages(selectedFriend.id);
    } catch (error) {
      console.error('Failed to send message', error);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const filteredFriends = friends.filter((f) =>
    f.full_name?.toLowerCase().includes(query.toLowerCase()) ||
    f.username?.toLowerCase().includes(query.toLowerCase())
  );

  if (!open) return null;

  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('user')) || {}; } catch { return {}; } })();

  return (
    <div className="chat-sidebar-overlay" onClick={onClose}>
      <div className="chat-sidebar-panel" onClick={(e) => e.stopPropagation()}>

        {/* Left Column: Friends list */}
        <aside className="friends-column">
          <div className="friends-column-header">
            <span className="friends-column-title">Direct Messages</span>
            <button className="close-button" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="friends-search-wrap">
            <input
              type="text"
              placeholder="Find a conversation"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="friends-search-input"
            />
          </div>
          <div className="friends-section-label">Friends — {filteredFriends.length}</div>
          <div className="friends-list-scroll">
            {filteredFriends.length === 0 ? (
              <div className="no-friends-hint">No friends found.</div>
            ) : (
              filteredFriends.map((friend) => {
                const isActive = selectedFriend?.id === friend.id;
                const initial = friend.full_name?.charAt(0)?.toUpperCase() || '?';
                return (
                  <button
                    key={friend.id}
                    className={`friend-row ${isActive ? 'active' : ''}`}
                    onClick={() => setSelectedFriend(friend)}
                  >
                    <div className="friend-avatar-wrap">
                      <div className="friend-avatar">{initial}</div>
                      <span className={`presence-dot ${friend.online ? 'online' : 'offline'}`} />
                    </div>
                    <div className="friend-info">
                      <span className="friend-name">{friend.full_name}</span>
                      <span className="friend-sub">{friend.online ? 'Online' : 'Offline'}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Column: Conversation */}
        <main className="conversation-column">
          {selectedFriend ? (
            <>
              <div className="conversation-topbar">
                <div className="conv-friend-avatar">
                  {selectedFriend.full_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <div className="conv-friend-name">{selectedFriend.full_name}</div>
                  <div className={`conv-friend-status ${selectedFriend.online ? 'online' : ''}`}>
                    {selectedFriend.online ? '● Online' : '○ Offline'}
                  </div>
                </div>
              </div>

              <div className="messages-body">
                {chatLoading ? (
                  <div className="msg-placeholder">Loading messages…</div>
                ) : messages.length === 0 ? (
                  <div className="msg-placeholder">
                    <div className="empty-conv-avatar">{selectedFriend.full_name?.charAt(0)?.toUpperCase()}</div>
                    <p>This is the beginning of your conversation with <strong>{selectedFriend.full_name}</strong>.</p>
                  </div>
                ) : (
                  messages.map((msg, i) => {
                    const isSent = msg.sender !== selectedFriend.id;
                    return (
                      <div key={msg.id || i} className={`msg-row ${isSent ? 'sent' : 'received'}`}>
                        {!isSent && (
                          <div className="msg-avatar">{selectedFriend.full_name?.charAt(0)?.toUpperCase()}</div>
                        )}
                        <div className="msg-content-wrap">
                          <div className={`msg-bubble ${isSent ? 'bubble-sent' : 'bubble-received'}`}>
                            {msg.message}
                          </div>
                          <div className="msg-time">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="message-input-bar">
                <textarea
                  className="message-draft"
                  placeholder={`Message ${selectedFriend.full_name}`}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                />
                <button
                  className={`send-btn ${draft.trim() ? 'active' : ''}`}
                  onClick={handleSendMessage}
                  disabled={!draft.trim()}
                >
                  ➤
                </button>
              </div>
            </>
          ) : (
            <div className="no-conv-selected">
              <div className="no-conv-icon">💬</div>
              <h3>Select a friend to start chatting</h3>
              <p>Pick someone from the left to begin a conversation.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default ChatSidebar;
