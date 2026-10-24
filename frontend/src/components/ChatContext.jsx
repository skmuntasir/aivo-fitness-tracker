import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import API, { BACKEND_URL } from '../services/api';

const ChatContext = createContext(null);
export const useChat = () => useContext(ChatContext);

const getMyId = () => {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.id || u._id || null; } catch { return null; }
};

// Insert-or-replace by server id or clientId => a message can never appear twice.
const upsert = (list, msg) => {
  const i = list.findIndex((m) => (msg.id && m.id === msg.id) || (msg.clientId && m.clientId === msg.clientId));
  if (i === -1) return [...list, msg];
  const next = list.slice();
  next[i] = { ...list[i], ...msg, pending: false, failed: false };
  return next;
};

const newClientId = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

export const ChatProvider = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeConversation, setActiveConversation] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [requests, setRequests] = useState([]);
  const [messages, setMessages] = useState({}); // { [friendId]: { items, hasMore, loaded } }
  const [typing, setTyping] = useState({});
  const [connected, setConnected] = useState(false);

  const socketRef = useRef(null);
  const pageActiveRef = useRef(false);   // true while the full Chat page is mounted
  const stateRef = useRef({});
  stateRef.current = { isOpen, activeConversation };
  const typingTimers = useRef({});

  // ── Data loaders ───────────────────────────────────────────────────────────
  const refreshFriends = useCallback(async () => {
    if (!localStorage.getItem('token')) return;
    try {
      const res = await API.get('/friends/list');
      setConversations((res.data.friends || []).filter(Boolean));
    } catch { /* keep previous list */ }
    finally { setFriendsLoaded(true); }
  }, []);

  const refreshRequests = useCallback(async () => {
    if (!localStorage.getItem('token')) return;
    try {
      const res = await API.get('/friends/requests');
      setRequests((res.data.requests || []).filter((r) => r.sender));
    } catch { /* ignore */ }
  }, []);

  const loadMessages = useCallback(async (friendId, { older = false } = {}) => {
    if (!friendId) return;
    const current = stateRef.current.msgs?.[friendId];
    try {
      const params = { limit: 50 };
      if (older && current?.items?.length) params.before = current.items[0].id;
      const res = await API.get(`/messages/${friendId}`, { params });
      const fetched = res.data.messages || [];
      setMessages((prev) => {
        const existing = prev[friendId]?.items || [];
        let items = older ? [...fetched, ...existing] : fetched.reduce(upsert, existing.filter((m) => m.pending || m.failed));
        // de-dupe + keep chronological order
        const seen = new Set();
        items = items.filter((m) => { const k = m.id || m.clientId; if (seen.has(k)) return false; seen.add(k); return true; });
        return { ...prev, [friendId]: { items, hasMore: !!res.data.hasMore, loaded: true } };
      });
    } catch {
      setMessages((prev) => ({ ...prev, [friendId]: prev[friendId] || { items: [], hasMore: false, loaded: true } }));
    }
  }, []);
  stateRef.current.msgs = messages;

  const markRead = useCallback((friendId) => {
    if (!friendId) return;
    setConversations((prev) => prev.map((c) => (c.id === friendId ? { ...c, unread_count: 0 } : c)));
    const s = socketRef.current;
    if (s?.connected) s.emit('mark_read', { friendId });
    else API.put(`/messages/${friendId}/read`).catch(() => {});
  }, []);

  const selectConversation = useCallback((friendId) => {
    setActiveConversation(friendId);
    if (!friendId) return;
    if (!stateRef.current.msgs?.[friendId]?.loaded) loadMessages(friendId);
    markRead(friendId);
  }, [loadMessages, markRead]);

  const openChat = useCallback((friendId = null) => {
    setIsOpen(true);
    if (friendId) selectConversation(friendId);
  }, [selectConversation]);

  const closeChat = useCallback(() => setIsOpen(false), []);
  const setPageActive = useCallback((v) => { pageActiveRef.current = v; }, []);

  // ── Sending: optimistic bubble, replaced (never duplicated) by the server ack ─
  const sendMessage = useCallback(async (friendId, text) => {
    const body = (text || '').trim();
    if (!friendId || !body) return;
    const clientId = newClientId();
    const myId = getMyId();
    const optimistic = { id: clientId, clientId, sender: myId, receiver: friendId, message: body, timestamp: new Date().toISOString(), pending: true };
    setMessages((prev) => ({ ...prev, [friendId]: { ...(prev[friendId] || { hasMore: false, loaded: true }), items: upsert(prev[friendId]?.items || [], optimistic) } }));
    setConversations((prev) => prev.map((c) => (c.id === friendId ? { ...c, last_message: body.slice(0, 80), last_message_at: optimistic.timestamp } : c)));

    const settle = (saved) => setMessages((prev) => ({ ...prev, [friendId]: { ...prev[friendId], items: upsert(prev[friendId].items, { ...saved, clientId }) } }));
    const fail = () => setMessages((prev) => ({ ...prev, [friendId]: { ...prev[friendId], items: prev[friendId].items.map((m) => (m.clientId === clientId ? { ...m, pending: false, failed: true } : m)) } }));

    const viaRest = async () => {
      try {
        const res = await API.post('/messages', { receiverId: friendId, message: body, clientId });
        if (res.data.success) settle(res.data.data); else fail();
      } catch { fail(); }
    };

    const s = socketRef.current;
    if (s?.connected) {
      s.timeout(8000).emit('send_message', { receiverId: friendId, message: body, clientId }, (err, res) => {
        if (err || !res) return viaRest();
        if (res.ok) settle(res.message); else fail();
      });
    } else {
      viaRest();
    }
  }, []);

  const retryMessage = useCallback((friendId, clientId) => {
    const item = stateRef.current.msgs?.[friendId]?.items?.find((m) => m.clientId === clientId);
    if (!item) return;
    setMessages((prev) => ({ ...prev, [friendId]: { ...prev[friendId], items: prev[friendId].items.filter((m) => m.clientId !== clientId) } }));
    sendMessage(friendId, item.message);
  }, [sendMessage]);

  const sendTyping = useCallback((friendId, isTyping) => {
    const s = socketRef.current;
    if (s?.connected && friendId) s.emit('typing', { receiverId: friendId, isTyping });
  }, []);

  // ── One socket for the whole app ───────────────────────────────────────────
  useEffect(() => {
    let disposed = false;

    const connect = () => {
      const token = localStorage.getItem('token');
      if (!token || socketRef.current) return;
      const socket = io(BACKEND_URL, { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 8000 });
      socketRef.current = socket;
      let firstConnect = true;

      socket.on('connect', () => {
        setConnected(true);
        if (!firstConnect) { // came back after a drop: resync anything we missed
          refreshFriends();
          const a = stateRef.current.activeConversation;
          if (a) loadMessages(a);
        }
        firstConnect = false;
      });
      socket.on('disconnect', () => { setConnected(false); setTyping({}); });

      socket.on('new_message', (m) => {
        const myId = getMyId();
        const friendId = m.sender === myId ? m.receiver : m.sender;
        setMessages((prev) => {
          const bucket = prev[friendId];
          if (!bucket?.loaded) return prev; // will be fetched fresh when opened
          return { ...prev, [friendId]: { ...bucket, items: upsert(bucket.items, m) } };
        });
        if (m.sender !== myId) {
          clearTimeout(typingTimers.current[m.sender]);
          setTyping((prev) => (prev[m.sender] ? { ...prev, [m.sender]: false } : prev));
        }
        const { isOpen: open, activeConversation: active } = stateRef.current;
        const viewing = m.sender === friendId && friendId === active && (open || pageActiveRef.current);
        setConversations((prev) => prev.map((c) => (c.id !== friendId ? c : {
          ...c, last_message: m.message.slice(0, 80), last_message_at: m.timestamp,
          unread_count: m.sender === friendId && !viewing ? (c.unread_count || 0) + 1 : c.unread_count || 0 })));
        if (viewing) socket.emit('mark_read', { friendId });
      });

      socket.on('typing', ({ senderId, isTyping }) => {
        setTyping((prev) => ({ ...prev, [senderId]: isTyping }));
        clearTimeout(typingTimers.current[senderId]);
        if (isTyping) typingTimers.current[senderId] = setTimeout(() => setTyping((p) => ({ ...p, [senderId]: false })), 4000);
      });
      const presence = (online) => ({ userId }) => {
        setConversations((prev) => prev.map((c) => (c.id === userId ? { ...c, online, last_active: new Date().toISOString() } : c)));
        if (!online) {
          clearTimeout(typingTimers.current[userId]);
          setTyping((prev) => (prev[userId] ? { ...prev, [userId]: false } : prev));
        }
      };
      socket.on('user_online', presence(true));
      socket.on('user_offline', presence(false));
      socket.on('friend_request_received', refreshRequests);
      socket.on('friend_request_accepted', refreshFriends);
    };

    const disconnect = () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
    const onAuth = () => { if (disposed) return; disconnect(); connect(); refreshFriends(); refreshRequests(); };
    const onLogout = () => {
      disconnect();
      setConversations([]); setMessages({}); setRequests([]); setFriendsLoaded(false);
      setActiveConversation(null); setIsOpen(false);
    };

    connect();
    refreshFriends();
    refreshRequests();
    window.addEventListener('authUpdated', onAuth);
    window.addEventListener('logout', onLogout);
    return () => {
      disposed = true;
      window.removeEventListener('authUpdated', onAuth);
      window.removeEventListener('logout', onLogout);
      disconnect();
    };
  }, [refreshFriends, refreshRequests, loadMessages]);

  const totalUnread = useMemo(() => conversations.reduce((n, c) => n + (c.unread_count || 0), 0), [conversations]);

  const value = useMemo(() => ({
    isOpen, openChat, closeChat, activeConversation, setActiveConversation, selectConversation,
    conversations, setConversations, friendsLoaded, refreshFriends,
    requests, refreshRequests,
    messages, loadMessages, sendMessage, retryMessage, sendTyping, typing, markRead,
    totalUnread, connected, setPageActive,
  }), [isOpen, openChat, closeChat, activeConversation, selectConversation, conversations, friendsLoaded,
       refreshFriends, requests, refreshRequests, messages, loadMessages, sendMessage, retryMessage,
       sendTyping, typing, markRead, totalUnread, connected, setPageActive]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export default ChatContext;
