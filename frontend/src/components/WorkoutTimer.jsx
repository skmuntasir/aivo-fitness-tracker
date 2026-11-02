import React, { forwardRef, useImperativeHandle, useState, useRef, useEffect } from "react";
import API from "../services/api";
import { userTimeZone } from "../utils/time";
import { useFeedback } from "./Feedback";
import Icon from "./Icon";
import { BadgeStrip } from "./Badges";
import { WORKOUTS, WORKOUT_GROUPS, workoutByName } from "../data/workouts";
import { HEAT_STEPS, heatStep } from "../utils/heat";
import "./WorkoutTimer.css";

// A running session is remembered so a refresh / accidental navigation doesn't lose it. The SERVER owns the clock:
// it records the start time when the workout begins, so these local values are only for resuming the display.
const RUN_KEY = () => {
  try { const u = JSON.parse(localStorage.getItem("user") || "{}"); return `aivo_active_workout_${u.id || u._id || "me"}`; } catch { return "aivo_active_workout"; }
};
const MAX_RESUME_MS = 4 * 60 * 60 * 1000;
const DEFAULT_LIMITS = { max_seconds: 3 * 3600, checkin_every: 30 * 60, checkin_grace: 2 * 60, daily_cap: 600 };
const readRun = () => {
  try {
    const r = JSON.parse(localStorage.getItem(RUN_KEY()) || "null");
    if (!r?.start || !r?.activity || !r?.sid) { localStorage.removeItem(RUN_KEY()); return null; }   // older saves have no server session
    const startMs = new Date(r.start).getTime();
    if (!Number.isFinite(startMs) || Date.now() - startMs > MAX_RESUME_MS) { localStorage.removeItem(RUN_KEY()); return null; }
    return { start: new Date(startMs), activity: r.activity, sid: r.sid };
  } catch { return null; }
};
const writeRun = (start, activity, sid) => { try { localStorage.setItem(RUN_KEY(), JSON.stringify({ start: start.toISOString(), activity, sid })); } catch {} };
const clearRun = () => { try { localStorage.removeItem(RUN_KEY()); } catch {} };
const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

