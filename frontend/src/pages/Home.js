import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';
import main_logo from './images/aivo_logo.png';
import API from '../services/api';
import CalorieCalculator from '../components/CalorieCalculator';
import WorkoutTimer from '../components/WorkoutTimer';
import StreakCalendar from '../components/StreakCalendar';
import NavIcons from '../components/NavIcons';


const Home = () => {
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showCalorieCalculator, setShowCalorieCalculator] = useState(false);
  const [showWorkoutTimer, setShowWorkoutTimer] = useState(false);
  const [streakKey, setStreakKey] = useState(0);

  const token = localStorage.getItem('token');
  const [userProfile, setUserProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; }
  });
  const [liveStats, setLiveStats] = useState({ streak: null, points: null, totalWorkouts: null });

  const firstName = userProfile?.full_name?.split(' ')[0] || 'Athlete';

  // Fetch fresh stats from backend
  const fetchLiveStats = useCallback(async () => {
    try {
      // Use analytics/progress-summary which has streak, points, total_workouts
      const res = await API.get('/analytics/progress-summary');
      if (res.data.success) {
        const s = res.data.summary;
        setLiveStats({
          streak: s.streak ?? 0,
          points: s.points ?? 0,
          totalWorkouts: s.total_workouts ?? 0,
        });
        // Update localStorage cache
        try {
          const stored = JSON.parse(localStorage.getItem('user') || '{}');
          stored.streak = s.streak ?? 0;
          stored.points = s.points ?? 0;
          stored.totalWorkouts = s.total_workouts ?? 0;
          localStorage.setItem('user', JSON.stringify(stored));
        } catch {}
      }
    } catch (e) {
      // Fallback to profile endpoint
      try {
        const profileRes = await API.get('/auth/profile');
        if (profileRes.data.success) {
          const u = profileRes.data.user;
          setLiveStats({
            streak: u.streak ?? 0,
            points: u.points ?? 0,
            totalWorkouts: null,
          });
        }
      } catch {
        // Use cached localStorage values
        const cached = JSON.parse(localStorage.getItem('user') || '{}');
        setLiveStats({
          streak: cached?.streak ?? null,
          points: cached?.points ?? null,
          totalWorkouts: cached?.totalWorkouts ?? null,
        });
      }
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    fetchLiveStats();
  }, []); // eslint-disable-line

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

  const stats = [
    { label: 'Workouts', value: liveStats.totalWorkouts !== null ? liveStats.totalWorkouts : (userProfile?.totalWorkouts ?? '—'), icon: '🔥' },
    { label: 'Streak',   value: liveStats.streak !== null ? `${liveStats.streak}d` : (userProfile?.streak != null ? `${userProfile.streak}d` : '—'), icon: '⚡' },
    { label: 'Points',   value: liveStats.points !== null ? liveStats.points : (userProfile?.points ?? '—'), icon: '🏆' },
  ];

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
            <img src={main_logo} alt="Aivo" className="main-logo" />
          </div>
          <NavIcons />
          <div className="nav-buttons">
            <button className="nav-button calorie-btn" onClick={() => setShowCalorieCalculator(true)}>
              <span>🔥</span> Calories
            </button>
            <button className="nav-button leaderboard-btn" onClick={() => navigate('/leaderboard')}>
              <span>🏆</span> Leaderboard
            </button>
            <button className="nav-button profile-btn" onClick={() => navigate('/profile')}>
              <span>👤</span> Profile
            </button>
            <button
              className={`nav-button logout-btn ${isLoggingOut ? 'loading' : ''}`}
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              <span>{isLoggingOut ? '⏳' : '🚪'}</span>
              {isLoggingOut ? 'Logging out…' : 'Logout'}
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="main-content">
        <section className="hero-section">
          <div className="hero-text">
            <div className="hero-badge">
              <span className="badge-dot"></span>
              Intelligent Fitness. Limitless You.
            </div>
            <h1 className="hero-title">
              Welcome back,<br />
              <span className="hero-name">{firstName}</span>
            </h1>
            <p className="hero-subtitle">
              Your personalized fitness journey powered by AI. Track, train, and transform — every single day.
            </p>
            <div className="hero-actions">
              <button className="cta-primary" onClick={() => setShowWorkoutTimer(true)}>
                <span className="cta-icon">▶</span>
                Start Workout
              </button>
              <button className="cta-secondary" onClick={() => navigate('/progress')}>
                <span className="cta-icon">📈</span>
                View Progress
              </button>
              <button className="cta-secondary" onClick={() => navigate('/community')}>
                <span className="cta-icon">🤝</span>
                Community
              </button>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-card-glow"></div>
            <div className="stats-row">
              {stats.map((s) => (
                <div key={s.label} className="stat-chip">
                  <span className="stat-icon">{s.icon}</span>
                  <span className="stat-value">{s.value}</span>
                  <span className="stat-label">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="hero-emoji-wrap">
              <div className="hero-emoji-ring">
                <span className="hero-emoji">🏃‍♂️</span>
              </div>
              <div className="pulse-ring r1"></div>
              <div className="pulse-ring r2"></div>
            </div>
          </div>
        </section>

        {/* Streak Calendar - Premium */}
        <section className="streak-section">
          <StreakCalendar token={token} refreshKey={streakKey} />
        </section>
      </main>

      {/* Calorie Calculator Modal */}
      {showCalorieCalculator && (
        <div className="modal-overlay" onClick={() => setShowCalorieCalculator(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCalorieCalculator(false)}>×</button>
            <CalorieCalculator token={token} profile={userProfile} />
          </div>
        </div>
      )}

      {/* Workout Timer Modal */}
      {showWorkoutTimer && (
        <div className="modal-overlay" onClick={() => setShowWorkoutTimer(false)}>
          <div className="modal-box timer-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowWorkoutTimer(false)}>×</button>
            <WorkoutTimer token={token} onWorkoutComplete={handleWorkoutComplete} onClose={() => setShowWorkoutTimer(false)} />
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
