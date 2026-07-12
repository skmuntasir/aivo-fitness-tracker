import React, { useState, useRef, useEffect } from "react";
import API from "../services/api";

const ACTIVITIES = [
  { value: "Running",    label: "Running",    icon: "🏃",  color: "#f97316" },
  { value: "Walking",    label: "Walking",    icon: "🚶",  color: "#22c55e" },
  { value: "Strength",   label: "Strength",   icon: "💪",  color: "#3b82f6" },
  { value: "Cycling",    label: "Cycling",    icon: "🚴",  color: "#a855f7" },
  { value: "Swimming",   label: "Swimming",   icon: "🏊",  color: "#06b6d4" },
  { value: "Yoga",       label: "Yoga",       icon: "🧘",  color: "#632142" },
  { value: "Push Ups",   label: "Push Ups",   icon: "⚡",  color: "#eab308" },
  { value: "Jump Rope",  label: "Jump Rope",  icon: "➰",  color: "#ef4444" },
  { value: "Pull Ups",   label: "Pull Ups",   icon: "🏋",  color: "#14b8a6" },
  { value: "Stretching", label: "Stretching", icon: "🤸",  color: "#f59e0b" },
];

function WorkoutTimer({ token, onWorkoutComplete, onClose }) {
  const [isRunning, setIsRunning]    = useState(false);
  const [elapsedSeconds, setElapsed] = useState(0);
  const [activityType, setActivity]  = useState("");
  const [error, setError]            = useState("");
  const [pointsEarned, setPoints]    = useState(null);
  const [currentStreak, setStreak]   = useState(null);
  const [saved, setSaved]            = useState(false);
  const intervalRef  = useRef();
  const startTimeRef = useRef();

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning]);

  const handleStart = () => {
    if (!activityType) { setError("Select an activity first."); return; }
    setIsRunning(true);
    setError("");
    setPoints(null);
    setStreak(null);
    setSaved(false);
    startTimeRef.current = new Date();
    setElapsed(0);
  };

  const handleStop = async () => {
    clearInterval(intervalRef.current);
    setIsRunning(false);
    const endTime = new Date();
    try {
      const res = await API.post("/workouts/complete", {
        start_time:    startTimeRef.current.toISOString(),
        end_time:      endTime.toISOString(),
        duration:      elapsedSeconds,
        activity_type: activityType,
      });
      const data = res.data;
      if (data.success) {
        setPoints(data.points_earned);
        setStreak(data.streak);
        setError("");
        setSaved(true);
        try {
          const stored = JSON.parse(localStorage.getItem("user") || "{}");
          stored.streak = data.streak;
          stored.points = (stored.points || 0) + data.points_earned;
          localStorage.setItem("user", JSON.stringify(stored));
        } catch {}
        onWorkoutComplete && onWorkoutComplete();
      } else {
        setError(data.message || "Error logging workout.");
      }
    } catch {
      setError("Server error.");
    }
  };

  const handleReset = () => {
    clearInterval(intervalRef.current);
    setIsRunning(false);
    setElapsed(0);
    setActivity("");
    setError("");
    setPoints(null);
    setStreak(null);
    setSaved(false);
  };

  const hrs  = String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0");
  const mins = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0");
  const secs = String(elapsedSeconds % 60).padStart(2, "0");

  const selected    = ACTIVITIES.find(a => a.value === activityType);
  const accentColor = selected?.color || "#3b82f6";

  return (
    <div style={styles.panel}>
      {/* Title row */}
      <div style={styles.titleRow}>
        <span style={styles.titleIcon}>⏱</span>
        <h2 style={styles.title}>Workout Timer</h2>
      </div>

      {/* Clock */}
      <div style={{ ...styles.clockWrap, borderColor: accentColor + "55", boxShadow: `0 0 40px ${accentColor}22` }}>
        <div style={{ ...styles.clockRing, borderTopColor: accentColor, animation: isRunning ? "timerSpin 1.2s linear infinite" : "none" }} />
        <div style={styles.clockInner}>
          <div style={styles.timeDisplay}>
            <span style={styles.timeDigit}>{hrs}</span>
            <span style={{ ...styles.timeSep, color: accentColor }}>:</span>
            <span style={styles.timeDigit}>{mins}</span>
            <span style={{ ...styles.timeSep, color: accentColor }}>:</span>
            <span style={styles.timeDigit}>{secs}</span>
          </div>
          <div style={{ ...styles.timeLabel, color: accentColor }}>
            {isRunning ? (selected?.label || "Active") : elapsedSeconds > 0 ? "Paused" : "Ready"}
          </div>
        </div>
      </div>

      {/* Activity picker */}
      <div style={styles.activityGrid}>
        {ACTIVITIES.map(act => {
          const isActive = activityType === act.value;
          return (
            <button
              key={act.value}
              onClick={() => !isRunning && setActivity(act.value)}
              disabled={isRunning}
              style={{
                ...styles.actBtn,
                background: isActive ? `${act.color}22` : "rgba(255,255,255,0.04)",
                border: isActive ? `1px solid ${act.color}88` : "1px solid rgba(255,255,255,0.08)",
                color: isActive ? act.color : "#c5d4ff",
                transform: isActive ? "scale(1.04)" : "scale(1)",
                cursor: isRunning ? "not-allowed" : "pointer",
                opacity: isRunning && !isActive ? 0.45 : 1,
              }}
            >
              <span style={styles.actIcon}>{act.icon}</span>
              <span style={styles.actLabel}>{act.label}</span>
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && <div style={styles.errorBox}>{error}</div>}

      {/* Controls */}
      <div style={styles.controlRow}>
        {!isRunning ? (
          <button onClick={handleStart} style={{ ...styles.ctaBtn, background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)` }}>
            ▶ Start
          </button>
        ) : (
          <button onClick={handleStop} style={{ ...styles.ctaBtn, background: "linear-gradient(135deg, #ef4444, #b91c1c)" }}>
            ⬛ Stop & Save
          </button>
        )}
        <button onClick={handleReset} style={styles.resetBtn} disabled={isRunning}>
          ↺ Reset
        </button>
      </div>


            {/* Full success banner */}
      {saved && pointsEarned !== null && (
        <div style={styles.successBox}>
          <div style={styles.successConfetti}>🎉</div>
          <div style={styles.successTitle}>Workout Complete!</div>
          <div style={styles.successSub}>{activityType} · {hrs}:{mins}:{secs}</div>
          <div style={styles.successMeta}>
            <div style={styles.successStat}>
              <span style={styles.successStatIcon}>⚡</span>
              <span style={styles.successStatVal}>+{pointsEarned}</span>
              <span style={styles.successStatLbl}>Points Earned</span>
            </div>
            <div style={styles.successDivider} />
            <div style={styles.successStat}>
              <span style={styles.successStatIcon}>🔥</span>
              <span style={styles.successStatVal}>{currentStreak}</span>
              <span style={styles.successStatLbl}>Day Streak</span>
            </div>
          </div>
          <div style={styles.successHint}>Keep it up! Your stats have been updated.</div>
        </div>
      )}

      <style>{`
        @keyframes timerSpin {
          from { transform: translate(-50%,-50%) rotate(0deg); }
          to   { transform: translate(-50%,-50%) rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  panel: {
    background: "linear-gradient(160deg, #07101f 0%, #0d1a35 60%, #0a1628 100%)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 24,
    padding: "24px 24px 28px",
    color: "#eef4ff",
    maxWidth: 480,
    margin: "0 auto",
    boxShadow: "0 32px 80px rgba(0,0,0,0.55)",
    overflowY: "auto",
    maxHeight: "90vh",
    boxSizing: "border-box",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
    justifyContent: "center",
  },
  titleIcon: { fontSize: "1.4rem" },
  title: {
    margin: 0,
    fontSize: "1.35rem",
    fontWeight: 800,
    letterSpacing: "0.5px",
    color: "#f4f8ff",
  },
  clockWrap: {
    position: "relative",
    width: 180,
    height: 180,
    margin: "0 auto 22px",
    borderRadius: "50%",
    border: "2px solid",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "box-shadow 0.4s ease, border-color 0.4s ease",
    flexShrink: 0,
  },
  clockRing: {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%,-50%)",
    width: 170,
    height: 170,
    borderRadius: "50%",
    border: "3px solid transparent",
    borderTopWidth: 3,
    borderTopStyle: "solid",
  },
  clockInner: { textAlign: "center", zIndex: 1 },
  timeDisplay: { display: "flex", alignItems: "baseline", gap: 2 },
  timeDigit: {
    fontSize: "2.4rem",
    fontWeight: 900,
    fontVariantNumeric: "tabular-nums",
    color: "#f4f8ff",
    letterSpacing: 1,
  },
  timeSep: { fontSize: "1.8rem", fontWeight: 900, lineHeight: 1, paddingBottom: 4 },
  timeLabel: { fontSize: "0.78rem", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 6 },

  activityGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 7,
    marginBottom: 16,
  },
  actBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
    padding: "9px 4px",
    borderRadius: 14,
    transition: "all 0.18s ease",
    outline: "none",
  },
  actIcon: { fontSize: "1.2rem" },
  actLabel: { fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.4px" },

  errorBox: {
    background: "rgba(239,68,68,0.15)",
    border: "1px solid rgba(239,68,68,0.3)",
    color: "#fca5a5",
    borderRadius: 12,
    padding: "10px 14px",
    marginBottom: 12,
    fontSize: "0.9rem",
    textAlign: "center",
  },
  controlRow: { display: "flex", gap: 12, marginBottom: 14 },
  ctaBtn: {
    flex: 1,
    padding: "13px 0",
    borderRadius: 14,
    border: "none",
    color: "#fff",
    fontWeight: 800,
    fontSize: "1rem",
    cursor: "pointer",
    letterSpacing: "0.5px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
  },
  resetBtn: {
    padding: "13px 20px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#c5d4ff",
    fontWeight: 700,
    fontSize: "0.9rem",
    cursor: "pointer",
    transition: "background 0.15s ease",
  },

  /* ── Inline reward badge shown directly below Stop & Save ── */
  rewardBadge: {
    background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(139,92,246,0.15))",
    border: "1px solid rgba(99,102,241,0.35)",
    borderRadius: 16,
    padding: "14px 16px 10px",
    marginBottom: 14,
    textAlign: "center",
  },
  rewardRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    marginBottom: 8,
  },
  rewardItem: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "0 24px",
  },
  rewardIcon: { fontSize: "1.4rem" },
  rewardVal: {
    fontSize: "1.7rem",
    fontWeight: 900,
    color: "#c7d2fe",
    lineHeight: 1,
    letterSpacing: "-0.02em",
  },
  rewardLbl: {
    fontSize: "0.65rem",
    fontWeight: 700,
    color: "rgba(199,210,254,0.6)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  rewardDivider: {
    width: 1,
    height: 44,
    background: "rgba(99,102,241,0.25)",
    flexShrink: 0,
  },
  rewardHint: {
    fontSize: "0.74rem",
    color: "rgba(199,210,254,0.5)",
    fontWeight: 500,
  },

  /* ── Full success banner ── */
  successBox: {
    background: "linear-gradient(145deg, rgba(5,150,105,0.18), rgba(16,185,129,0.1), rgba(5,150,105,0.15))",
    border: "1px solid rgba(16,185,129,0.32)",
    borderRadius: 20,
    padding: "20px 20px 16px",
    textAlign: "center",
    boxShadow: "0 8px 32px rgba(16,185,129,0.12), 0 0 0 1px rgba(16,185,129,0.06) inset",
  },
  successConfetti: { fontSize: "2.2rem", marginBottom: 6, textAlign: "center" },
  successTitle: { fontSize: "1.25rem", fontWeight: 900, color: "#6ee7b7", marginBottom: 4, textAlign: "center", letterSpacing: "-0.01em" },
  successSub: { fontSize: "0.82rem", color: "rgba(167,243,208,0.6)", marginBottom: 16, textAlign: "center", fontWeight: 600 },
  successMeta: { display: "flex", alignItems: "center", justifyContent: "center", gap: 0, marginBottom: 12 },
  successStat: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "0 24px" },
  successStatIcon: { fontSize: "1.5rem" },
  successStatVal: { fontSize: "1.9rem", fontWeight: 900, color: "#d1fae5", lineHeight: 1, letterSpacing: "-0.02em" },
  successStatLbl: { fontSize: "0.66rem", fontWeight: 700, color: "rgba(167,243,208,0.55)", textTransform: "uppercase", letterSpacing: "0.08em" },
  successDivider: { width: 1, height: 44, background: "rgba(16,185,129,0.22)", flexShrink: 0 },
  successHint: { fontSize: "0.76rem", color: "rgba(167,243,208,0.5)", textAlign: "center", fontWeight: 500 },
};

export default WorkoutTimer;
