import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useChat } from './ChatContext';
import { formatClock, lastSeenText, parseServerDate, localDateKey } from '../utils/time';
import Icon from './Icon';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import TypingIndicator from './TypingIndicator';
import useTypingEmitter from './useTypingEmitter';
import './ChatPanel.css';

// "Today" / "Yesterday" / "Mon, Oct 5" label for the day dividers
const dayLabel = (ts) => {
  const d = parseServerDate(ts);
  if (!d) return '';
  const key = localDateKey(d);
  const now = new Date();
  if (key === localDateKey(now)) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (key === localDateKey(y)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};
const GROUP_GAP_MS = 5 * 60 * 1000;   // messages from one person within 5 min read as one group

const ChatPanel = () => {
  const { isOpen, closeChat, conversations, friendsLoaded, activeConversation, selectConversation, messages, sendMessage, retryMessage, typing, sendTyping, setActiveConversation, totalUnread } = useChat();
  const totalUnreadCount = totalUnread || 0;
  const myId = (() => { try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.id || u._id || null; } catch { return null; } })();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
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

  const shownConvos = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conversations.filter((c) => (c.full_name || '').toLowerCase().includes(q)) : conversations;
  }, [conversations, query]);

  // Decorate each message: day divider above it? first / last of its group? (drives spacing, tails and timestamps)
  const rows = useMemo(() => activeMessages.map((m, i) => {
    const prev = activeMessages[i - 1];
    const next = activeMessages[i + 1];
    const t = parseServerDate(m.timestamp)?.getTime() || 0;
    const tp = prev ? (parseServerDate(prev.timestamp)?.getTime() || 0) : 0;
    const tn = next ? (parseServerDate(next.timestamp)?.getTime() || 0) : 0;
    const sameDay = (a, b) => !!a && !!b && localDateKey(parseServerDate(a)) === localDateKey(parseServerDate(b));
    const joinsPrev = !!prev && prev.sender === m.sender && sameDay(prev.timestamp, m.timestamp) && Math.abs(t - tp) < GROUP_GAP_MS;
    const joinsNext = !!next && next.sender === m.sender && sameDay(next.timestamp, m.timestamp) && Math.abs(tn - t) < GROUP_GAP_MS;
    const newDay = !prev || !sameDay(prev.timestamp, m.timestamp);
    return { m, joinsPrev, joinsNext, newDay };
  }), [activeMessages]);

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
    <div className={`chat-panel${activeConversation ? ' has-active' : ''}`} role="dialog" aria-label="Messages">
      {/* Header */}
      <div className="cp-header">
        {activeFriend && (
          <button className="cp-icon-btn cp-back" onClick={() => setActiveConversation(null)} aria-label="Back to conversations"><Icon name="arrowLeft" size={18} /></button>
        )}

        {/* Left: always shows the inbox title on desktop (list column), friend info shows over the thread */}
        <div className="cp-head-list">
          <span className="cp-head-ico"><Icon name="message" size={18} /></span>
          <div className="cp-head-text">
            <div className="cp-head-title">Messages</div>
            <div className="cp-head-sub">{totalUnreadCount ? `${totalUnreadCount} unread` : 'All caught up'}</div>
          </div>
        </div>

        <div className="cp-head-thread">
          {activeFriend ? (
            <>
              <Avatar name={activeFriend.full_name} online={!!activeFriend.online} size={40} />
              <div className="cp-head-text">
                <div className="cp-head-title">{activeFriend.full_name}</div>
                <div className={`cp-head-sub ${activeFriend.online && !friendTyping ? 'online' : ''}`}>
                  {friendTyping ? <TypingIndicator inline /> : activeFriend.online ? 'Online now' : (lastSeenText(activeFriend.last_active) || 'Offline')}
                </div>
              </div>
            </>
          ) : (
            <span className="cp-head-hint">Select a conversation</span>
          )}
        </div>

        <button className="cp-icon-btn cp-close" onClick={closeChat} aria-label="Close messages"><Icon name="x" size={18} /></button>
      </div>

      {/* Body */}
      <div className="cp-body">
        {/* Friends list */}
        <aside className="cp-list" aria-label="Conversations">
          <label className="cp-search">
            <Icon name="search" size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search friends" aria-label="Search friends" />
          </label>
          <div className="cp-list-scroll">
            {!friendsLoaded ? (
              <div className="cp-list-note">Loading…</div>
            ) : conversations.length === 0 ? (
              <div className="cp-list-note">No friends yet. Add someone from the Friends page.</div>
            ) : shownConvos.length === 0 ? (
              <div className="cp-list-note">No one matches “{query.trim()}”.</div>
            ) : (
              shownConvos.map((c) => {
                const isActive = c.id === activeConversation;
                const unread = c.unread_count > 0;
                return (
                  <button key={c.id} className={`cp-convo ${isActive ? 'active' : ''} ${unread ? 'unread' : ''}`} onClick={() => handleSelect(c.id)} title={c.full_name}>
                    <Avatar name={c.full_name} online={!!c.online} size={42} />
                    <span className="cp-convo-meta">
                      <span className="cp-convo-name">{c.full_name}</span>
                      <span className="cp-convo-preview">{typing[c.id] ? <TypingIndicator inline /> : (c.last_message || (c.online ? 'Online' : 'Offline'))}</span>
                    </span>
                    {unread && <span className="cp-unread">{c.unread_count > 9 ? '9+' : c.unread_count}</span>}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Message area */}
        <div className="cp-thread">
          <div className="cp-messages">
            {!activeConversation ? (
              <EmptyState compact icon="users" title="Pick a conversation" text="Choose a friend on the left to start chatting." />
            ) : activeMessages.length === 0 ? (
              <EmptyState compact icon="message" title="No messages yet" text={`Say hi to ${activeFriend?.full_name?.split(' ')[0] || 'your friend'} and start the conversation.`} />
            ) : (
              rows.map(({ m, joinsPrev, joinsNext, newDay }, i) => {
                const isSent = m.sender === myId;
                return (
                  <React.Fragment key={m.clientId || m.id || i}>
                    {newDay && <div className="cp-day"><span>{dayLabel(m.timestamp)}</span></div>}
                    <div className={`cp-msg ${isSent ? 'sent' : 'received'}${joinsPrev ? ' joins-prev' : ''}${joinsNext ? ' joins-next' : ''}${m.pending ? ' pending' : ''}${m.failed ? ' failed' : ''}`}>
                      <div className="cp-msg-text">{m.message}</div>
                      {(!joinsNext || m.pending || m.failed) && (
                        <div className="cp-msg-ts">
                          {m.failed
                            ? <button type="button" className="cp-retry" onClick={() => retryMessage(activeConversation, m.clientId)}>Not sent · retry</button>
                            : m.pending ? 'Sending…' : formatClock(m.timestamp)}
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              })
            )}
            {friendTyping && <TypingIndicator name={activeFriend?.full_name} />}
            <div ref={messagesEndRef} />
          </div>

          <div className="cp-composer">
            <input
              value={draft}
              onChange={(e) => { setDraft(e.target.value); emitTyping(e.target.value); }}
              onKeyDown={handleKeyDown}
              placeholder={activeFriend ? `Message ${activeFriend.full_name.split(' ')[0]}…` : 'Select a friend to message'}
              disabled={!activeConversation}
              aria-label="Message"
            />
            <button className={`cp-send ${draft.trim() ? 'active' : ''}`} onClick={handleSend} disabled={!draft.trim() || !activeConversation} aria-label="Send message">
              <Icon name="send" size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
