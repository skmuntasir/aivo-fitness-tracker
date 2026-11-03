import React, { useState, useEffect, useRef, useCallback } from 'react';
import API from '../services/api';
import { streamCoachReply } from '../services/stream';
import { useFeedback } from './Feedback';
import Icon from './Icon';
import './AiCoach.css';
import './Engage.css';

import { formatAIMessage } from './aiFormat';
import { loadChat, saveChat, clearChat } from '../utils/coachChat';
import { refreshData } from '../utils/dataCache';
import { stripCoachTags } from '../utils/workoutPrefs';
import CoachTimerAdd, { planWorkoutNames } from './CoachTimerAdd';

// A reply is worth saving when it reads like a workout or meal plan.
const isDemoUser = () => { try { return !!JSON.parse(localStorage.getItem('user') || '{}').is_demo; } catch { return false; } };

const PLAN_WORDS = /\b(sets?|reps?|warm-?up|cool-?down|workout|exercises?|day \d|breakfast|lunch|dinner|snacks?|meal|calories|kcal|protein)\b/gi;
const looksLikePlan = (text) => !!text && text.split('\n').filter((l) => l.trim()).length >= 5 && (text.match(PLAN_WORDS) || []).length >= 3;

const QUICK_PROMPTS = [
  'What are my goals?',
  'Build me a workout plan',
  'How many calories should I eat?',
  'How is my streak?',
];

