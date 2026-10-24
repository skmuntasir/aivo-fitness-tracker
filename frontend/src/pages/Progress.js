import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import BackButton from '../components/BackButton';
import API from '../services/api';
import './Progress.css';

// Helper: display weight as integer (no decimals)
const fmtWeight = (w) => {
  if (!w && w !== 0) return '—';
  return String(Math.round(parseFloat(w)));
};

// ─── DEFAULTS (shown while loading, replaced by real API data) ────────────────
const EMPTY_STATS = {
  name: '',
  streak: 0,
  points: 0,
  totalWorkouts: 0,
  weeklyWorkouts: 0,
  prevWeekWorkouts: 0,
  totalCalories: 0,
  weekCalories: 0,
  prevWeekCalories: 0,
  consistencyPct: 0,
  prevConsistencyPct: 0,
  consecutiveDays: 0,
  weight: 0,
  targetWeight: 0,
  startWeight: 0,
  goalType: 'fat_loss',
  goalWeeks: 12,
  avgSleep: 7.0,
  hydration: 75,
};

const EMPTY_DAILY = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day => ({
  day, calories: 0, prevCalories: 0, duration: 0, sessions: 0,
}));

const EMPTY_WEIGHT = [
  { week:'Wk 1', weight: 0 }, { week:'Wk 2', weight: 0 },
  { week:'Wk 3', weight: 0 }, { week:'Wk 4', weight: 0 },
  { week:'Wk 5', weight: 0 }, { week:'Wk 6', weight: 0 },
];


// ─── AI LOGIC ENGINE ──────────────────────────────────────────────────────────
const computeHealthScore = (stats) => {
  if (!stats.totalWorkouts && !stats.streak) return 0;
  const consistency = Math.min(stats.consistencyPct, 100) * 0.30;
  const calBurn     = Math.min((stats.weekCalories / 4500) * 100, 100) * 0.20;
  const streakScore = Math.min((stats.streak / 21) * 100, 100) * 0.20;
  const sleepScore  = stats.avgSleep >= 7.5 ? 100 : (stats.avgSleep / 7.5) * 100;
  const sleep       = sleepScore * 0.15;
  const startW      = stats.startWeight || (stats.weight + 5);
  const goalProgress = startW > stats.targetWeight
    ? Math.min(((startW - stats.weight) / (startW - stats.targetWeight)) * 100, 100)
    : 50;
  const goal = goalProgress * 0.15;
  return Math.round(consistency + calBurn + streakScore + sleep + goal);
};

const getFatigueState = (stats) => {
  if (stats.consecutiveDays >= 6)
    return { label: 'Recovery Needed', level: 'critical', icon: '🔴', tip: 'Take 1–2 full rest days. Your muscles rebuild during recovery.' };
  if (stats.consecutiveDays >= 4 || stats.avgSleep < 6.5)
    return { label: 'Moderate Fatigue', level: 'warning', icon: '🟡', tip: 'Consider a light active recovery session like yoga or walking.' };
  return { label: 'Optimal', level: 'optimal', icon: '🟢', tip: "You're well-recovered. Push for a strong session today!" };
};

const generateRecommendations = (stats) => {
  const recs = [];
  if (stats.consecutiveDays >= 4)
    recs.push({ icon:'💤', title:'Schedule a Rest Day', desc:`${stats.consecutiveDays} consecutive workout days detected. Active recovery prevents injury and boosts performance.`, type:'recovery' });
  if (stats.hydration < 75)
    recs.push({ icon:'💧', title:'Boost Hydration', desc:`You're at ${stats.hydration}% of your daily water goal. Aim for 8–10 glasses — dehydration reduces strength by up to 15%.`, type:'hydration' });
  if (stats.weeklyWorkouts >= 5 && stats.weekCalories > 4000)
    recs.push({ icon:'⚡', title:'Try High-Intensity Intervals', desc:'Your volume is solid. Add one HIIT session this week to break a plateau and torch extra fat.', type:'intensity' });
  if (stats.consistencyPct < 70)
    recs.push({ icon:'📅', title:'Fix Your Consistency', desc:"You're hitting only 2–3 workouts per week. Schedule fixed time slots to lock in your habit.", type:'consistency' });
  if (stats.weeklyWorkouts < 3)
    recs.push({ icon:'🏃', title:'Add More Cardio', desc:'Increase to at least 3 cardio sessions/week. Even 20-minute walks count for fat oxidation.', type:'cardio' });
  if (stats.avgSleep < 7)
    recs.push({ icon:'🌙', title:'Prioritize Sleep', desc:`Only ${stats.avgSleep}h avg sleep. Below 7h suppresses testosterone and growth hormone. Aim for 7.5–9h.`, type:'sleep' });
  if (recs.length < 2)
    recs.push({ icon:'💪', title:'Add Strength Training', desc:'Building muscle increases your RMR, burning more calories at rest. Aim for 2 strength sessions/week.', type:'strength' });
  return recs.slice(0, 4);
};

