import React, { useState, useEffect, useRef, useCallback } from 'react';
import API from '../services/api';
import './AiCoach.css';

// ─── FORMAT AI MESSAGE (supports **bold**, bullet points, line breaks) ─────────
const formatAIMessage = (text) => {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (!line.trim()) return <br key={i} />;
    // Parse **bold** text
    const parts = line.split(/\*\*([^*]+)\*\*/g);
    const formatted = parts.map((part, pi) =>
      pi % 2 === 1 ? <strong key={pi} style={{ color: '#c4b5fd', fontWeight: 700 }}>{part}</strong> : part
    );
    // Bullet points
    if (line.trim().startsWith('•') || line.trim().startsWith('-') || line.trim().startsWith('*')) {
      return (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3, paddingLeft: 4 }}>
          <span style={{ color: '#a78bfa', flexShrink: 0, marginTop: 1 }}>•</span>
          <span>{formatted}</span>
        </div>
      );
    }
    return <div key={i} style={{ marginBottom: line.trim() ? 4 : 0 }}>{formatted}</div>;
  });
};

const QUICK_PROMPTS = [
  'What is my name and goals?',
  'Create a workout plan for me',
  'How many calories should I eat?',
  'How is my streak?',
];

// Floating AI coach (moved here from the Progress page). Same chat, same /ai/chat endpoint.
const AiCoach = () => {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'ai', text: "Hey! I'm your AI Coach. Loading your real fitness data now... 🔄" },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasUserMessaged, setHasUserMessaged] = useState(false);
  const chatEndRef = useRef(null);
  const greetedRef = useRef(false);

  // Personalised greeting. Loaded the first time the chat is opened (not on page load) so the
  // Home page stays fast; the reply itself is still produced by the backend with your full profile.
  useEffect(() => {
    if (!chatOpen || greetedRef.current) return;
    greetedRef.current = true;
    (async () => {
      try {
        const res = await API.get('/analytics/progress-summary');
        if (res.data.success) {
          const s = res.data.summary;
          const greeting = {
            role: 'ai',
            text: `Hey ${s.name ? s.name.split(' ')[0] : 'there'}! I've loaded your real fitness data — ${s.streak || 0}-day streak, ${s.weekly_workouts || 0} workouts this week, ${(s.week_calories || 0).toLocaleString()} kcal burned. Ask me anything! 💪`,
          };
          // only swap the placeholder greeting; never wipe a conversation already in progress
          setChatMessages((prev) => (prev.length === 1 && prev[0].role === 'ai' ? [greeting] : prev));
        }
      } catch {
        setChatMessages((prev) => (prev.length === 1 && prev[0].role === 'ai'
          ? [{ role: 'ai', text: "Hey! I'm your AI Coach. Ask me anything about your training, nutrition or recovery. 💪" }]
          : prev));
      }
    })();
  }, [chatOpen]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isTyping]);

  // ── Chat ─────────────────────────────────────────────────────────────────
  const sendChat = useCallback(async (text) => {
    const msg = text || chatInput;
    if (!msg.trim()) return;

    // Snapshot history BEFORE adding new user message
    const prevHistory = [...chatMessages];
    setChatMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setChatInput('');
    setIsTyping(true);
    setHasUserMessaged(true);

    // Build API messages from previous history + new user message
    const apiMessages = [...prevHistory, { role: 'user', text: msg }]
      .filter((m) => m.role === 'user' || m.role === 'ai')
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));

    try {
      const res = await API.post('/ai/chat', { messages: apiMessages });
      setIsTyping(false);
      if (res.data.success) {
        setChatMessages((prev) => [...prev, { role: 'ai', text: res.data.reply }]);
      } else {
        // Show the actual backend error message
        const backendMsg = res.data.message || 'Sorry, I had trouble responding. Please try again.';
        setChatMessages((prev) => [...prev, { role: 'ai', text: '⚠️ ' + backendMsg }]);
      }
    } catch (err) {
      setIsTyping(false);
      // err.response.data.message carries the real error when backend returns non-2xx
      const serverMsg = err?.response?.data?.message;
      const statusCode = err?.response?.status;
      let friendlyMsg;
      if (serverMsg) {
        friendlyMsg = '⚠️ ' + serverMsg;
      } else if (statusCode === 503) {
        friendlyMsg = '⚠️ AI not configured. Please set GROQ_API_KEY in backend/.env and restart Flask.';
      } else if (statusCode === 504) {
        friendlyMsg = '⏱ AI request timed out. Please try again.';
      } else if (!statusCode) {
        friendlyMsg = '⚠️ Cannot reach the backend. Make sure Flask is running on port 5000.';
      } else {
        friendlyMsg = '⚠️ Server error (HTTP ' + statusCode + '). Check the Flask terminal for details.';
      }
      setChatMessages((prev) => [...prev, { role: 'ai', text: friendlyMsg }]);
    }
  }, [chatInput, chatMessages]);

  return (
    <div className={`ac-wrap ${chatOpen ? 'open' : ''}`}>
      {chatOpen && (
        <div className="ac-panel">
          <div className="ac-header">
            <div className="ac-avatar">🤖</div>
            <div>
              <div className="ac-title">Aivo Coach</div>
              <div className="ac-status">● Online · Knows your full profile</div>
            </div>
            <button className="ac-close" onClick={() => setChatOpen(false)} aria-label="Close AI coach">✕</button>
          </div>
          <div className="ac-body">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`ac-msg ac-msg-${msg.role}`}>
                {msg.role === 'ai' && <span className="ac-msg-avatar">🤖</span>}
                <div className="ac-msg-bubble">{msg.role === 'ai' ? formatAIMessage(msg.text) : msg.text}</div>
              </div>
            ))}
            {isTyping && (
              <div className="ac-msg ac-msg-ai">
                <span className="ac-msg-avatar">🤖</span>
                <div className="ac-msg-bubble ac-typing"><span /><span /><span /></div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {!hasUserMessaged && (
            <div className="ac-quick">
              {QUICK_PROMPTS.map((p) => (
                <button key={p} className="ac-quick-btn" onClick={() => { sendChat(p); setHasUserMessaged(true); }}>{p}</button>
              ))}
            </div>
          )}
          <div className="ac-input-row">
            <input
              className="ac-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChat()}
              placeholder="Ask your AI coach anything…"
            />
            <button className="ac-send" onClick={() => sendChat()} disabled={!chatInput.trim() || isTyping}>↑</button>
          </div>
        </div>
      )}
      <button
        className={`ac-fab ${chatOpen ? 'active' : ''}`}
        onClick={() => setChatOpen((v) => !v)}
        aria-label={chatOpen ? 'Close AI coach' : 'Open AI coach'}
      >
        {chatOpen ? '✕' : '🤖'}
        {!chatOpen && <span className="ac-fab-pulse" />}
      </button>
    </div>
  );
};

export default AiCoach;
