import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useChat } from './ChatContext';
import { formatClock, lastSeenText } from '../utils/time';
import Icon from './Icon';
import EmptyState from './EmptyState';
import TypingIndicator from './TypingIndicator';
import useTypingEmitter from './useTypingEmitter';
import './ChatPanel.css';

const ChatPanel = () => {
  const { isOpen, closeChat, conversations, friendsLoaded, activeConversation, selectConversation, messages, sendMessage, retryMessage, typing, sendTyping } = useChat();
  const myId = (() => { try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.id || u._id || null; } catch { return null; } })();
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef(null);
  const { onInput: emitTyping, stop: stopTyping } = useTypingEmitter(activeConversation, sendTyping);

  const activeMessages = useMemo(
    () => (activeConversation ? (messages[activeConversation]?.items || []) : []),
    [messages, activeConversation]
  );

  const activeFriend = useMemo(
    () => conversations.find(c => c.id === activeConversation) || null,
    [conversations, activeConversation]
  );

  const lastId = activeMessages.length ? activeMessages[activeMessages.length - 1].id : null;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lastId, activeConversation]);

  const friendTyping = !!(activeConversation && typing[activeConversation]);
  useEffect(() => {
    if (friendTyping) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [friendTyping]);

  if (!isOpen) return null;

  const handleSelect = (id) => selectConversation(id);

  const handleSend = () => {
    if (!draft.trim() || !activeConversation) return;
    sendMessage(activeConversation, draft.trim());   // optimistic: input clears instantly
    setDraft('');
    stopTyping();
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
            {activeFriend ? activeFriend.full_name?.charAt(0)?.toUpperCase() : <Icon name="message" size={18} />}
            {activeFriend && <span className={`convo-dot ${activeFriend.online ? 'online' : 'offline'}`} />}
          </div>
          <div className="header-info">
            <div className="header-name">{activeFriend ? activeFriend.full_name : 'Messages'}</div>
            {activeFriend && (
              <div className={`header-status ${activeFriend.online ? 'online' : ''}`}>
                {friendTyping ? <TypingIndicator inline /> : activeFriend.online ? '● Online' : (lastSeenText(activeFriend.last_active) || '○ Offline')}
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
          {!friendsLoaded ? (
            <div className="convo-empty">Loading…</div>
          ) : conversations.length === 0 ? (
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
                    <div className="convo-preview">{typing[c.id] ? <TypingIndicator inline /> : (c.last_message || (c.online ? 'Online' : 'Offline'))}</div>
                  </div>
                  {c.unread_count > 0 && <span className="chat-unread-badge">{c.unread_count > 9 ? '9+' : c.unread_count}</span>}
                </button>
              );
            })
          )}
        </aside>

        {/* Message area */}
        <div className="message-area">
          <div className="messages-scroll">
            {!activeConversation ? (
              <EmptyState compact icon="users" title="Pick a friend" text="Choose someone on the left to start chatting." />
            ) : activeMessages.length === 0 ? (
              <EmptyState compact icon="message" title="No messages yet" text="Say hi and start the conversation." />
            ) : (
              activeMessages.map((m, i) => {
                const isSent = m.sender === myId;
                return (
                  <div key={m.clientId || m.id || i} className={`msg ${isSent ? 'sent' : 'received'}`} style={m.pending ? { opacity: 0.6 } : undefined}>
                    <div className="msg-text">{m.message}</div>
                    <div className="msg-ts">
                      {m.failed
                        ? <button type="button" onClick={() => retryMessage(activeConversation, m.clientId)} style={{background:'none',border:0,color:'#f87171',cursor:'pointer',textDecoration:'underline',font:'inherit',padding:0}}>Failed – retry</button>
                        : m.pending ? 'Sending…' : formatClock(m.timestamp)}
                    </div>
                  </div>
                );
              })
            )}
            {friendTyping && <TypingIndicator name={activeFriend?.full_name} />}
            <div ref={messagesEndRef} />
          </div>

          <div className="message-input">
            <input
              value={draft}
              onChange={(e) => { setDraft(e.target.value); emitTyping(e.target.value); }}
              onKeyDown={handleKeyDown}
              placeholder={activeFriend ? `Message ${activeFriend.full_name}…` : 'Select a friend…'}
              disabled={!activeConversation}
            />
            <button
              className={`send-small ${draft.trim() ? 'active' : ''}`}
              onClick={handleSend}
              disabled={!draft.trim() || !activeConversation}
            >
              <Icon name="send" size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
