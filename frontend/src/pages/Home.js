import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';
import API, { cachedGet } from '../services/api';
import StreakCalendar from '../components/StreakCalendar';
import NavIcons from '../components/NavIcons';
import AnnouncementBanner from '../components/AnnouncementBanner';
import Icon from '../components/Icon';
import StreakFreeze from '../components/StreakFreeze';
import ThemeToggle from '../components/ThemeToggle';
import { ChallengeList, useChallenges } from '../components/Challenges';
import { heatLevel } from '../utils/heat';
import { prefetchFeed } from '../utils/feedCache';
import { warmData } from '../utils/dataCache';
import { prefetchRoute } from '../utils/prefetch';
import { localDateKey, userTimeZone } from '../utils/time';


// Heavy widgets that are not needed for the first paint: loaded on demand (modals) or when idle (coach)
const loadCalorie = () => import('../components/CalorieCalculator');
const loadTimer = () => import('../components/WorkoutTimer');
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

// Live "Most minutes this week" race (only shown while you have a challenge going)
const HomeChallenge = ({ refreshKey }) => {
  const { items, reload } = useChallenges(refreshKey);
  const live = (items || []).filter((c) => c.status === 'active' || c.status === 'pending');
  if (!live.length) return null;
  return (
    <section className="home-challenge" aria-label="Friend challenge">
      <ChallengeList items={live} reload={reload} limit={1} compact />
    </section>
  );
};