const WorkoutTimer = forwardRef(function WorkoutTimer({ token, onWorkoutComplete, onClose }, ref) {
  const { choose, toast } = useFeedback();
  const resumed = useRef(readRun()).current;           // session still running from before, if any
  const [isRunning, setIsRunning]    = useState(!!resumed);
  const [elapsedSeconds, setElapsed] = useState(resumed ? Math.floor((Date.now() - resumed.start.getTime()) / 1000) : 0);
  const [activityType, setActivity]  = useState(resumed ? resumed.activity : "");
  const [error, setError]            = useState("");
  const [notice, setNotice]          = useState("");
  const [pointsEarned, setPoints]    = useState(null);
  const [currentStreak, setStreak]   = useState(null);
  const [saved, setSaved]            = useState(false);
  const [starting, setStarting]      = useState(false);
  const [checkin, setCheckin]        = useState(null);     // { deadline } while "Still working out?" is waiting for an answer
  const [newBadges, setNewBadges]    = useState([]);
  const [group, setGroup]           = useState(() => workoutByName(resumed?.activity)?.group || "gym");
  const intervalRef  = useRef();
  const startTimeRef = useRef(resumed ? resumed.start : undefined);
  const sidRef       = useRef(resumed ? resumed.sid : null);
  const lastConfRef  = useRef(Date.now());                 // local time of the last "I'm here" (or the start)
  const limitsRef    = useRef(DEFAULT_LIMITS);
  const stoppingRef  = useRef(false);
  const stopRef      = useRef(null);                       // always the latest handleStop (used by the timer tick)

  // Resumed after a refresh: ask the server what is really going on (and when the last check-in was).
  useEffect(() => {
    if (!resumed) return;
    API.get("/workouts/active").then((res) => {
      const d = res.data;
      if (d?.limits) limitsRef.current = { ...DEFAULT_LIMITS, ...d.limits };
      if (!d?.active || d.session_id !== resumed.sid) {
        clearRun(); sidRef.current = null; setIsRunning(false); setElapsed(0); setActivity("");
        setNotice("That workout had already ended, so nothing was saved.");
        return;
      }
      const skew = Date.now() - new Date(d.server_now).getTime();                 // browser clock vs server clock
      startTimeRef.current = new Date(new Date(d.start_time).getTime() + skew);
      lastConfRef.current = new Date(d.last_confirmed).getTime() + skew;
    }).catch(() => { /* offline: keep the local view, the server decides when it is saved */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Elapsed time is derived from timestamps, not counted ticks: browsers throttle setInterval in
  // background tabs, which made long workouts under-count. The same tick drives the "Still working out?" prompt.
  useEffect(() => {
    if (!isRunning) return undefined;
    const tick = () => {
      const now = Date.now();
      const secs = Math.floor((now - startTimeRef.current.getTime()) / 1000);
      setElapsed(secs);
      const L = limitsRef.current;
      const due = lastConfRef.current + L.checkin_every * 1000;
      const deadline = due + L.checkin_grace * 1000;
      if (now >= deadline || secs >= L.max_seconds) { stopRef.current && stopRef.current({ auto: true }); return; }
      if (now >= due) setCheckin((prev) => prev || { deadline });
    };
    tick();
    intervalRef.current = setInterval(tick, 500);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(intervalRef.current); document.removeEventListener("visibilitychange", tick); };
  }, [isRunning]);

  // Make the prompt noticeable when the tab is in the background.
  useEffect(() => {
    if (!checkin) return undefined;
    const old = document.title;
    document.title = "Still working out? · Aivo";
    return () => { document.title = old; };
  }, [checkin]);

  const handleStart = async () => {
    if (!activityType) { setError("Select an activity first."); return; }
    setError(""); setNotice("");
    setPoints(null);
    setStreak(null);
    setSaved(false);
    setNewBadges([]);
    setStarting(true);
    try {
      const res = await API.post("/workouts/start", { activity_type: activityType, tz: userTimeZone });
      const d = res.data;
      if (d?.limits) limitsRef.current = { ...DEFAULT_LIMITS, ...d.limits };
      sidRef.current = d.session_id;
      startTimeRef.current = new Date();
      lastConfRef.current = Date.now();
      stoppingRef.current = false;
      writeRun(startTimeRef.current, activityType, d.session_id);
      setElapsed(0);
      setCheckin(null);
      setIsRunning(true);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not start the workout. Please check your connection.");
    } finally {
      setStarting(false);
    }
  };

  // "I'm here" – keeps the session alive for another check-in period.
  const handleCheckin = async () => {
    try {
      await API.post("/workouts/checkin", { session_id: sidRef.current });
      lastConfRef.current = Date.now();
      setCheckin(null);
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === "expired") stopRef.current && stopRef.current({ auto: true });
      else if (code === "no_session") { clearRun(); sidRef.current = null; clearInterval(intervalRef.current); setIsRunning(false); setCheckin(null); setNotice("This workout is no longer active, so nothing was saved."); }
      else setError("Could not confirm. Check your connection and tap again.");
    }
  };

  const handleStop = async ({ auto = false } = {}) => {
    if (stoppingRef.current) return { ok: false, message: "Already saving." };
    stoppingRef.current = true;
    clearInterval(intervalRef.current);
    setIsRunning(false);
    setCheckin(null);
    clearRun();
    const localSecs = Math.floor((Date.now() - startTimeRef.current.getTime()) / 1000);
    setElapsed(localSecs);
    // Show the golden "Saved" card the instant Stop is tapped (1 min = 1 point); the server's exact numbers replace it a moment later.
    const optimistic = localSecs >= 60;
    if (optimistic) { setError(""); setNotice(""); setPoints(Math.floor(localSecs / 60)); setStreak(null); setSaved(true); }
    try {
      // Only the session id is sent: the server uses its own clock for the duration.
      const res = await API.post("/workouts/complete", { session_id: sidRef.current, activity_type: activityType, tz: userTimeZone });
      const data = res.data;
      if (data.success) {
        setElapsed(data.duration);                                   // what was actually credited
        setPoints(data.points_earned);
        setStreak(data.streak);
        setNewBadges(Array.isArray(data.new_badges) ? data.new_badges : []);
        const lim = limitsRef.current;
        const notes = [];
        if (data.auto_stopped || auto) notes.push("The timer stopped on its own because the “Still working out?” check-in wasn’t answered. Time is credited up to that point.");
        if (data.length_capped) notes.push(`Workouts are capped at ${Math.round(lim.max_seconds / 3600)} hours.`);
        if (data.daily_cap_hit) notes.push(`Daily points limit (${lim.daily_cap}) reached. The extra points aren’t counted.`);
        setNotice(notes.join(" "));
        setError("");
        setSaved(true);
        sidRef.current = null;
        try {
          const stored = JSON.parse(localStorage.getItem("user") || "{}");
          stored.streak = data.streak;
          stored.points = (stored.points || 0) + data.points_earned;
          localStorage.setItem("user", JSON.stringify(stored));
        } catch {}
        onWorkoutComplete && onWorkoutComplete();
        return { ok: true, points: data.points_earned };
      }
      setSaved(false); setPoints(null);
      setError(data.message || "Error logging workout.");
      return { ok: false, message: data.message };
    } catch (err) {
      const message = err?.response?.data?.message;
      setSaved(false); setPoints(null);
      setError(message || "Server error.");
      return { ok: false, message };
    } finally {
      stoppingRef.current = false;
    }
  };
  stopRef.current = handleStop;

  const handleReset = () => {
    clearInterval(intervalRef.current);
    if (isRunning) API.post("/workouts/cancel").catch(() => {});     // discard the server session too
    sidRef.current = null;
    clearRun();
    setIsRunning(false);
    setCheckin(null);
    setElapsed(0);
    setActivity("");
    setError("");
    setNotice("");
    setPoints(null);
    setStreak(null);
    setSaved(false);
    setNewBadges([]);
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

  const selected = workoutByName(activityType);
  const step     = heatStep(elapsedSeconds);                 // same colour steps as the streak heatmap
  const accent   = step ? step.bright : "#818cf8";
  const glowing  = isRunning && step?.key === "l5";
  const showPicker = !isRunning && !saved;
  const list = WORKOUTS.filter((w) => w.group === group);

  return (
    <div className="wt-panel">
      <div className="wt-head">
        <span className="wt-head-icon"><Icon name="timer" size={20} /></span>
        <h2>Workout timer</h2>
      </div>

      {/* Clock: ring colour follows the session length (deep -> royal -> electric -> neon -> glowing ultraviolet) */}
      <div className={`wt-clock${isRunning ? " running" : ""}${glowing ? " glow" : ""}`} style={{ "--wt": accent }}>
        <div className="wt-ring" />
        <div className="wt-clock-inner">
          <div className="wt-time">
            <span>{hrs}</span><i>:</i><span>{mins}</span><i>:</i><span>{secs}</span>
          </div>
          <div className="wt-state">
            {isRunning ? (selected?.short || selected?.name || activityType || "Active") : elapsedSeconds > 0 ? "Paused" : "Ready"}
          </div>
        </div>
      </div>
      <div className="wt-stages" aria-label="Colour steps by session length">
        {HEAT_STEPS.map((st) => (
          <span key={st.key} className={`wt-stage${step?.key === st.key ? " now" : ""}`} style={{ "--c": st.bright }} title={`${st.name} · ${st.range}`} />
        ))}
      </div>

      {showPicker ? (
        <>
          <div className="wt-tabs" role="tablist" aria-label="Workout type">
            {WORKOUT_GROUPS.map((g) => (
              <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? "on" : ""} onClick={() => setGroup(g.id)}>{g.label}</button>
            ))}
          </div>
          <div className="wt-chips" role="group" aria-label="Choose a workout">
            {list.map((w) => (
              <button key={w.name} type="button" onClick={() => setActivity(w.name)} aria-pressed={activityType === w.name} className={`wt-chip${activityType === w.name ? " on" : ""}`}>
                <span className="wt-chip-name">{w.name}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="wt-now">
          <span className="wt-now-dot"><Icon name="activity" size={16} /></span>
          <strong>{activityType || "Workout"}</strong>
          {selected && <em>{selected.group === "gym" ? "Gym" : "Home"}</em>}
        </div>
      )}

      {/* Error */}
      {error && <div className="wt-error" role="alert">{error}</div>}

      {/* "Still working out?" – a forgotten timer stops itself instead of piling up points */}
      {isRunning && checkin && (
        <div className="wt-checkin" role="alertdialog" aria-live="assertive" aria-label="Still working out?">
          <span className="wt-checkin-text">
            <strong>Still working out?</strong>
            <small>Tap to keep going. The timer stops in {mmss(Math.max(0, Math.ceil((checkin.deadline - Date.now()) / 1000)))}.</small>
          </span>
          <button type="button" onClick={handleCheckin}>I’m here</button>
        </div>
      )}
      {notice && !isRunning && <div className="wt-notice" role="status">{notice}</div>}

      {showPicker && (
        <p className="wt-rules">Every minute you train is 1 point (up to {DEFAULT_LIMITS.daily_cap} a day). We’ll ask “Still working out?” every 30 minutes.</p>
      )}

      {/* Controls */}
      <div className="wt-controls">
        {!isRunning ? (
          <button onClick={handleStart} className="wt-go" style={{ "--wt": accent }} disabled={starting}>
            <Icon name="play" size={17} /> {starting ? "Starting…" : "Start"}
          </button>
        ) : (
          <button onClick={() => handleStop()} className="wt-go stop">
            <Icon name="stop" size={17} /> Stop &amp; save
          </button>
        )}
        <button onClick={handleReset} className="wt-reset" disabled={isRunning}>
          <Icon name="reset" size={16} /> Reset
        </button>
      </div>

      {/* Result: one short line */}
      {saved && pointsEarned !== null && (
        <div className="wt-done" role="status">
          <span className="wt-done-ic"><Icon name="check" size={16} strokeWidth={3} /></span>
          <span className="wt-done-main"><strong>Saved</strong><small>{activityType} · {hrs}:{mins}:{secs}</small></span>
          <span className="wt-pill"><Icon name="zap" size={14} />+{pointsEarned}</span>
          <span className="wt-pill"><Icon name="flame" size={14} />{currentStreak === null ? "…" : `${currentStreak}d`}</span>
        </div>
      )}
      {saved && newBadges.length > 0 && (
        <div className="wt-newbadges">
          <small>{newBadges.length === 1 ? "New badge" : `${newBadges.length} new badges`}</small>
          <BadgeStrip badges={newBadges} max={4} />
        </div>
      )}
    </div>
  );
});

export default WorkoutTimer;
