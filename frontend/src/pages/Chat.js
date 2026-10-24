import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { useChat } from '../components/ChatContext';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import TypingIndicator from '../components/TypingIndicator';
import useTypingEmitter from '../components/useTypingEmitter';
import { formatClock, lastSeenText } from '../utils/time';
import './Chat.css';

const getMyId = () => {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.id || u._id || null; } catch { return null; }
};

const Chat = () => {
  const { friendId } = useParams();
  const navigate = useNavigate();
  const {
    conversations, friendsLoaded, messages, loadMessages, sendMessage, retryMessage,
    sendTyping, typing, selectConversation, setActiveConversation, setPageActive, connected,
  } = useChat();

  const [text, setText] = useState('');
  const bottomRef = useRef(null);
  const { onInput: emitTyping, stop: stopTyping } = useTypingEmitter(friendId, sendTyping);
  const myId = useMemo(getMyId, []);

  const friend = conversations.find((c) => c.id === friendId) || null;
  const bucket = messages[friendId];
  const items = bucket?.items || [];
  const lastId = items.length ? items[items.length - 1].id : null;

  // One shared socket lives in ChatContext; this page just selects a conversation.
  useEffect(() => {
    setPageActive(true);
    return () => { setPageActive(false); setActiveConversation(null); };
  }, [setPageActive, setActiveConversation]);

  useEffect(() => {
    if (friendId) selectConversation(friendId);
  }, [friendId, selectConversation]);

  // Scroll to bottom for new messages / conversation switch only (not when loading older ones).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lastId, friendId]);

  // Keep the "is typing" bubble in view when it appears
  const friendTyping = !!typing[friendId];
  useEffect(() => {
    if (friendTyping) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [friendTyping]);

  const handleSend = () => {
    const body = text.trim();
    if (!body || !friendId) return;
    sendMessage(friendId, body);
    setText('');
    stopTyping();
  };

  const handleChange = (value) => {
    setText(value);
    emitTyping(value);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="chat-page">
      <div className="chat-background"></div>
      <BackButton />
      <div className="chat-shell glass-panel">
        <div className="chat-grid">
          <aside className="chat-friends-panel">
            <div className="friends-panel-header">
              <span>Active Chats</span>
              <h2>Your squad</h2>
            </div>
            <div className="friends-scroll">
              {!friendsLoaded ? (
                [0, 1, 2].map((i) => <div key={i} className="chat-skeleton-row" />)
              ) : conversations.length === 0 ? (
                <EmptyState compact icon="users" title="No friends yet" text="Add someone from the Friends page to start chatting."
                  action={<button type="button" className="chat-empty-btn" onClick={() => navigate('/friends')}>Find friends</button>} />
              ) : (
                conversations.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`friend-preview ${item.id === friendId ? 'active' : ''}`}
                    onClick={() => navigate(`/chat/${item.id}`)}
                  >
                    <Avatar name={item.full_name} online={!!item.online} size={44} />
                    <div className="friend-preview-meta">
                      <strong>{item.full_name}</strong>
                      <span>{item.online ? 'Online' : (item.username || item.email)}</span>
                      <small>{typing[item.id] ? <TypingIndicator inline /> : (item.last_message || 'Tap to continue the conversation')}</small>
                    </div>
                    {item.unread_count > 0 && (
                      <span className="chat-unread-badge">{item.unread_count > 9 ? '9+' : item.unread_count}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="chat-content-panel">
            <div className="chat-header chat-header-panel">
              <div className="chat-header-id">
                {friend && <Avatar name={friend.full_name} online={!!friend.online} size={46} />}
                <div>
                  <span className="page-chip">Direct Message</span>
                  <h1>{friend ? friend.full_name : friendsLoaded ? 'Select a friend' : '…'}</h1>
                </div>
              </div>
              {friend && (
                <div className={`chat-status ${friend.online ? 'is-online' : ''}`}>
                  <span className={`status-dot ${friend.online ? 'online' : 'offline'}`} />
                  {friendTyping ? <TypingIndicator inline />
                    : friend.online ? 'Online' : (lastSeenText(friend.last_active) || 'Offline')}
                </div>
              )}
            </div>

            {!connected && friend && (
              <div className="chat-conn-banner" role="status"><Icon name="wifiOff" size={14} /> Reconnecting… messages will send over a slower fallback and online status may be out of date.</div>
            )}

            <div className="chat-body">
              <div className="messages-panel">
                {bucket?.hasMore && (
                  <button type="button" className="load-older-btn" onClick={() => loadMessages(friendId, { older: true })}>
                    Load earlier messages
                  </button>
                )}
                {!bucket?.loaded ? (
                  <div className="chat-msg-skeleton">
                    <div className="sk" style={{ width: '46%', height: 44 }} />
                    <div className="sk" style={{ width: '38%', height: 44, alignSelf: 'flex-end' }} />
                    <div className="sk" style={{ width: '55%', height: 44 }} />
                  </div>
                ) : items.length === 0 ? (
                  <EmptyState icon="message" title="No messages yet" text={friend ? `Say hi to ${friend.full_name.split(' ')[0]} — send the first note.` : 'Send the first note.'} />
                ) : (
                  items.map((message) => {
                    const mine = message.sender === myId;
                    return (
                      <div
                        key={message.clientId || message.id}
                        className={`message-bubble ${mine ? 'sent' : 'received'} ${message.pending ? 'pending' : ''} ${message.failed ? 'failed' : ''}`}
                      >
                        <p>{message.message}</p>
                        <span>
                          {message.failed ? (
                            <button type="button" className="retry-btn" onClick={() => retryMessage(friendId, message.clientId)}>Failed – tap to retry</button>
                          ) : message.pending ? 'Sending…' : formatClock(message.timestamp)}
                        </span>
                      </div>
                    );
                  })
                )}
                {friendTyping && <TypingIndicator name={friend?.full_name} />}
                <div ref={bottomRef} />
              </div>
            </div>

            <div className="chat-controls">
              <textarea
                value={text}
                onChange={(e) => handleChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Write your message..."
                maxLength={2000}
              />
              <button className="send-btn" onClick={handleSend} disabled={!text.trim()}><Icon name="send" size={16} /> Send</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Chat;
