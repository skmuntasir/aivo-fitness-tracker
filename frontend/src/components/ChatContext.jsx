import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import API from '../services/api';

const ChatContext = createContext(null);
export const useChat = () => useContext(ChatContext);

export const ChatProvider = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeConversation, setActiveConversation] = useState(null);
  const [conversations, setConversations] = useState([]); // friend list summaries
  const [messages, setMessages] = useState({}); // messages keyed by conversation id
  const socketRef = useRef(null);

  const loadFriends = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await API.get('/friends/list');
      setConversations(res.data.friends || []);
    } catch (err) {
      // silent
    }
  };

  useEffect(() => {
    // load conversations on mount (if already logged in)
    loadFriends();

    // also reload when auth changes (e.g. after login)
    window.addEventListener('authUpdated', loadFriends);
    return () => window.removeEventListener('authUpdated', loadFriends);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openChat = async (friendId = null) => {
    setIsOpen(true);
    if (friendId) {
      setActiveConversation(friendId);
      await loadMessages(friendId);
    }
  };

  const closeChat = () => {
    setIsOpen(false);
  };

  const loadMessages = async (friendId) => {
    if (!friendId) return;
    try {
      const res = await API.get(`/messages/${friendId}`);
      setMessages((prev) => ({ ...prev, [friendId]: res.data.messages || [] }));
    } catch (err) {
      setMessages((prev) => ({ ...prev, [friendId]: [] }));
    }
  };

  const sendMessage = async (friendId, text) => {
    if (!friendId || !text) return;
    try {
      await API.post('/messages', { receiverId: friendId, message: text });
      await loadMessages(friendId);
    } catch (err) {
      console.error('sendMessage error', err);
    }
  };

  return (
    <ChatContext.Provider value={{
      isOpen,
      openChat,
      closeChat,
      activeConversation,
      setActiveConversation,
      conversations,
      setConversations,
      messages,
      loadMessages,
      sendMessage,
      socketRef
    }}>
      {children}
    </ChatContext.Provider>
  );
};

export default ChatContext;
