import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cachedGet } from "../services/api";
import { localDateKey, userTimeZone } from "../utils/time";
import "./StreakCalendar.css";
import Icon from "./Icon";
import { HEAT_STEPS, heatLevel } from "../utils/heat";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS   = ["S","M","T","W","T","F","S"];
const CELL = 11;
const GAP  = 3;
const colW = CELL + GAP;

// `count` is seconds trained that day. Colour steps (shared with the workout timer, see utils/heat.js):
// one electric-purple family, dark -> light: under 1 min | 1-2 | 2-5 | 5-10 | 10+ min (brightest, glowing).
const level = (count) => (count < 0 ? "out" : heatLevel(count));

const fmtMin = (sec) => {
  if (!sec) return "Rest day";
  const m = Math.floor(sec / 60);
  if (m < 1) return "under 1 min active";
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m active` : `${m} min active`;
};

// Pure + memoised: a cell only re-renders if ITS date/count changes. Hover tooltips are
// CSS-only (data-tip), so hovering no longer re-renders all ~370 cells.
const Cell = memo(function Cell({ date, count, today, frozen }) {
  const inYear = count >= 0;
  const tip = frozen && !(count > 0) ? `${date} · Rest day (streak freeze)` : `${date} · ${fmtMin(count)}`;
  return (
    <div
      className={`sc-cell sc-${level(count)}${frozen && !(count > 0) ? " sc-frozen" : ""}${today ? " sc-today" : ""}`}
      data-tip={inYear ? tip : undefined}
    />
  );
});


// One floating tooltip for the whole calendar. It is position:fixed (in a portal), so the scroll box / card
// `overflow` can no longer clip it - that is what hid the tooltip on the top rows. It flips below the cell
// when there is no room above and is clamped to the viewport horizontally.
function CalendarTip({ hostRef }) {
  const [tip, setTip] = useState(null);
  const tipRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const over = (e) => {
      if (window.matchMedia("(max-width: 560px)").matches) return;   // touch layout: no hover tooltips
      const el = e.target.closest?.("[data-tip]");
      if (!el || !host.contains(el)) return;
      const r = el.getBoundingClientRect();
      setTip({ text: el.getAttribute("data-tip"), cx: r.left + r.width / 2, top: r.top, bottom: r.bottom });
    };
    const out = (e) => {
      const el = e.target.closest?.("[data-tip]");
      if (el && !el.contains(e.relatedTarget)) setTip(null);
    };
    const hide = () => setTip(null);
    host.addEventListener("mouseover", over);
    host.addEventListener("mouseout", out);
    window.addEventListener("scroll", hide, true);
    return () => {
      host.removeEventListener("mouseover", over);
      host.removeEventListener("mouseout", out);
      window.removeEventListener("scroll", hide, true);
    };
  }, [hostRef]);

  // Measure after render, then place: above the cell if it fits, otherwise below.
  const [pos, setPos] = useState(null);
  React.useLayoutEffect(() => {
    if (!tip || !tipRef.current) { setPos(null); return; }
    const w = tipRef.current.offsetWidth, h = tipRef.current.offsetHeight, pad = 8, gap = 10;
    const below = tip.top - h - gap < pad;
    const left = Math.min(Math.max(tip.cx - w / 2, pad), window.innerWidth - w - pad);
    setPos({ left, top: below ? tip.bottom + gap : tip.top - h - gap });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={tipRef} className="sc-tip" style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }} role="tooltip">
      {tip.text}
    </div>,
    document.body
  );
}

const cacheKey = (year) => {
  let uid = "anon";
  try { uid = JSON.parse(localStorage.getItem("user") || "{}").id || "anon"; } catch {}
  return `streak:v4:${uid}:${year}:${userTimeZone}`;
};
const readCacheEntry = (year) => {
  try { return JSON.parse(localStorage.getItem(cacheKey(year))) || null; } catch { return null; }
};
const readCache = (year) => readCacheEntry(year)?.data || null;

function StreakCalendar({ token, refreshKey }) {
  const cardRef = useRef(null);
  const currentYear = new Date().getFullYear();

  // Seed from the last known data so coloured days are there on the FIRST paint after a refresh,
  // then revalidate in the background (previously: empty grid until the request finished).
  const [streakData, setStreakData] = useState(() => readCache(currentYear) || []);
  const [loaded, setLoaded] = useState(() => !!readCache(currentYear));
  // Streak straight from the server: the same number Home, the leaderboard and the profile use.
  const [serverStreak, setServerStreak] = useState(() => readCacheEntry(currentYear)?.streak ?? null);
  const [frozenDates, setFrozenDates] = useState(() => readCacheEntry(currentYear)?.frozen || []);   // rest days covered by a streak freeze

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await cachedGet(`/workouts/daily-summary?year=${currentYear}&tz=${encodeURIComponent(userTimeZone)}`, { ttl: 0 });   // shared with Home's weekly card
        if (cancelled || !d.success) return;
        setStreakData(d.streak_data);
        const srv = Number.isFinite(d.streak) ? d.streak : null;
        setServerStreak(srv);
        const fz = Array.isArray(d.frozen_dates) ? d.frozen_dates : [];
        setFrozenDates(fz);
        try { localStorage.setItem(cacheKey(currentYear), JSON.stringify({ t: Date.now(), data: d.streak_data, streak: srv, frozen: fz })); } catch {}
      } catch { /* keep cached data */ }
      finally { if (!cancelled) setLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [token, refreshKey, currentYear]);

  const dataMap = useMemo(() => {
    const m = {};
    streakData.forEach((e) => { m[e.date] = e.total_duration; });
    return m;
  }, [streakData]);

  const frozenSet = useMemo(() => new Set(frozenDates), [frozenDates]);

  // Calendar structure depends only on the year => computed once.
  const { weeks, monthLabels } = useMemo(() => {
    const weeks = [];
    const labels = [];
    const cur = new Date(currentYear, 0, 1 - new Date(currentYear, 0, 1).getDay());
    const end = new Date(currentYear, 11, 31);
    while (cur <= end) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const inYear = cur.getFullYear() === currentYear;
        week.push({ date: localDateKey(cur), inYear });   // LOCAL date (toISOString() is UTC and shifted days)
        if (inYear && cur.getDate() <= 7 && !labels.find((l) => l.month === cur.getMonth())) {
          labels.push({ month: cur.getMonth(), weekIndex: weeks.length });
        }
        cur.setDate(cur.getDate() + 1);                   // DST-safe (adding 86400000ms is not)
      }
      weeks.push(week);
    }
    return { weeks, monthLabels: labels };
  }, [currentYear]);

  const todayKey = localDateKey(new Date());

  const { activeDays, totalMin, streak: localStreak } = useMemo(() => {
    const vals = Object.values(dataMap);
    let s = 0;
    const d = new Date();
    const on = (dt) => dataMap[localDateKey(dt)] > 0;
    const kept = (dt) => on(dt) || frozenSet.has(localDateKey(dt));   // a frozen rest day keeps the chain, it just isn't counted
    if (!kept(d)) d.setDate(d.getDate() - 1); // not trained *yet* today doesn't reset the streak
    while (kept(d)) { if (on(d)) s++; d.setDate(d.getDate() - 1); }
    return {
      activeDays: vals.filter((v) => v > 0).length,
      totalMin: Math.floor(vals.reduce((a, b) => a + b, 0) / 60),
      streak: s,
    };
  }, [dataMap, frozenSet]);

  const streak = serverStreak ?? localStreak;   // server value wins; local count is only a fallback

  return (
    <div className="sc-card" style={containerStyle} ref={cardRef}>
      <CalendarTip hostRef={cardRef} />
      <div style={headerStyle}>
        <div>
          <div style={titleStyle}>
            Activity
          </div>
          <div style={subtitleStyle}>Every workout in {currentYear}</div>
        </div>
        <div className="sc-stats" style={statsRowStyle}>
          <div style={statBubble}>
            <span style={{ ...statIcon, color: "var(--heat)" }}><Icon name="flame" size={16} /></span>
            <div><div style={statVal}>{streak}</div><div style={statLbl}>Day streak</div></div>
          </div>
          <div style={statBubble}>
            <span style={{ ...statIcon, color: "var(--go)" }}><Icon name="check" size={16} strokeWidth={2.6} /></span>
            <div><div style={statVal}>{activeDays}</div><div style={statLbl}>Active days</div></div>
          </div>
          <div style={statBubble}>
            <span style={{ ...statIcon, color: "var(--info)" }}><Icon name="timer" size={16} /></span>
            <div>
              <div style={statVal}>{totalMin >= 60 ? `${Math.floor(totalMin / 60)}h` : `${totalMin}m`}</div>
              <div style={statLbl}>Total time</div>
            </div>
          </div>
        </div>
      </div>

      <div className={`sc-scroll ${loaded ? "" : "sc-loading"}`}>
        <div style={{ position: "relative", minWidth: weeks.length * colW + 36 }}>
          <div style={{ display: "flex", marginBottom: 5, paddingLeft: 26 }}>
            {weeks.map((_, wi) => {
              const lbl = monthLabels.find((l) => l.weekIndex === wi);
              return (
                <div key={wi} style={{ width: colW, flexShrink: 0, fontSize: "0.7rem", color: "var(--faint)", fontWeight: 600 }}>
                  {lbl ? MONTHS[lbl.month] : ""}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: GAP, marginRight: 5, flexShrink: 0 }}>
              {DAYS.map((d, i) => (
                <div key={i} style={{ height: CELL, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 3, fontSize: "0.58rem", color: i % 2 === 1 ? "var(--faint)" : "transparent", width: 20, fontWeight: 700 }}>
                  {d}
                </div>
              ))}
            </div>

            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: "flex", flexDirection: "column", gap: GAP, marginRight: GAP }}>
                {week.map((cell) => (
                  <Cell key={cell.date} date={cell.date} today={cell.date === todayKey} count={cell.inYear ? (dataMap[cell.date] || 0) : -1} frozen={cell.inYear && frozenSet.has(cell.date)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, justifyContent: "flex-end" }}>
        {frozenSet.size > 0 && (
          <span className="sc-legend-frozen"><span className="sc-cell sc-frozen sc-legend" /> Rest day (freeze)</span>
        )}
        <span style={{ fontSize: "0.72rem", color: "var(--faint)", fontWeight: 600 }}>Less</span>
        <div className="sc-cell sc-l0 sc-legend" data-tip="Rest day" />
        {HEAT_STEPS.map((st) => <div key={st.key} className={`sc-cell sc-${st.key} sc-legend`} data-tip={`${st.name} · ${st.range}`} />)}
        <span style={{ fontSize: "0.72rem", color: "var(--faint)", fontWeight: 600 }}>More</span>
      </div>
    </div>
  );
}

const containerStyle = {
  background: "var(--panel-plum)",
  border: "1px solid var(--panel-plum-line)",
  borderRadius: 20,
  padding: "14px 20px 12px",
  position: "relative",
  overflow: "hidden",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: 8,
  flexWrap: "wrap",
  gap: 10,
};

const titleStyle = {
  fontFamily: "var(--font-display)",
  fontSize: "1.05rem",
  fontWeight: 700,
  color: "var(--text)",
  letterSpacing: "-0.02em",
};

const subtitleStyle = {
  fontSize: "0.78rem",
  color: "var(--muted)",
  marginTop: 1,
};

const statsRowStyle = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const statBubble = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  background: "rgba(255, 255, 255, 0.04)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  padding: "5px 12px 5px 8px",
};

const statIcon = { display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 9, background: "rgba(255,255,255,0.05)" };

const statVal = {
  fontFamily: "var(--font-display)",
  fontSize: "0.98rem",
  fontWeight: 700,
  color: "var(--text)",
  lineHeight: 1.1,
};

const statLbl = {
  fontSize: "0.68rem",
  color: "var(--muted)",
  fontWeight: 600,
};

export default StreakCalendar;
