import React, { forwardRef, useImperativeHandle, useState, useRef, useEffect } from "react";
import API from "../services/api";
import { userTimeZone } from "../utils/time";
import { useFeedback } from "./Feedback";
import Icon from "./Icon";

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

// A running session is remembered so a refresh / accidental navigation doesn't lose it.
const RUN_KEY = () => {
  try { const u = JSON.parse(localStorage.getItem("user") || "{}"); return `aivo_active_workout_${u.id || u._id || "me"}`; } catch { return "aivo_active_workout"; }
};
const MAX_RESUME_MS = 12 * 60 * 60 * 1000;
const readRun = () => {
  try {
    const r = JSON.parse(localStorage.getItem(RUN_KEY()) || "null");
    if (!r?.start || !r?.activity) return null;
    const startMs = new Date(r.start).getTime();
    if (!Number.isFinite(startMs) || Date.now() - startMs > MAX_RESUME_MS) { localStorage.removeItem(RUN_KEY()); return null; }
    return { start: new Date(startMs), activity: r.activity };
  } catch { return null; }
};
const writeRun = (start, activity) => { try { localStorage.setItem(RUN_KEY(), JSON.stringify({ start: start.toISOString(), activity })); } catch {} };
const clearRun = () => { try { localStorage.removeItem(RUN_KEY()); } catch {} };