const generateGoalPrediction = (stats) => {
  const weeklyBurn    = stats.weekCalories;
  const maintenance   = 2200;
  const deficitKcal   = Math.max(weeklyBurn - maintenance * 7, 0);
  const weeklyLossKg  = parseFloat((deficitKcal / 7700).toFixed(2));
  const remaining     = Math.max(stats.weight - stats.targetWeight, 0);
  const weeks         = weeklyLossKg > 0 ? Math.ceil(remaining / weeklyLossKg) : 99;
  const isAhead       = stats.totalWorkouts > 0 && weeks < stats.goalWeeks;
  return {
    weeks,
    isAhead,
    weeklyLoss: weeklyLossKg,
    remaining:  remaining.toFixed(1),
    label:      isAhead ? '🚀 Ahead of schedule!' : weeks < 99 ? `⏱ ~${weeks} weeks to goal` : '📊 Log workouts to predict',
    sublabel:   isAhead
      ? `Burning ${stats.weekCalories.toLocaleString()} kcal/week — keep this up!`
      : `Increase weekly calorie burn to reach goal sooner`,
  };
};

// ─── RADAR DATA (computed from real stats) ────────────────────────────────────
const buildRadarData = (stats) => [
  { subject: 'Strength',    A: Math.min(stats.totalWorkouts * 2, 90),   fullMark: 100 },
  { subject: 'Cardio',      A: Math.min(stats.consistencyPct * 0.8, 90), fullMark: 100 },
  { subject: 'Consistency', A: stats.consistencyPct,                    fullMark: 100 },
  { subject: 'Recovery',    A: stats.consecutiveDays >= 6 ? 30 : stats.consecutiveDays >= 4 ? 55 : 85, fullMark: 100 },
  { subject: 'Endurance',   A: Math.min(stats.weekCalories / 50, 90),   fullMark: 100 },
  { subject: 'Progress',    A: Math.min(stats.streak * 4, 90),          fullMark: 100 },
];

// ─── ANIMATED CIRCULAR PROGRESS ───────────────────────────────────────────────
const CircularScore = ({ score, size = 180, strokeWidth = 14 }) => {
  const [animated, setAnimated] = useState(0);
  const radius      = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset      = circumference - (animated / 100) * circumference;
  const color       = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
  const label       = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score > 0 ? 'Needs Work' : 'No data yet';

  // requestAnimationFrame tween (was a 16ms setInterval doing ~60 React re-renders, with a cleanup that never ran)
  useEffect(() => {
    let raf = 0;
    const timer = setTimeout(() => {
      const t0 = performance.now(), dur = 1000;
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        setAnimated(p >= 1 ? score : Math.round(score * p));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, 400);
    return () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  }, [score]);

  return (
    <div className="circular-score-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor={color} stopOpacity="0.9" />
            <stop offset="100%" stopColor={score >= 80 ? '#059669' : score >= 60 ? '#d97706' : '#dc2626'} />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
            <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={strokeWidth}/>
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke="url(#scoreGrad)" strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}
          style={{ transition:'stroke-dashoffset 0.05s linear', filter:'url(#glow)' }}
        />
      </svg>
      <div className="circular-score-inner">
        <span className="score-number">{animated}</span>
        <span className="score-label" style={{ color }}>{label}</span>
      </div>
    </div>
  );
};

