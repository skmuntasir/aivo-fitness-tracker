import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import API from '../services/api';
import BackButton from '../components/BackButton';
import './Chat.css';

const Chat = () => {
  const { friendId } = useParams();
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [friend, setFriend] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const socketRef = useRef(null);
  const bottomRef = useRef(null);

  const loadFriends = async () => {
    try {
      const response = await API.get('/friends/list');
      setFriends(response.data.friends || []);
    } catch (error) {
      console.error('Failed to load friends for chat', error);
    }
  };

  useEffect(() => {
    loadFriends();
  }, []);

  useEffect(() => {
    const loadFriend = async () => {
      if (!friendId) return;
      try {
        const response = await API.get(`/users/${friendId}`);
        setFriend(response.data.user);
      } catch (error) {
        console.error(error);
      }
    };

    const loadMessages = async () => {
      if (!friendId) return;
      try {
        const response = await API.get(`/messages/${friendId}`);
        setMessages(response.data.messages || []);
        // Mark messages from this friend as read
        await API.put(`/messages/${friendId}/read`).catch(() => {});
      } catch (error) {
        console.error(error);
      }
    };

    loadFriend();
    loadMessages();
  }, [friendId]);

  useEffect(() => {
    const socket = io(import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000', {
      auth: { token: localStorage.getItem('token') }
    });

    socket.on('connect', () => {
      console.log('Connected to chat socket');
    });

    socket.on('new_message', (message) => {
      if (message.sender === friendId || message.receiver === friendId) {
        setMessages((prev) => [...prev, message]);
      }
    });

    socket.on('typing', (payload) => {
      if (payload.senderId === friendId) {
        setTyping(payload.isTyping);
      }
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [friendId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!text.trim() || !socketRef.current) return;
    socketRef.current.emit('send_message', { receiverId: friendId, message: text.trim() });
    setText('');
    socketRef.current.emit('typing', { receiverId: friendId, isTyping: false });
  };

  const handleChange = (value) => {
    setText(value);
    if (socketRef.current) {
      socketRef.current.emit('typing', { receiverId: friendId, isTyping: value.length > 0 });
    }
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
              {friends.length === 0 ? (
                <div className="hint-text">No friends yet. Add someone to start chatting.</div>
              ) : (
                friends.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`friend-preview ${item.id === friendId ? 'active' : ''}`}
                    onClick={() => navigate(`/chat/${item.id}`)}
                  >
                    <div className="friend-preview-avatar">{item.full_name?.charAt(0) || 'F'}</div>
                    <div className="friend-preview-meta">
                      <strong>{item.full_name}</strong>
                      <span>{item.username || item.email}</span>
                      <small>{item.last_message || 'Tap to continue the conversation'}</small>
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
              <div>
                <span className="page-chip">Direct Message</span>
                <h1>{friend ? friend.full_name : 'Select a friend'}</h1>
              </div>
              <div className="chat-status">
                <span className={`status-dot ${friend?.online ? 'online' : 'offline'}`} />
                {friend?.online ? 'Online' : 'Offline'}
              </div>
            </div>

            <div className="chat-body">
              <div className="messages-panel">
                {messages.length === 0 ? (
                  <div className="empty-state">No messages yet. Send the first note.</div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`message-bubble ${message.sender === friendId ? 'received' : 'sent'}`}>
                      <p>{message.message}</p>
                      <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>
              {typing && <div className="typing-indicator">{friend?.full_name} is typing…</div>}
            </div>

            <div className="chat-controls">
              <textarea
                value={text}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Write your message..."
              />
              <button className="send-btn" onClick={handleSend}>Send</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Chat;
