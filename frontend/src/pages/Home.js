import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';
import main_logo from './images/aivo_logo.webp';
import API from '../services/api';
import StreakCalendar from '../components/StreakCalendar';
import NavIcons from '../components/NavIcons';
import AnnouncementBanner from '../components/AnnouncementBanner';
import Icon from '../components/Icon';
import { prefetchFeed } from '../utils/feedCache';
import { localDateKey, userTimeZone } from '../utils/time';


// Heavy widgets that are not needed for the first paint: loaded on demand (modals) or when idle (coach)
const loadCalorie = () => import('../components/CalorieCalculator');
const loadTimer = () => import('../components/WorkoutTimer');
const CalorieCalculator = lazy(loadCalorie);
const WorkoutTimer = lazy(loadTimer);
const AiCoach = lazy(() => import('../components/AiCoach'));

// Dashboard card cache: the week strip / ring used to start empty (skeleton) on every visit.
// We keep the last result per user (memory + localStorage) so it paints instantly and refreshes quietly.
const dashKey = () => {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return `dash:v1:${u.id || u._id || 'anon'}`; } catch { return 'dash:v1:anon'; }
};
let dashMem = null;   // survives route changes without touching storage
const readDash = () => {
  const k = dashKey();
  if (dashMem && dashMem.k === k) return dashMem.v;
  try { const v = JSON.parse(localStorage.getItem(k)); if (v && typeof v === 'object') { dashMem = { k, v }; return v; } } catch {}
  return null;
};
const writeDash = (v) => {
  const k = dashKey();
  dashMem = { k, v };
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};
if (typeof window !== 'undefined') {
  window.addEventListener('logout', () => { dashMem = null; try { Object.keys(localStorage).filter((k) => k.startsWith('dash:v1:')).forEach((k) => localStorage.removeItem(k)); } catch {} });
}

const WEEKLY_GOAL = 5;                       // workouts per week shown on the dashboard ring
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

// Monday-first list of the 7 local date keys of the current week
const currentWeek = () => {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return localDateKey(d);
  });
};