// ─── ANIMATED COUNTER ─────────────────────────────────────────────────────────
const AnimatedNum = ({ value, suffix='', decimals=0 }) => {
  const [disp, setDisp] = useState(0);
  useEffect(() => {
    const end = parseFloat(value) || 0;
    if (end === 0) { setDisp(0); return undefined; }
    let raf = 0;
    const t0 = performance.now(), dur = 1000;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      setDisp(p >= 1 ? end : parseFloat((end * p).toFixed(decimals)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, decimals]);
  return <>{decimals > 0 ? disp.toFixed(decimals) : Math.round(disp).toLocaleString()}{suffix}</>;
};

// ─── TOOLTIP ──────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background:'rgba(8,14,32,0.97)', border:'1px solid rgba(255,255,255,0.13)', borderRadius:14, padding:'10px 16px' }}>
      <p style={{ margin:0, color:'#a8b9ff', fontSize:'0.82rem', marginBottom:6 }}>{label}</p>
      {payload.map((p,i) => (
        <p key={i} style={{ margin:'3px 0', color:p.color, fontSize:'0.9rem', fontWeight:600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
};

// ─── LOADING SKELETON ─────────────────────────────────────────────────────────
const Skeleton = ({ h = 24, w = '100%', radius = 8 }) => (
  <div style={{ height: h, width: w, borderRadius: radius, background: 'rgba(255,255,255,0.07)', animation: 'shimmer 1.5s infinite' }} />
);

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
const Progress = () => {
  const [stats, setStats]         = useState(EMPTY_STATS);
  const [dailyData, setDailyData] = useState(EMPTY_DAILY);
  const [weightData, setWeightData] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  // ── Fetch real data from backend ──────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await API.get('/analytics/progress-summary');

        if (res.data.success) {
          const s = res.data.summary;

          // Map backend keys → component state keys
          setStats({
            name:               s.name || 'Athlete',
            streak:             s.streak || 0,
            points:             s.points || 0,
            totalWorkouts:      s.total_workouts || 0,
            weeklyWorkouts:     s.weekly_workouts || 0,
            prevWeekWorkouts:   s.prev_week_workouts || 0,
            totalCalories:      s.total_calories || 0,
            weekCalories:       s.week_calories || 0,
            prevWeekCalories:   s.prev_week_calories || 0,
            consistencyPct:     s.consistency_pct || 0,
            prevConsistencyPct: s.prev_consistency_pct || 0,
            consecutiveDays:    s.consecutive_days || 0,
            weight:             s.weight || 0,
            targetWeight:       s.target_weight || 0,
            startWeight:        s.start_weight || 0,
            goalType:           s.goal_type || 'fat_loss',
            goalWeeks:          s.goal_weeks || 12,
            avgSleep:           s.avg_sleep || 7.0,
            hydration:          s.hydration || 75,
          });

          // Build daily chart data (merge this week + prev week)
          const thisWeek = s.daily_data || EMPTY_DAILY;
          const prevWeek = s.prev_daily_data || EMPTY_DAILY;
          const combined = thisWeek.map((d, i) => ({
            ...d,
            prevCalories: prevWeek[i]?.calories || 0,
            prevDuration: prevWeek[i]?.duration || 0,
          }));
          setDailyData(combined);

          setWeightData(s.weight_history || []);   // real entries only (backend no longer fabricates a trend)

        } else {
          setError('Could not load your fitness data. Please try again.');
        }
      } catch (err) {
        console.error('Progress API error:', err);
        setError('Backend connection failed. Make sure your Flask server is running on port 5000.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // ── Derived / memoised values ─────────────────────────────────────────────
  const healthScore     = useMemo(() => computeHealthScore(stats), [stats]);
  const fatigue         = useMemo(() => getFatigueState(stats), [stats]);
  const recommendations = useMemo(() => generateRecommendations(stats), [stats]);
  const goalPred        = useMemo(() => generateGoalPrediction(stats), [stats]);
  const radarData       = useMemo(() => buildRadarData(stats), [stats]);

  const calDiff         = stats.weekCalories - stats.prevWeekCalories;
  const calDiffPct      = stats.prevWeekCalories > 0
    ? Math.round((calDiff / stats.prevWeekCalories) * 100) : 0;
  const consDiff        = stats.consistencyPct - stats.prevConsistencyPct;
  const workoutDiff     = stats.weeklyWorkouts  - stats.prevWeekWorkouts;

  const goalProgressPct = stats.startWeight > stats.targetWeight
    ? Math.round(((stats.startWeight - stats.weight) / (stats.startWeight - stats.targetWeight)) * 100)
    : 0;

  // ── Error state ───────────────────────────────────────────────────────────
  if (error && !loading) {
    return (
      <div className="progress-page">
        <div className="pg-bg">
          <div className="pg-bg-grid"/>
          <div className="pg-bg-orb pg-orb1"/><div className="pg-bg-orb pg-orb2"/><div className="pg-bg-orb pg-orb3"/>
        </div>
        <BackButton />
        <div className="pg-content" style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'60vh' }}>
          <div className="glass-panel" style={{ padding:'40px', textAlign:'center', maxWidth:'500px' }}>
            <div style={{ fontSize:'3rem', marginBottom:'16px' }}>⚠️</div>
            <h2 style={{ color:'#f87171', marginBottom:'12px' }}>Backend Not Connected</h2>
            <p style={{ color:'#7a8bb0', lineHeight:1.7, marginBottom:'20px' }}>{error}</p>
            <code style={{ background:'rgba(255,255,255,0.06)', padding:'8px 16px', borderRadius:'8px', fontSize:'0.82rem', color:'#a8b9ff' }}>
              cd backend && python app.py
            </code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="progress-page">
      {/* Animated background */}
      <div className="pg-bg">
        <div className="pg-bg-grid"/>
        <div className="pg-bg-orb pg-orb1"/><div className="pg-bg-orb pg-orb2"/><div className="pg-bg-orb pg-orb3"/>
      </div>

      <BackButton />

      <div className="pg-content">
        {/* ── HEADER ──────────────────────────────────────────────── */}
        <header className="pg-header glass-panel">
          <div className="pg-header-left">
            <span className="pg-eyebrow">AI INTELLIGENCE DASHBOARD</span>
            <h1 className="pg-title">
              {loading ? 'Loading your data…' : `${stats.name ? stats.name + "'s " : ''}Fitness`}
              {' '}<span className="pg-title-accent">Command Center</span>
            </h1>
            <p className="pg-subtitle">Real-time analytics pulled live from your workout history.</p>
          </div>
          <div className="pg-header-right">
            <div className="pg-quick-stats">
              {loading ? (
                <div style={{ padding:'20px 32px' }}><Skeleton h={48} w={200}/></div>
              ) : (
                <>
                  <div className="pqs-item">
                    <span className="pqs-val">{stats.streak}</span>
                    <span className="pqs-lbl">🔥 Day Streak</span>
                  </div>
                  <div className="pqs-divider"/>
                  <div className="pqs-item">
                    <span className="pqs-val">{stats.totalWorkouts}</span>
                    <span className="pqs-lbl">💪 Workouts</span>
                  </div>
                  <div className="pqs-divider"/>
                  <div className="pqs-item">
                    <span className="pqs-val">{stats.weight > 0 ? fmtWeight(stats.weight) : '—'}<span style={{ fontSize:'1rem' }}>{stats.weight > 0 ? 'kg' : ''}</span></span>
                    <span className="pqs-lbl">⚖️ Current</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* ── TABS ──────────────────────────────────────────────────── */}
        <div className="pg-tabs">
          {['overview','analytics','goals','recovery'].map(t => (
            <button key={t} className={`pg-tab ${activeTab===t?'active':''}`} onClick={() => setActiveTab(t)}>
              {{ overview:'🏠 Overview', analytics:'📊 Analytics', goals:'🎯 Goals', recovery:'💤 Recovery' }[t]}
            </button>
          ))}
        </div>

        {/* ══════════════ OVERVIEW TAB ══════════════ */}
        {activeTab === 'overview' && (
          <div className="pg-tab-content">
            <div className="pg-row pg-row-top">

              {/* AI Health Score */}
              <div className="pg-card glass-panel pg-score-card">
                <div className="pgc-header">
                  <span className="pgc-icon">🧠</span>
                  <div>
                    <div className="pgc-title">AI Health Score</div>
                    <div className="pgc-sub">{loading ? 'Calculating…' : 'Based on your real data'}</div>
                  </div>
                </div>
                <div className="pg-score-body">
                  {loading ? <Skeleton h={180} w={180} radius={90}/> : <CircularScore score={healthScore}/>}
                  <div className="pg-score-breakdown">
                    {[
                      { label:'Consistency',  val: stats.consistencyPct,                                           color:'#818cf8' },
                      { label:'Calorie Burn', val: Math.round(Math.min((stats.weekCalories/4500)*100,100)),         color:'#fb923c' },
                      { label:'Streak Bonus', val: Math.min(Math.round((stats.streak/21)*100),100),                 color:'#f472b6' },
                      { label:'Recovery',     val: fatigue.level==='optimal'?88:fatigue.level==='warning'?60:35,    color:'#34d399' },
                    ].map(item => (
                      <div key={item.label} className="pg-score-bar-row">
                        <span>{item.label}</span>
                        <div className="pg-score-bar-track">
                          <div className="pg-score-bar-fill" style={{ width:`${loading?0:item.val}%`, background:item.color }}/>
                        </div>
                        <span style={{ color:item.color }}>{loading ? '—' : `${item.val}%`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Weekly AI Summary */}
              <div className="pg-card glass-panel pg-summary-card">
                <div className="pgc-header">
                  <span className="pgc-icon">📋</span>
                  <div>
                    <div className="pgc-title">Weekly AI Summary</div>
                    <div className="pgc-sub">vs previous week</div>
                  </div>
                </div>
                {loading ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    <Skeleton h={60}/><Skeleton h={80}/><Skeleton h={60}/>
                  </div>
                ) : (
                  <>
                    <div className="pg-summary-quote">
                      {stats.totalWorkouts === 0
                        ? '"No workouts logged yet. Complete your first workout to see your AI summary here! 🚀"'
                        : `"You completed ${stats.weeklyWorkouts} workout${stats.weeklyWorkouts!==1?'s':''} this week, burned ${stats.weekCalories.toLocaleString()} kcal, and ${consDiff >= 0 ? `improved consistency by ${consDiff}%` : `had ${Math.abs(consDiff)}% less consistency than last week`}. ${goalPred.isAhead ? "You're ahead of schedule! 🚀" : 'Keep pushing toward your goal. 💪'}"`
                      }
                    </div>
                    <div className="pg-kpi-row">
                      <div className="pg-kpi">
                        <div className="pg-kpi-val"><AnimatedNum value={stats.weekCalories}/></div>
                        <div className="pg-kpi-lbl">Kcal Burned</div>
                        <div className={`pg-kpi-trend ${calDiff>=0?'up':'down'}`}>
                          {calDiff>=0?'↑':'↓'} {Math.abs(calDiffPct)}% vs last wk
                        </div>
                      </div>
                      <div className="pg-kpi">
                        <div className="pg-kpi-val"><AnimatedNum value={stats.weeklyWorkouts}/></div>
                        <div className="pg-kpi-lbl">Sessions</div>
                        <div className={`pg-kpi-trend ${workoutDiff>=0?'up':'down'}`}>
                          {workoutDiff>=0?'↑':'↓'} {Math.abs(workoutDiff)} vs last wk
                        </div>
                      </div>
                      <div className="pg-kpi">
                        <div className="pg-kpi-val"><AnimatedNum value={stats.consistencyPct} suffix="%"/></div>
                        <div className="pg-kpi-lbl">Consistency</div>
                        <div className={`pg-kpi-trend ${consDiff>=0?'up':'down'}`}>
                          {consDiff>=0?'↑':'↓'} {Math.abs(consDiff)}% vs last wk
                        </div>
                      </div>
                    </div>
                    <div className="pg-weekly-bars">
                      {dailyData.map((d,i) => (
                        <div key={d.day} className="pg-day-bar-wrap">
                          <div className="pg-day-bar-track">
                            <div className="pg-day-bar-fill" style={{
                              height: d.calories > 0 ? `${Math.max((d.calories/600)*100,8)}%` : '4%',
                              background: d.sessions > 0 ? 'linear-gradient(180deg,#818cf8,#6366f1)' : 'rgba(255,255,255,0.1)',
                              animationDelay:`${i*80}ms`
                            }}/>
                          </div>
                          <span className="pg-day-lbl">{d.day[0]}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* AI Recommendations */}
              <div className="pg-card glass-panel pg-recs-card">
                <div className="pgc-header">
                  <span className="pgc-icon">💡</span>
                  <div>
                    <div className="pgc-title">Smart AI Recommendations</div>
                    <div className="pgc-sub">Based on your real activity</div>
                  </div>
                </div>
                {loading ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    {[1,2,3,4].map(i => <Skeleton key={i} h={70}/>)}
                  </div>
                ) : (
                  <div className="pg-recs-list">
                    {recommendations.map((r,i) => (
                      <div key={i} className={`pg-rec-item pg-rec-${r.type}`} style={{ animationDelay:`${i*100}ms` }}>
                        <span className="pg-rec-icon">{r.icon}</span>
                        <div className="pg-rec-body">
                          <strong>{r.title}</strong>
                          <p>{r.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Charts row */}
            <div className="pg-row pg-row-charts">
              <div className="pg-card glass-panel pg-chart-card">
                <div className="pgc-header">
                  <span className="pgc-icon">🔥</span>
                  <div>
                    <div className="pgc-title">Calories Burned — This vs Last Week</div>
                    <div className="pgc-sub">Daily comparison from your workouts</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={dailyData} margin={{ top:10, right:10, left:-10, bottom:0 }}>
                    <defs>
                      <linearGradient id="calGrad1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#818cf8" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#818cf8" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="calGrad2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#fb923c" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#fb923c" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false}/>
                    <XAxis dataKey="day" stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={12}/>
                    <YAxis stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={11}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Legend wrapperStyle={{ color:'#9bb4da', fontSize:12 }}/>
                    <Area type="monotone" dataKey="calories"     name="This Week" stroke="#818cf8" strokeWidth={2.5} fill="url(#calGrad1)" dot={false}/>
                    <Area type="monotone" dataKey="prevCalories" name="Last Week"  stroke="#fb923c" strokeWidth={2}   strokeDasharray="5 3" fill="url(#calGrad2)" dot={false}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="pg-card glass-panel pg-radar-card">
                <div className="pgc-header">
                  <span className="pgc-icon">🕸️</span>
                  <div>
                    <div className="pgc-title">Fitness Profile</div>
                    <div className="pgc-sub">Computed from your real metrics</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={radarData} margin={{ top:10, right:30, left:30, bottom:10 }}>
                    <PolarGrid stroke="rgba(255,255,255,0.1)"/>
                    <PolarAngleAxis dataKey="subject" tick={{ fill:'#9bb4da', fontSize:11 }}/>
                    <Radar name="You" dataKey="A" stroke="#818cf8" fill="#818cf8" fillOpacity={0.25} strokeWidth={2}/>
                    <Tooltip content={<CustomTooltip/>}/>
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ ANALYTICS TAB ══════════════ */}
        {activeTab === 'analytics' && (
          <div className="pg-tab-content">
            <div className="pg-row pg-row-full">
              <div className="pg-card glass-panel pg-chart-card-lg">
                <div className="pgc-header">
                  <span className="pgc-icon">⏱️</span>
                  <div>
                    <div className="pgc-title">Session Duration This Week</div>
                    <div className="pgc-sub">Minutes per day from your logs</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyData} margin={{ top:10, right:10, left:-10, bottom:0 }}>
                    <defs>
                      <linearGradient id="durGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#34d399"/>
                        <stop offset="100%" stopColor="#059669"/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false}/>
                    <XAxis dataKey="day" stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={12}/>
                    <YAxis stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={11}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Bar dataKey="duration" name="Minutes" fill="url(#durGrad)" radius={[8,8,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="pg-card glass-panel pg-chart-card-lg">
                <div className="pgc-header">
                  <span className="pgc-icon">📅</span>
                  <div>
                    <div className="pgc-title">This Week vs Last Week Duration</div>
                    <div className="pgc-sub">Side-by-side comparison</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyData} margin={{ top:10, right:10, left:-10, bottom:0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false}/>
                    <XAxis dataKey="day" stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={12}/>
                    <YAxis stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={11}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Legend wrapperStyle={{ color:'#9bb4da', fontSize:12 }}/>
                    <Bar dataKey="duration"     name="This Week" fill="#818cf8" radius={[6,6,0,0]}/>
                    <Bar dataKey="prevDuration" name="Last Week"  fill="#fb923c" radius={[6,6,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Weight trend */}
            <div className="pg-row pg-row-charts">
              <div className="pg-card glass-panel pg-chart-card">
                <div className="pgc-header">
                  <span className="pgc-icon">⚖️</span>
                  <div>
                    <div className="pgc-title">Weight Trend</div>
                    <div className="pgc-sub">kg from your profile history</div>
                  </div>
                </div>
{weightData.length < 2 ? (
                  <p className="pg-fatigue-tip" style={{ padding: '60px 12px', textAlign: 'center' }}>
                    Update your weight on the Profile page to start building your weight trend.
                  </p>
                ) : (
                                <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={weightData} margin={{ top:10, right:10, left:-10, bottom:0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false}/>
                      <XAxis dataKey="week" stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={12}/>
                      <YAxis stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={11}/>
                      <Tooltip content={<CustomTooltip/>}/>
                      <Line type="monotone" dataKey="weight" name="Weight (kg)" stroke="#5eead4" strokeWidth={2.5} dot={{ fill:'#5eead4', r:4 }} activeDot={{ r:7 }}/>
                      {stats.targetWeight > 0 && (
                        <Line type="monotone" dataKey={() => stats.targetWeight} name="Target" stroke="#f87171" strokeWidth={1.5} strokeDasharray="6 3" dot={false}/>
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Activity table */}
              <div className="pg-card glass-panel pg-chart-card">
                <div className="pgc-header">
                  <span className="pgc-icon">📊</span>
                  <div>
                    <div className="pgc-title">Daily Activity Log</div>
                    <div className="pgc-sub">This week's real sessions</div>
                  </div>
                </div>
                <div className="pg-table-wrap">
                  <table className="pg-table">
                    <thead>
                      <tr><th>Day</th><th>Calories</th><th>Duration</th><th>Sessions</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {dailyData.map((d,i) => (
                        <tr key={d.day} style={{ animationDelay:`${i*60}ms` }}>
                          <td><strong>{d.day}</strong></td>
                          <td><span style={{ color:'#fb923c' }}>{d.calories > 0 ? `${d.calories} kcal` : '—'}</span></td>
                          <td>{d.duration > 0 ? `${d.duration} min` : '—'}</td>
                          <td>{d.sessions}</td>
                          <td>
                            <span className={`pg-status-badge ${d.sessions > 0 ? 'great' : 'low'}`}>
                              {d.sessions > 0 ? '✅ Active' : '😴 Rest'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ GOALS TAB ══════════════ */}
        {activeTab === 'goals' && (
          <div className="pg-tab-content">
            <div className="pg-row pg-row-goals">
              <div className="pg-card glass-panel pg-goal-pred">
                <div className="pgc-header">
                  <span className="pgc-icon">🎯</span>
                  <div>
                    <div className="pgc-title">Goal Prediction System</div>
                    <div className="pgc-sub">AI-calculated from your real calorie data</div>
                  </div>
                </div>
                <div className="pg-goal-hero">
                  <div className={`pg-goal-badge ${goalPred.isAhead?'ahead':'ontrack'}`}>{goalPred.label}</div>
                  <p className="pg-goal-sub">{goalPred.sublabel}</p>
                </div>
                <div className="pg-goal-metrics">
                  {[
                    { label:'Current Weight',  val: stats.weight > 0 ? `${fmtWeight(stats.weight)} kg` : '—',       icon:'⚖️', color:'#5eead4' },
                    { label:'Target Weight',   val: stats.targetWeight > 0 ? `${fmtWeight(stats.targetWeight)} kg` : '—', icon:'🎯', color:'#818cf8' },
                    { label:'Remaining',       val: `${goalPred.remaining} kg`,                            icon:'📉', color:'#f472b6' },
                    { label:'Weekly Loss Est', val: `${goalPred.weeklyLoss} kg/wk`,                        icon:'📊', color:'#fbbf24' },
                    { label:'ETA',             val: goalPred.weeks < 99 ? `${goalPred.weeks} wks` : '—',   icon:'⏱️', color:'#34d399' },
                    { label:'Goal Type',       val: stats.goalType.replace('_',' '),                       icon:'🏃', color:'#fb923c' },
                  ].map(m => (
                    <div key={m.label} className="pg-goal-metric">
                      <span className="pgm-icon">{m.icon}</span>
                      <div>
                        <div className="pgm-val" style={{ color:m.color }}>{m.val}</div>
                        <div className="pgm-lbl">{m.label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {stats.weight > 0 && stats.targetWeight > 0 && (
                  <div className="pg-goal-progress-wrap">
                    <div className="pgp-labels">
                      <span>Start: {stats.startWeight} kg</span>
                      <span style={{ color:'#34d399' }}>Now: {fmtWeight(stats.weight)} kg</span>
                      <span>Target: {fmtWeight(stats.targetWeight)} kg</span>
                    </div>
                    <div className="pgp-track">
                      <div className="pgp-fill" style={{ width:`${Math.min(Math.max(goalProgressPct,0),100)}%` }}>
                        <span className="pgp-pct">{goalProgressPct}%</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Secondary Goals */}
              <div className="pg-card glass-panel pg-secondary-goals">
                <div className="pgc-header">
                  <span className="pgc-icon">🏆</span>
                  <div>
                    <div className="pgc-title">Fitness Milestones</div>
                    <div className="pgc-sub">Tracked from your real data</div>
                  </div>
                </div>
                {[
                  { label:'Reach 30-day streak',     current:stats.streak,          target:30,   unit:'days', color:'#f472b6', icon:'🔥' },
                  { label:'Burn 3000 kcal/week',      current:stats.weekCalories,    target:3000, unit:'kcal', color:'#fb923c', icon:'🔥' },
                  { label:'100% weekly consistency',  current:stats.consistencyPct,  target:100,  unit:'%',    color:'#818cf8', icon:'📅' },
                  { label:'Complete 50 workouts',     current:stats.totalWorkouts,   target:50,   unit:'',     color:'#34d399', icon:'💪' },
                  { label:'Reach 5-day streak',       current:stats.streak,          target:5,    unit:'days', color:'#5eead4', icon:'⚡' },
                ].map(g => (
                  <div key={g.label} className="pg-sec-goal">
                    <div className="psg-top">
                      <span>{g.icon} {g.label}</span>
                      <span style={{ color:g.color }}>{Math.min(g.current,g.target)}/{g.target} {g.unit}</span>
                    </div>
                    <div className="psg-track">
                      <div className="psg-fill" style={{ width:`${Math.min((g.current/g.target)*100,100)}%`, background:g.color }}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 12-week trajectory */}
            <div className="pg-card glass-panel">
              <div className="pgc-header">
                <span className="pgc-icon">📈</span>
                <div>
                  <div className="pgc-title">12-Week Goal Trajectory</div>
                  <div className="pgc-sub">Predicted vs target based on your current pace</div>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={Array.from({ length:12 }, (_,i) => ({
                    week: `Wk ${i+1}`,
                    predicted: stats.weight > 0 ? Math.round(stats.weight - i * goalPred.weeklyLoss) : null,
                    target:    stats.weight > 0 && stats.targetWeight > 0
                      ? Math.round(stats.weight - i * ((stats.weight - stats.targetWeight)/12)) : null,
                  }))}
                  margin={{ top:10, right:10, left:-10, bottom:0 }}
                >
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false}/>
                  <XAxis dataKey="week" stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={12}/>
                  <YAxis stroke="#7a8aaa" tickLine={false} axisLine={false} fontSize={11}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Legend wrapperStyle={{ color:'#9bb4da', fontSize:12 }}/>
                  <Line type="monotone" dataKey="predicted" name="Your Pace"    stroke="#818cf8" strokeWidth={2.5} dot={{ fill:'#818cf8', r:3 }}/>
                  <Line type="monotone" dataKey="target"    name="Target Pace"  stroke="#34d399" strokeWidth={2}   strokeDasharray="6 3" dot={false}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ══════════════ RECOVERY TAB ══════════════ */}
        {activeTab === 'recovery' && (
          <div className="pg-tab-content">
            <div className="pg-row pg-row-recovery">
              <div className="pg-card glass-panel pg-fatigue-card">
                <div className="pgc-header">
                  <span className="pgc-icon">🛡️</span>
                  <div>
                    <div className="pgc-title">Fatigue & Recovery Status</div>
                    <div className="pgc-sub">Detected from your workout patterns</div>
                  </div>
                </div>
                <div className={`pg-fatigue-hero pg-fatigue-${fatigue.level}`}>
                  <div className="pg-fatigue-icon">{fatigue.icon}</div>
                  <div className="pg-fatigue-label">{fatigue.label}</div>
                  <p className="pg-fatigue-tip">{fatigue.tip}</p>
                </div>
                <div className="pg-fatigue-metrics">
                  {[
                    { label:'Consecutive Days', val:`${stats.consecutiveDays} days`, warn:stats.consecutiveDays>=4, icon:'📆' },
                    { label:'Avg Sleep (est.)',   val:`${stats.avgSleep}h / night`,    warn:stats.avgSleep<7,         icon:'😴' },
                    { label:'Hydration (est.)',    val:`${stats.hydration}%`,          warn:stats.hydration<75,       icon:'💧' },
                    { label:'Recovery Score',     val:fatigue.level==='optimal'?'88/100':fatigue.level==='warning'?'61/100':'34/100', warn:fatigue.level!=='optimal', icon:'❤️‍🩹' },
                  ].map(m => (
                    <div key={m.label} className={`pg-fat-metric ${m.warn?'warn':''}`}>
                      <span>{m.icon}</span>
                      <div>
                        <div className="pgfm-val">{m.val}</div>
                        <div className="pgfm-lbl">{m.label}</div>
                      </div>
                      {m.warn && <span className="pgfm-warn">⚠️</span>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pg-card glass-panel">
                <div className="pgc-header">
                  <span className="pgc-icon">📋</span>
                  <div>
                    <div className="pgc-title">AI Recovery Protocol</div>
                    <div className="pgc-sub">Personalized for your current status</div>
                  </div>
                </div>
                <div className="pg-recovery-plan">
                  {[
                    { time:'Morning', action:'Drink 500ml water immediately upon waking', priority:'high', icon:'💧' },
                    { time:'8:00 AM', action:'10-minute light yoga or mobility work', priority:fatigue.level==='critical'?'high':'medium', icon:'🧘' },
                    { time:'12:00 PM', action:'High-protein lunch: chicken, rice, greens (700 kcal)', priority:'medium', icon:'🥗' },
                    { time:'3:00 PM', action:fatigue.level==='critical'?'Full rest — no training today':'20-min walk or gentle cardio', priority:fatigue.level==='critical'?'high':'low', icon:'🚶' },
                    { time:'8:00 PM', action:'Foam roll for 10 min. Target glutes + hamstrings', priority:'medium', icon:'🎯' },
                    { time:'Night', action:'Sleep by 10:30 PM for full 8h recovery cycle', priority:'high', icon:'🌙' },
                  ].map((step,i) => (
                    <div key={i} className="pg-rec-step" style={{ animationDelay:`${i*80}ms` }}>
                      <div className="prs-time">{step.time}</div>
                      <div className={`prs-dot prs-dot-${step.priority}`}/>
                      <div className="prs-body"><span className="prs-icon">{step.icon}</span><span>{step.action}</span></div>
                      <span className={`prs-badge prs-${step.priority}`}>{step.priority}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pg-row pg-row-charts">
              {[
                { title:'Consecutive Day Risk', desc:`Training ${stats.consecutiveDays} days straight ${stats.consecutiveDays>=4?`raises injury risk by ~${stats.consecutiveDays*8}%. A rest day now resets cortisol and boosts your next session by ~15%.`:'is within safe limits. Continue monitoring.'}`, icon:'🚨', color:'#f87171' },
                { title:'Sleep & Performance', desc:`At ${stats.avgSleep}h average sleep, ${stats.avgSleep<7?'you\'re slightly under the 7h minimum. Each hour under 7h reduces fat metabolism by ~55%. Try sleeping 30 min earlier tonight.':'you\'re in the optimal recovery range. Keep this up for peak performance.'}`, icon:'😴', color:'#818cf8' },
                { title:'Hydration Impact', desc:`At ${stats.hydration}% hydration, ${stats.hydration<75?'you may be losing up to 7% strength. Drinking 500ml pre-workout closes this gap significantly.':'you\'re well-hydrated. Maintain this level for optimal performance and recovery.'}`, icon:'💧', color:'#5eead4' },
              ].map((insight,i) => (
                <div key={i} className="pg-card glass-panel pg-insight-card" style={{ animationDelay:`${i*100}ms` }}>
                  <div className="pg-insight-icon" style={{ color:insight.color }}>{insight.icon}</div>
                  <h3 style={{ color:insight.color }}>{insight.title}</h3>
                  <p>{insight.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Progress;