const WorkoutTimer = forwardRef(function WorkoutTimer({ token, onWorkoutComplete, onClose }, ref) {
  const { choose, toast } = useFeedback();
  const resumed = useRef(readRun()).current;           // session still running from before, if any
  const [isRunning, setIsRunning]    = useState(!!resumed);
  const [elapsedSeconds, setElapsed] = useState(resumed ? Math.floor((Date.now() - resumed.start.getTime()) / 1000) : 0);
  const [activityType, setActivity]  = useState(resumed ? resumed.activity : "");
  const [error, setError]            = useState("");
  const [pointsEarned, setPoints]    = useState(null);
  const [currentStreak, setStreak]   = useState(null);
  const [saved, setSaved]            = useState(false);
  const intervalRef  = useRef();
  const startTimeRef = useRef(resumed ? resumed.start : undefined);

  // Elapsed time is derived from timestamps, not counted ticks: browsers throttle setInterval in
  // background tabs, which made long workouts under-count.
  useEffect(() => {
    if (!isRunning) return undefined;
    const tick = () => setElapsed(Math.floor((Date.now() - startTimeRef.current.getTime()) / 1000));
    tick();
    intervalRef.current = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(intervalRef.current); document.removeEventListener("visibilitychange", tick); };
  }, [isRunning]);

  const handleStart = () => {
    if (!activityType) { setError("Select an activity first."); return; }
    setError("");
    setPoints(null);
    setStreak(null);
    setSaved(false);
    startTimeRef.current = new Date();
    writeRun(startTimeRef.current, activityType);
    setElapsed(0);
    setIsRunning(true);
  };

  const handleStop = async () => {
    clearInterval(intervalRef.current);
    setIsRunning(false);
    clearRun();
    const endTime = new Date();
    const finalSeconds = Math.floor((endTime.getTime() - startTimeRef.current.getTime()) / 1000);
    setElapsed(finalSeconds);
    try {
      const res = await API.post("/workouts/complete", {
        start_time:    startTimeRef.current.toISOString(),
        end_time:      endTime.toISOString(),
        duration:      finalSeconds,
        activity_type: activityType,
        tz:            userTimeZone,
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
        return { ok: true, points: data.points_earned };
      }
      setError(data.message || "Error logging workout.");
      return { ok: false, message: data.message };
    } catch (err) {
      const message = err?.response?.data?.message;
      setError(message || "Server error.");
      return { ok: false, message };
    }
  };

  const handleReset = () => {
    clearInterval(intervalRef.current);
    clearRun();
    setIsRunning(false);
    setElapsed(0);
    setActivity("");
    setError("");
    setPoints(null);
    setStreak(null);
    setSaved(false);
  };

  // Called by the modal's × button / backdrop. While a session is running, ask what to do with it.
  const requestClose = async () => {
    if (!isRunning) { onClose && onClose(); return; }
    const choice = await choose({
      title: "Workout still running",
      message: `Your ${activityType.toLowerCase()} session is at ${hrs}:${mins}:${secs}. What would you like to do before closing?`,
      options: [
        { value: "save",   label: "Save workout & close", tone: "success" },
        { value: "reset",  label: "Reset (discard this session)", tone: "danger" },
        { value: "resume", label: "Keep going", tone: "ghost" },
      ],
    });
    if (choice === "save") {
      const r = await handleStop();
      if (r?.ok) { toast(`Workout saved! +${r.points} points`, "success"); onClose && onClose(); }
      else { toast(r?.message || "Could not save the workout. Please check your connection and try again.", "error"); }
    } else if (choice === "reset") {
      handleReset();
      toast("Workout discarded.", "info");
      onClose && onClose();
    }
    // "resume" / dismissed: do nothing, timer keeps running
  };
  useImperativeHandle(ref, () => ({ requestClose, isRunning: () => isRunning }));

  const hrs  = String(Math.floor(elapsedSeconds / 3600)).padStart(2, "0");
  const mins = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, "0");
  const secs = String(elapsedSeconds % 60).padStart(2, "0");

  const selected    = ACTIVITIES.find(a => a.value === activityType);
  const accentColor = selected?.color || "#8b5cf6";

  return (
    <div style={styles.panel}>
      {/* Title row */}
      <div style={styles.titleRow}>
        <span style={styles.titleIcon}><Icon name="timer" size={22} /></span>
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
          <button onClick={handleStart} style={{ ...styles.ctaBtn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)` }}>
            <Icon name="play" size={16} /> Start
          </button>
        ) : (
          <button onClick={handleStop} style={{ ...styles.ctaBtn, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: "linear-gradient(135deg, #ef4444, #b91c1c)" }}>
            <Icon name="stop" size={16} /> Stop &amp; Save
          </button>
        )}
        <button onClick={handleReset} style={{ ...styles.resetBtn, display: "inline-flex", alignItems: "center", gap: 6 }} disabled={isRunning}>
          <Icon name="reset" size={15} /> Reset
        </button>
      </div>


      {/* Result card: compact so points + streak are visible without scrolling */}
      {saved && pointsEarned !== null && (
        <div style={styles.successBox}>
          <div style={styles.successHead}>
            <span style={styles.successConfetti}>🎉</span>
            <div>
              <div style={styles.successTitle}>Workout Complete!</div>
              <div style={styles.successSub}>{activityType} · {hrs}:{mins}:{secs}</div>
            </div>
          </div>
          <div style={styles.successMeta}>
            <div style={styles.successStat}>
              <span style={styles.successStatIcon}>⚡</span>
              <div style={styles.successStatText}>
                <span style={styles.successStatVal}>+{pointsEarned}</span>
                <span style={styles.successStatLbl}>Points Earned</span>
              </div>
            </div>
            <div style={styles.successStat}>
              <span style={styles.successStatIcon}>🔥</span>
              <div style={styles.successStatText}>
                <span style={styles.successStatVal}>{currentStreak}</span>
                <span style={styles.successStatLbl}>Day Streak</span>
              </div>
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
});

const styles = {
  panel: {
    background: "linear-gradient(160deg, #07101f 0%, #0d1a35 60%, #0a1628 100%)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 24,
    padding: "16px 20px 18px",
    color: "#eef4ff",
    maxWidth: 480,
    margin: "0 auto",
    boxShadow: "0 32px 80px rgba(0,0,0,0.55)",
    overflowY: "auto",
    maxHeight: "90vh",          // only ever scrolls on very short screens; layout below is sized to fit
    boxSizing: "border-box",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
    justifyContent: "center",
  },
  titleIcon: { display: "inline-flex", color: "#c4b5fd" },
  title: {
    margin: 0,
    fontSize: "1.2rem",
    fontWeight: 800,
    letterSpacing: "0.5px",
    color: "#f4f8ff",
  },
  clockWrap: {
    position: "relative",
    width: "clamp(104px, 20vh, 160px)",
    height: "clamp(104px, 20vh, 160px)",
    margin: "0 auto 14px",
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
    width: "calc(100% - 10px)",
    height: "calc(100% - 10px)",
    borderRadius: "50%",
    border: "3px solid transparent",
    borderTopWidth: 3,
    borderTopStyle: "solid",
  },
  clockInner: { textAlign: "center", zIndex: 1 },
  timeDisplay: { display: "flex", alignItems: "baseline", gap: 2 },
  timeDigit: {
    fontSize: "clamp(1.3rem, 3.4vh, 2.1rem)",
    fontWeight: 900,
    fontVariantNumeric: "tabular-nums",
    color: "#f4f8ff",
    letterSpacing: 1,
  },
  timeSep: { fontSize: "clamp(1.1rem, 2.6vh, 1.6rem)", fontWeight: 900, lineHeight: 1, paddingBottom: 3 },
  timeLabel: { fontSize: "0.7rem", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", marginTop: 4 },

  activityGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 6,
    marginBottom: 12,
  },
  actBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    padding: "7px 4px",
    borderRadius: 12,
    transition: "all 0.18s ease",
    outline: "none",
  },
  actIcon: { fontSize: "1.1rem" },
  actLabel: { fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.4px" },

  errorBox: {
    background: "rgba(239,68,68,0.15)",
    border: "1px solid rgba(239,68,68,0.3)",
    color: "#fca5a5",
    borderRadius: 12,
    padding: "8px 12px",
    marginBottom: 10,
    fontSize: "0.88rem",
    textAlign: "center",
  },
  controlRow: { display: "flex", gap: 12, marginBottom: 12 },
  ctaBtn: {
    flex: 1,
    padding: "11px 0",
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
    padding: "11px 20px",
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

  /* ── Compact result card (head row + two side-by-side stat tiles) ── */
  successBox: {
    background: "linear-gradient(145deg, rgba(5,150,105,0.18), rgba(16,185,129,0.1), rgba(5,150,105,0.15))",
    border: "1px solid rgba(16,185,129,0.32)",
    borderRadius: 18,
    padding: "12px 14px 10px",
    textAlign: "center",
    boxShadow: "0 8px 32px rgba(16,185,129,0.12), 0 0 0 1px rgba(16,185,129,0.06) inset",
  },
  successHead: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 10 },
  successConfetti: { fontSize: "1.9rem", lineHeight: 1 },
  successTitle: { fontSize: "1.08rem", fontWeight: 900, color: "#6ee7b7", letterSpacing: "-0.01em", textAlign: "left", lineHeight: 1.2 },
  successSub: { fontSize: "0.76rem", color: "rgba(167,243,208,0.65)", fontWeight: 600, textAlign: "left", marginTop: 1 },
  successMeta: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 },
  successStat: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    background: "rgba(255,255,255,0.045)", border: "1px solid rgba(16,185,129,0.18)",
    borderRadius: 12, padding: "8px 10px",
  },
  successStatIcon: { fontSize: "1.4rem", lineHeight: 1 },
  successStatText: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 },
  successStatVal: { fontSize: "1.45rem", fontWeight: 900, color: "#d1fae5", lineHeight: 1, letterSpacing: "-0.02em" },
  successStatLbl: { fontSize: "0.6rem", fontWeight: 700, color: "rgba(167,243,208,0.6)", textTransform: "uppercase", letterSpacing: "0.07em" },
  successHint: { fontSize: "0.7rem", color: "rgba(167,243,208,0.5)", textAlign: "center", fontWeight: 500 },
};

export default WorkoutTimer;