const Home = () => {
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showCalorieCalculator, setShowCalorieCalculator] = useState(false);
  const [showWorkoutTimer, setShowWorkoutTimer] = useState(false);
  const [streakKey, setStreakKey] = useState(0);
  const timerRef = useRef(null);
  // closing the timer while it runs asks: save / reset / keep going (handled inside WorkoutTimer)
  const closeTimer = () => (timerRef.current ? timerRef.current.requestClose() : setShowWorkoutTimer(false));

  const token = localStorage.getItem('token');
  const [userProfile, setUserProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  });
  const [liveStats, setLiveStats] = useState({ streak: null, points: null, totalWorkouts: null });
  const [dayTotals, setDayTotals] = useState(() => readDash()?.dayTotals || null);   // { 'YYYY-MM-DD': seconds } — null only on the very first visit

  const firstName = userProfile?.full_name?.split(' ')[0] || 'Athlete';

  // Lightweight stats endpoint (was /analytics/progress-summary, which loads every workout
  // just to read three numbers and blocked the whole Home page).
  const fetchLiveStats = useCallback(async () => {
    try {
      const res = await API.get('/workouts/stats');
      if (res.data.success) {
        const d = res.data;
        setLiveStats({ streak: d.streak ?? 0, points: d.points ?? 0, totalWorkouts: d.total_workouts ?? 0 });
        try {
          const stored = JSON.parse(localStorage.getItem('user') || '{}');
          stored.streak = d.streak ?? 0;
          stored.points = d.points ?? 0;
          stored.totalWorkouts = d.total_workouts ?? 0;
          localStorage.setItem('user', JSON.stringify(stored));
        } catch {}
      }
    } catch {
      const cached = JSON.parse(localStorage.getItem('user') || '{}');
      setLiveStats({ streak: cached?.streak ?? null, points: cached?.points ?? null, totalWorkouts: cached?.totalWorkouts ?? null });
    }
  }, []);

  useEffect(() => {
    fetchLiveStats();
  }, []); // eslint-disable-line

  // Week strip + "today" numbers for the dashboard card (refetched after a workout is logged)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await API.get('/workouts/daily-summary', { params: { year: new Date().getFullYear(), tz: userTimeZone } });
        if (cancelled || !res.data.success) return;
        const m = {};
        (res.data.streak_data || []).forEach((e) => { m[e.date] = e.total_duration; });
        setDayTotals(m);
        writeDash({ ...(readDash() || {}), dayTotals: m });
      } catch { if (!cancelled) setDayTotals((prev) => prev || {}); }
    })();
    return () => { cancelled = true; };
  }, [streakKey]);

  // Warm up Community in the background so it opens instantly: download its code chunk and
  // fetch + cache the first page of the feed while the user is still on Home.
  const warmCommunity = useCallback(() => {
    import('./Community').catch(() => {});
    prefetchFeed();
  }, []);

  useEffect(() => {
    const t = setTimeout(warmCommunity, 700);
    // download the modal code during idle time so Start Workout / Calories open instantly
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const h = idle(() => { loadTimer().catch(() => {}); loadCalorie().catch(() => {}); });
    return () => { clearTimeout(t); cancel(h); };
  }, [warmCommunity]);

  const handleWorkoutComplete = () => {
    // Refresh stats after workout is logged
    fetchLiveStats();
    setStreakKey(prev => prev + 1);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try { await API.post('/auth/logout'); } catch (e) { console.error(e); }
    finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.dispatchEvent(new Event('logout'));
      setIsLoggingOut(false);
      navigate('/login');
    }
  };

  const week = currentWeek();
  const todayKey = localDateKey();
  const activeThisWeek = dayTotals ? week.filter((k) => (dayTotals[k] || 0) > 0).length : 0;
  const todayMin = dayTotals ? Math.round((dayTotals[todayKey] || 0) / 60) : 0;
  const ringPct = Math.min(1, activeThisWeek / WEEKLY_GOAL);
  const RING_R = 54, RING_C = 2 * Math.PI * RING_R;

  const statVal = (live, cached, fmt = (v) => v) => (live !== null ? fmt(live) : (cached != null ? fmt(cached) : null));
  const stats = [
    { label: 'Workouts', icon: 'activity', value: statVal(liveStats.totalWorkouts, userProfile?.totalWorkouts) },
    { label: 'Streak',   icon: 'flame',    value: statVal(liveStats.streak, userProfile?.streak, (v) => `${v}d`) },
    { label: 'Points',   icon: 'zap',      value: statVal(liveStats.points, userProfile?.points) },
  ];

  const subline = !dayTotals ? 'Track, train, and transform — every single day.'
    : todayMin > 0 ? `You've trained ${todayMin} min today — great work!`
    : (liveStats.streak ?? userProfile?.streak ?? 0) > 0 ? `Train today to keep your ${liveStats.streak ?? userProfile?.streak}-day streak alive.`
    : 'Log your first session today and start a streak.';

  return (
    <div className="home-container">
      <div className="home-bg-gradient"></div>
      <div className="home-bg-orbs">
        <div className="orb orb-1"></div>
        <div className="orb orb-2"></div>
        <div className="orb orb-3"></div>
      </div>

      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo-section">
            <img src={main_logo} alt="Aivo" className="main-logo" width="360" height="240" decoding="async" fetchPriority="high" />
          </div>
          <NavIcons />
          <div className="nav-buttons">
            <button className="nav-button calorie-btn" onClick={() => setShowCalorieCalculator(true)} onPointerEnter={loadCalorie}>
              <Icon name="calculator" size={16} /> Calories
            </button>
            <button className="nav-button leaderboard-btn" onClick={() => navigate('/leaderboard')}>
              <Icon name="trophy" size={16} /> Leaderboard
            </button>
            <button className="nav-button profile-btn" onClick={() => navigate('/profile')}>
              <Icon name="user" size={16} /> Profile
            </button>
            <button
              className={`nav-button logout-btn ${isLoggingOut ? 'loading' : ''}`}
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              <Icon name="logout" size={16} />
              {isLoggingOut ? 'Logging out…' : 'Logout'}
            </button>
          </div>
        </div>
      </header>
      <AnnouncementBanner />

      {/* Hero */}
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-text">
            <div className="hero-badge">
              <span className="badge-dot"></span>
              Intelligent Fitness. Limitless You.
            </div>
            <h1 className="hero-title">
              {greeting()},<br />
              <span className="hero-name">{firstName}</span>
            </h1>
            <p className="hero-date"><Icon name="calendar" size={14} /> {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <p className="hero-subtitle">{subline}</p>
            <div className="hero-actions">
              <button className="cta-primary" onClick={() => setShowWorkoutTimer(true)} onPointerEnter={loadTimer}>
                <span className="cta-icon"><Icon name="play" size={16} /></span>
                Start Workout
              </button>
              <button className="cta-secondary" onClick={() => navigate('/progress')}>
                <span className="cta-icon"><Icon name="progress" size={16} /></span>
                View Progress
              </button>
              <button className="cta-secondary" onClick={() => navigate('/community')}
                onMouseEnter={warmCommunity} onTouchStart={warmCommunity} onFocus={warmCommunity}>
                <span className="cta-icon"><Icon name="users" size={16} /></span>
                Community
              </button>
            </div>
          </div>

          <div className="hero-visual">
            <div className="hero-card-glow"></div>
            <div className="dash-card">
              <div className="dash-top">
                <div className="dash-ring" aria-label={`${activeThisWeek} of ${WEEKLY_GOAL} workouts this week`}>
                  {dayTotals ? (
                    <>
                      <svg viewBox="0 0 128 128" width="132" height="132">
                        <circle cx="64" cy="64" r={RING_R} className="ring-track" />
                        <circle cx="64" cy="64" r={RING_R} className="ring-fill" strokeDasharray={RING_C}
                          strokeDashoffset={RING_C * (1 - ringPct)} transform="rotate(-90 64 64)" />
                      </svg>
                      <div className="ring-center">
                        <b>{activeThisWeek}<small>/{WEEKLY_GOAL}</small></b>
                        <span>this week</span>
                      </div>
                    </>
                  ) : <div className="sk" style={{ width: 132, height: 132, borderRadius: '50%' }} />}
                </div>
                <div className="dash-today">
                  <span className="dash-eyebrow">Weekly goal</span>
                  <strong>{activeThisWeek >= WEEKLY_GOAL ? 'Goal reached!' : `${Math.max(0, WEEKLY_GOAL - activeThisWeek)} more to go`}</strong>
                  <span className="dash-today-line"><Icon name="timer" size={14} /> {dayTotals ? `${todayMin} min today` : '…'}</span>
                </div>
              </div>

              <div className="week-strip">
                {week.map((k, i) => {
                  const done = dayTotals && (dayTotals[k] || 0) > 0;
                  return (
                    <div key={k} className={`week-day ${done ? 'done' : ''} ${k === todayKey ? 'today' : ''}`}>
                      <span className="week-dot">{done ? <Icon name="check" size={13} strokeWidth={3} /> : null}</span>
                      <span className="week-letter">{DAY_LETTERS[i]}</span>
                    </div>
                  );
                })}
              </div>

              <div className="stats-row">
                {stats.map((s) => (
                  <div key={s.label} className="stat-chip">
                    <span className="stat-icon"><Icon name={s.icon} size={18} /></span>
                    {s.value === null ? <span className="sk" style={{ width: 34, height: 20 }} /> : <span className="stat-value">{s.value}</span>}
                    <span className="stat-label">{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Streak Calendar - Premium */}
        <section className="streak-section">
          <StreakCalendar token={token} refreshKey={streakKey} />
        </section>
      </main>

      {/* Floating AI coach — sits beside the streak calendar and follows you as you scroll */}
      <Suspense fallback={null}><AiCoach /></Suspense>

      {/* Calorie Calculator Modal */}
      {showCalorieCalculator && (
        <div className="modal-overlay" onClick={() => setShowCalorieCalculator(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCalorieCalculator(false)}>×</button>
            <Suspense fallback={<div className="modal-loading"><span className="route-spinner" /></div>}>
              <CalorieCalculator token={token} profile={userProfile} />
            </Suspense>
          </div>
        </div>
      )}

      {/* Workout Timer Modal */}
      {showWorkoutTimer && (
        <div className="modal-overlay" onClick={closeTimer}>
          <div className="modal-box timer-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeTimer} aria-label="Close timer">×</button>
            <Suspense fallback={<div className="modal-loading"><span className="route-spinner" /></div>}>
              <WorkoutTimer ref={timerRef} token={token} onWorkoutComplete={handleWorkoutComplete} onClose={() => setShowWorkoutTimer(false)} />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
