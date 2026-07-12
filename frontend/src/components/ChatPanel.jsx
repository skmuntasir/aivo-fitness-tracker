import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useChat } from './ChatContext';
import './ChatPanel.css';

const ChatPanel = () => {
  const { isOpen, closeChat, conversations, activeConversation, setActiveConversation, messages, loadMessages, sendMessage } = useChat();
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef(null);

  const activeMessages = useMemo(
    () => (activeConversation ? (messages[activeConversation] || []) : []),
    [messages, activeConversation]
  );

  const activeFriend = useMemo(
    () => conversations.find(c => c.id === activeConversation) || null,
    [conversations, activeConversation]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages]);

  if (!isOpen) return null;

  const handleSelect = async (id) => {
    setActiveConversation(id);
    await loadMessages(id);
  };

  const handleSend = async () => {
    if (!draft.trim() || !activeConversation) return;
    await sendMessage(activeConversation, draft.trim());
    setDraft('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-panel-header">
        <div className="header-left">
          <div className="header-avatar">
            {activeFriend ? activeFriend.full_name?.charAt(0)?.toUpperCase() : '💬'}
          </div>
          <div className="header-info">
            <div className="header-name">{activeFriend ? activeFriend.full_name : 'Messages'}</div>
            {activeFriend && (
              <div className={`header-status ${activeFriend.online ? 'online' : ''}`}>
                {activeFriend.online ? '● Online' : '○ Offline'}
              </div>
            )}
          </div>
        </div>
        <button className="chat-close" onClick={closeChat} aria-label="Close">×</button>
      </div>

      {/* Body */}
      <div className="chat-panel-body">
        {/* Friends list */}
        <aside className="convo-list">
          <div className="convo-list-title">Friends</div>
          {conversations.length === 0 ? (
            <div className="convo-empty">No friends yet</div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeConversation;
              return (
                <button
                  key={c.id}
                  className={`convo-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleSelect(c.id)}
                  title={c.full_name}
                >
                  <div className="convo-avatar">
                    {c.full_name?.charAt(0)?.toUpperCase() || '?'}
                    <span className={`convo-dot ${c.online ? 'online' : 'offline'}`} />
                  </div>
                  <div className="convo-meta">
                    <div className="convo-name">{c.full_name}</div>
                    <div className="convo-preview">{c.online ? 'Online' : 'Offline'}</div>
                  </div>
                </button>
              );
            })
          )}
        </aside>

        {/* Message area */}
        <div className="message-area">
          <div className="messages-scroll">
            {!activeConversation ? (
              <div className="msg-placeholder">Select a friend to chat</div>
            ) : activeMessages.length === 0 ? (
              <div className="msg-placeholder">No messages yet. Say hi!</div>
            ) : (
              activeMessages.map((m, i) => {
                const isSent = m.sender !== activeConversation;
                return (
                  <div key={m.id || i} className={`msg ${isSent ? 'sent' : 'received'}`}>
                    <div className="msg-text">{m.message}</div>
                    <div className="msg-ts">
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="message-input">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeFriend ? `Message ${activeFriend.full_name}…` : 'Select a friend…'}
              disabled={!activeConversation}
            />
            <button
              className={`send-small ${draft.trim() ? 'active' : ''}`}
              onClick={handleSend}
              disabled={!draft.trim() || !activeConversation}
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