const WEEKLY_GOAL = 5;                       // workouts per week shown on the dashboard ring
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const greeting = (demo = false) => {
  const h = new Date().getHours();
  return h < 5 ? (demo ? 'Still awake?' : 'Still up') : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
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
  const [showWorkoutTimer, setShowWorkoutTimer] = useState(false);
  const [streakKey, setStreakKey] = useState(0);
  const timerRef = useRef(null);
  // closing the timer while it runs asks: save / reset / keep going (handled inside WorkoutTimer)
  const closeTimer = () => (timerRef.current ? timerRef.current.requestClose() : setShowWorkoutTimer(false));

  const token = localStorage.getItem('token');
  const [userProfile, setUserProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  });
  const [liveStats, setLiveStats] = useState(() => {   // last known numbers (saved after every fetch) so tiles are filled on first paint
    try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return { streak: u.streak ?? null, points: u.points ?? null, totalWorkouts: u.totalWorkouts ?? null }; }
    catch { return { streak: null, points: null, totalWorkouts: null }; }
  });
  const [frozenDays, setFrozenDays] = useState(() => new Set(readDash()?.frozen || []));
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
        // Same URL as the streak calendar => one shared request instead of two identical ones
        const d = await cachedGet(`/workouts/daily-summary?year=${new Date().getFullYear()}&tz=${encodeURIComponent(userTimeZone)}`, { ttl: 0 });
        if (cancelled || !d.success) return;
        const m = {};
        (d.streak_data || []).forEach((e) => { m[e.date] = e.total_duration; });
        setDayTotals(m);
        const fz = Array.isArray(d.frozen_dates) ? d.frozen_dates : [];
        setFrozenDays(new Set(fz));
        writeDash({ ...(readDash() || {}), dayTotals: m, frozen: fz });
      } catch { if (!cancelled) setDayTotals((prev) => prev || {}); }
    })();
    return () => { cancelled = true; };
  }, [streakKey]);

  // Warm up Community in the background so it opens instantly: download its code chunk and
  // fetch + cache the first page of the feed while the user is still on Home.
  const warmCommunity = useCallback(() => {
    import('./Community').catch(() => {});
    prefetchFeed();
    warmData();                                  // Progress / Leaderboard / Profile data, ready before you tap
    ['/progress', '/leaderboard', '/profile', '/friends'].forEach((r) => prefetchRoute(r));   // and their code
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

  const openCoach = () => window.dispatchEvent(new Event('aivo:open-coach'));
  const goalLeft = Math.max(0, WEEKLY_GOAL - activeThisWeek);

  return (
    <div className="home-container">
      <div className="home-col">
        {/* Top bar */}
        <header className="home-top">
          <div className="ht-greet">
            <p className="ht-date"><Icon name="calendar" size={14} /> {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <h1>{userProfile?.is_demo ? greeting(true) : <>{greeting()}, <span className="ht-name">{firstName}</span></>}</h1>
            <p className="ht-sub">{subline}</p>
          </div>
          <div className="ht-actions">
            <NavIcons />
            <ThemeToggle className="ht-theme" />
            <button
              className={`nav-icon-btn ht-logout hide-on-desktop ${isLoggingOut ? 'loading' : ''}`}
              onClick={handleLogout}
              disabled={isLoggingOut}
              aria-label="Log out"
              title="Log out"
            >
              <Icon name="logout" size={19} />
            </button>
          </div>
        </header>

        <AnnouncementBanner />

        <main className="home-main">
          {/* This week — the focus of the page */}
          <section className="today-card card">
            <div className="tc-ring" aria-label={`${activeThisWeek} of ${WEEKLY_GOAL} workouts this week`}>
              {dayTotals ? (
                <>
                  <svg viewBox="0 0 128 128" width="100%" height="100%">
                    <circle cx="64" cy="64" r={RING_R} className="ring-track" />
                    <circle cx="64" cy="64" r={RING_R} className="ring-fill" strokeDasharray={RING_C}
                      strokeDashoffset={RING_C * (1 - ringPct)} transform="rotate(-90 64 64)" />
                  </svg>
                  <div className="ring-center">
                    <b>{activeThisWeek}<small>/{WEEKLY_GOAL}</small></b>
                    <span>workouts</span>
                  </div>
                </>
              ) : <div className="sk" style={{ width: '100%', height: '100%', borderRadius: '50%' }} />}
            </div>

            <div className="tc-body">
              <div className="tc-head">
                <h2>{activeThisWeek >= WEEKLY_GOAL ? 'Weekly goal reached' : `${goalLeft} more to hit your weekly goal`}</h2>
                <span className="chip"><Icon name="timer" size={13} /> {dayTotals ? `${todayMin} min today` : '…'}</span>
              </div>

              <div className="week-strip">
                {week.map((k, i) => {
                  const done = dayTotals && (dayTotals[k] || 0) > 0;
                  const lvl = done ? heatLevel(dayTotals[k]) : null;     // same colour steps as the streak calendar
                  const frozen = !done && frozenDays.has(k);
                  return (
                    <div key={k} className={`week-day ${done ? 'done' : ''} ${frozen ? 'frozen' : ''} ${k === todayKey ? 'today' : ''}`} title={frozen ? 'Rest day (streak freeze)' : undefined}>
                      <span className={`week-dot${lvl ? ` heat-${lvl}` : ''}`}>{done ? <Icon name="check" size={14} strokeWidth={3} /> : frozen ? <Icon name="snow" size={14} /> : null}</span>
                      <span className="week-letter">{DAY_LETTERS[i]}</span>
                    </div>
                  );
                })}
              </div>

              <StreakFreeze refreshKey={streakKey} onChange={handleWorkoutComplete} />

              <button className="cta-primary" onClick={() => setShowWorkoutTimer(true)} onPointerEnter={loadTimer}>
                <Icon name="play" size={18} />
                Start workout
              </button>
            </div>
          </section>

          {/* Totals */}
          <section className="stats-row" aria-label="Your totals">
            {stats.map((s) => (
              <div key={s.label} className={`stat-chip stat-${s.label.toLowerCase()}`}>
                <span className="stat-icon"><Icon name={s.icon} size={20} /></span>
                <span className="stat-text">
                  {s.value === null ? <span className="sk" style={{ width: 44, height: 24 }} /> : <span className="stat-value">{s.value}</span>}
                  <span className="stat-label">{s.label}</span>
                </span>
              </div>
            ))}
          </section>

          <HomeChallenge refreshKey={streakKey} />

          {/* Phone-only shortcuts: on desktop the sidebar already has every one of these */}
          <section className="quick-row" aria-label="Shortcuts">
            <button type="button" className="quick-tile qt-ai" onClick={openCoach}>
              <span className="quick-ic"><Icon name="bot" size={20} /></span>
              <span className="quick-tx"><strong>AI coach</strong><small>Plans &amp; form tips</small></span>
            </button>
            <button type="button" className="quick-tile" onClick={() => window.dispatchEvent(new Event('aivo:open-calc'))} onPointerEnter={loadCalorie}>
              <span className="quick-ic"><Icon name="calculator" size={20} /></span>
              <span className="quick-tx"><strong>Calories</strong><small>Daily target</small></span>
            </button>
            <button type="button" className="quick-tile" onClick={() => navigate('/leaderboard')}>
              <span className="quick-ic"><Icon name="trophy" size={20} /></span>
              <span className="quick-tx"><strong>Leaderboard</strong><small>Your rank</small></span>
            </button>
          </section>

          {/* Streak calendar */}
          <section className="streak-section">
            <StreakCalendar token={token} refreshKey={streakKey} />
          </section>
        </main>
      </div>

      {/* Floating AI coach — sits beside the streak calendar and follows you as you scroll */}
      <Suspense fallback={null}><AiCoach /></Suspense>


      {/* Workout Timer Modal */}
      {showWorkoutTimer && (
        <div className="modal-overlay" onClick={closeTimer}>
          <div className="modal-box timer-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeTimer} aria-label="Close timer"><Icon name="x" size={16} /></button>
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