// Floating AI coach (moved here from the Progress page). Same chat, same /ai/chat endpoint.
const AiCoach = () => {
  const [chatOpen, setChatOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The conversation lives until logout: restored here after a page change or reload (utils/coachChat.js)
  const restored = useRef(loadChat()).current;
  const [chatMessages, setChatMessages] = useState(() => restored || [
    { role: 'ai', text: "Hi, I'm your AI coach. Pulling up your fitness data…" },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasUserMessaged, setHasUserMessaged] = useState(() => !!restored?.some((m) => m.role === 'user'));
  const chatEndRef = useRef(null);
  const greetedRef = useRef(!!restored && (restored.length > 1 || !/Pulling up your fitness data/.test(restored[0]?.text || '')));
  const abortRef = useRef(null);
  const { toast, confirm } = useFeedback();
  const [streaming, setStreaming] = useState(false);
  const [savingIdx, setSavingIdx] = useState(null);
  const latest = useRef(chatMessages);
  latest.current = chatMessages;

  // Personalised greeting. Loaded the first time the chat is opened (not on page load) so the
  // Home page stays fast; the reply itself is still produced by the backend with your full profile.
  useEffect(() => {
    if (!chatOpen || greetedRef.current) return;
    greetedRef.current = true;
    (async () => {
      try {
        const data = await refreshData('progress', { maxAge: 60000 });   // same saved copy the Progress page uses
        if (data.success) {
          const s = data.summary;
          const greeting = {
            role: 'ai',
            text: `Hi${isDemoUser() || !s.name ? '' : ' ' + s.name.split(' ')[0]}! I've loaded your fitness data — ${s.streak || 0}-day streak, ${s.weekly_workouts || 0} workouts this week, ${(s.week_calories || 0).toLocaleString()} kcal burned. What do you want to work on?`,
          };
          // only swap the placeholder greeting; never wipe a conversation already in progress
          setChatMessages((prev) => (prev.length === 1 && prev[0].role === 'ai' ? [greeting] : prev));
        }
      } catch {
        setChatMessages((prev) => (prev.length === 1 && prev[0].role === 'ai'
          ? [{ role: 'ai', text: "Hi, I'm your AI coach. Ask me anything about training, nutrition or recovery." }]
          : prev));
      }
    })();
  }, [chatOpen]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth' });
  }, [chatMessages, isTyping, streaming]);

  // keep the conversation saved (not on every streamed word) and save once more when leaving the page
  useEffect(() => { if (!streaming) saveChat(chatMessages.map((m) => ({ ...m, streaming: undefined }))); }, [chatMessages, streaming]);
  useEffect(() => () => {
    abortRef.current?.abort();
    saveChat(latest.current.map((m) => ({ ...m, streaming: undefined })));
  }, []);

  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') { if (expanded) setExpanded(false); else setChatOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen, expanded]);

  // The Home "Ask AI coach" tile opens this panel
  useEffect(() => {
    const open = () => setChatOpen(true);
    window.addEventListener('aivo:open-coach', open);
    return () => window.removeEventListener('aivo:open-coach', open);
  }, []);

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

    // 1) Streaming: the reply is written into a new message as it arrives
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let buffer = '';
    let raf = 0;
    // State updaters must be pure (React StrictMode runs them twice in dev), so the reply is
    // addressed by an id instead of by "the last message".
    const replyId = `ai-${Date.now()}`;
    const flush = () => {
      raf = 0;
      const text = buffer;
      setChatMessages((prev) => (prev.some((m) => m.id === replyId)
        ? prev.map((m) => (m.id === replyId ? { ...m, text } : m))
        : [...prev, { id: replyId, role: 'ai', text, streaming: true }]));
      setIsTyping(false);
    };
    setStreaming(true);
    const result = await streamCoachReply(apiMessages, {
      signal: ctrl.signal,
      onToken: (piece) => { buffer += piece; if (!raf) raf = requestAnimationFrame(flush); },
    });
    if (raf) { cancelAnimationFrame(raf); flush(); }
    setStreaming(false);
    abortRef.current = null;
    setChatMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, streaming: false } : m)));
    if (result.ok) { setIsTyping(false); return; }
    if (result.message) {
      setIsTyping(false);
      setChatMessages((prev) => [...prev, { role: 'ai', text: result.message }]);
      return;
    }

    // 2) Fallback: streaming unavailable (old server, proxy that buffers...) -> the normal request
    try {
      const res = await API.post('/ai/chat', { messages: apiMessages });
      setIsTyping(false);
      if (res.data.success) {
        setChatMessages((prev) => [...prev, { role: 'ai', text: res.data.reply }]);
      } else {
        const backendMsg = res.data.message || 'Sorry, I had trouble responding. Please try again.';
        setChatMessages((prev) => [...prev, { role: 'ai', text: '' + backendMsg }]);
      }
    } catch (err) {
      setIsTyping(false);
      const serverMsg = err?.response?.data?.message;
      const statusCode = err?.response?.status;
      let friendlyMsg;
      if (serverMsg) {
        friendlyMsg = '' + serverMsg;
      } else if (statusCode === 503) {
        friendlyMsg = 'AI not configured. Please set GROQ_API_KEY in backend/.env and restart Flask.';
      } else if (statusCode === 504) {
        friendlyMsg = 'AI request timed out. Please try again.';
      } else if (!statusCode) {
        friendlyMsg = 'Cannot reach the backend. Make sure Flask is running on port 5000.';
      } else {
        friendlyMsg = 'Server error (HTTP ' + statusCode + '). Check the Flask terminal for details.';
      }
      setChatMessages((prev) => [...prev, { role: 'ai', text: friendlyMsg }]);
    }
  }, [chatInput, chatMessages]);

  const stopStreaming = () => abortRef.current?.abort();

  const clearConversation = async () => {
    if (!(await confirm({ title: 'Clear this chat?', message: 'The conversation is removed and your coach forgets the plans it remembered for you. Plans saved on your profile stay.', confirmLabel: 'Clear chat', tone: 'danger' }))) return;
    abortRef.current?.abort();
    clearChat();
    API.delete('/ai/memory').catch(() => {});
    setChatMessages([{ role: 'ai', text: 'Fresh start! What do you want to work on?' }]);
    setHasUserMessaged(false);
    greetedRef.current = true;
  };

  const savePlan = async (i, text) => {
    if (savingIdx !== null) return;
    setSavingIdx(i);
    try {
      const r = await API.post('/plans', { content: stripCoachTags(text) });
      setChatMessages((prev) => prev.map((m, j) => (j === i ? { ...m, saved: true } : m)));
      toast(r.data.duplicate ? 'This plan is already saved on your profile.' : 'Plan saved to your profile.', 'success');
    } catch (e) {
      toast(e?.response?.data?.message || 'Could not save the plan. Please try again.', 'error');
    } finally { setSavingIdx(null); }
  };

  const aiAvatar = <span className="ac-msg-avatar"><Icon name="bot" size={16} /></span>;
  return (
    <div className={`ac-wrap ${chatOpen ? 'open' : ''} ${chatOpen && expanded ? 'expanded' : ''}`}>
      {chatOpen && (
        <div className="ac-panel" role="dialog" aria-label="AI coach">
          <div className="ac-header">
            <div className="ac-avatar"><Icon name="bot" size={22} /></div>
            <div className="ac-head-text">
              <div className="ac-title">Aivo Coach</div>
              <div className="ac-status"><span className="ac-live" /> Online · knows your profile</div>
            </div>
            {chatMessages.length > 1 && (
              <button className="ac-clear" onClick={clearConversation} aria-label="Clear chat" title="Clear chat"><Icon name="trash" size={17} /></button>
            )}
            <button className="ac-expand" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Shrink AI coach' : 'Expand AI coach'} title={expanded ? 'Shrink' : 'Expand'}>
              <Icon name={expanded ? 'minimize' : 'maximize'} size={18} />
            </button>
            <button className="ac-close" onClick={() => setChatOpen(false)} aria-label="Close AI coach"><Icon name="x" size={18} /></button>
          </div>
          <div className="ac-body">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`ac-msg ac-msg-${msg.role}`}>
                {msg.role === 'ai' && aiAvatar}
                <div className="ac-msg-col">
                  <div className={`ac-msg-bubble${msg.streaming ? ' ac-streaming' : ''}`}>{msg.role === 'ai' ? formatAIMessage(stripCoachTags(msg.text)) : msg.text}{msg.streaming && <span className="ac-caret" aria-hidden="true" />}</div>
                  {msg.role === 'ai' && i > 0 && !msg.streaming && (looksLikePlan(stripCoachTags(msg.text)) || planWorkoutNames(msg.text).length > 0) && (
                    <div className="ac-actions">
                    <button type="button" className={`ac-save${msg.saved ? ' saved' : ''}`} disabled={!!msg.saved || savingIdx === i} onClick={() => savePlan(i, msg.text)}>
                      <Icon name={msg.saved ? 'check' : 'bookmark'} size={14} strokeWidth={msg.saved ? 3 : 2} />
                      {msg.saved ? 'Saved to profile' : savingIdx === i ? 'Saving…' : 'Save plan'}
                    </button>
                    {planWorkoutNames(msg.text).length > 0 && (
                      <CoachTimerAdd text={msg.text} names={planWorkoutNames(msg.text)} initialDone={!!msg.timerDone}
                        onDone={() => setChatMessages((prev) => prev.map((m, j) => (j === i ? { ...m, timerDone: true } : m)))} />
                    )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="ac-msg ac-msg-ai">
                {aiAvatar}
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
              placeholder="Ask your coach anything"
              aria-label="Message to AI coach"
            />
            {streaming ? (
              <button className="ac-send ac-stop" onClick={stopStreaming} aria-label="Stop reply" title="Stop"><Icon name="stop" size={16} /></button>
            ) : (
              <button className="ac-send" onClick={() => sendChat()} disabled={!chatInput.trim() || isTyping} aria-label="Send"><Icon name="send" size={18} /></button>
            )}
          </div>
        </div>
      )}
      <button
        className={`ac-fab ${chatOpen ? 'active' : ''}`}
        onClick={() => setChatOpen((v) => !v)}
        aria-label={chatOpen ? 'Close AI coach' : 'Open AI coach'}
      >
        <Icon name={chatOpen ? 'x' : 'bot'} size={chatOpen ? 22 : 28} />
        {!chatOpen && <span className="ac-fab-pulse" />}
      </button>
    </div>
  );
};

export default AiCoach;
