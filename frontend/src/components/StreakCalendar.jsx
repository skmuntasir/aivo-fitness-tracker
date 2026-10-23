import React, { memo, useEffect, useMemo, useState } from "react";
import API from "../services/api";
import { localDateKey, userTimeZone } from "../utils/time";
import "./StreakCalendar.css";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS   = ["S","M","T","W","T","F","S"];
const CELL = 12;
const GAP  = 3;
const colW = CELL + GAP;

const level = (count) => {
  if (count < 0)     return "out";
  if (count === 0)   return "l0";
  if (count < 900)   return "l1";
  if (count < 1800)  return "l2";
  if (count < 2700)  return "l3";
  if (count < 3600)  return "l4";
  return "l5";
};

const fmtMin = (sec) => {
  if (!sec) return "Rest day";
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m active` : `${m} min active`;
};

// Pure + memoised: a cell only re-renders if ITS date/count changes. Hover tooltips are
// CSS-only (data-tip), so hovering no longer re-renders all ~370 cells.
const Cell = memo(function Cell({ date, count }) {
  const inYear = count >= 0;
  return (
    <div
      className={`sc-cell sc-${level(count)}`}
      data-tip={inYear ? `${date} · ${fmtMin(count)}` : undefined}
    />
  );
});

const cacheKey = (year) => {
  let uid = "anon";
  try { uid = JSON.parse(localStorage.getItem("user") || "{}").id || "anon"; } catch {}
  return `streak:v3:${uid}:${year}:${userTimeZone}`;
};
const readCacheEntry = (year) => {
  try { return JSON.parse(localStorage.getItem(cacheKey(year))) || null; } catch { return null; }
};
const readCache = (year) => readCacheEntry(year)?.data || null;

function StreakCalendar({ token, refreshKey }) {
  const currentYear = new Date().getFullYear();

  // Seed from the last known data so coloured days are there on the FIRST paint after a refresh,
  // then revalidate in the background (previously: empty grid until the request finished).
  const [streakData, setStreakData] = useState(() => readCache(currentYear) || []);
  const [loaded, setLoaded] = useState(() => !!readCache(currentYear));
  // Streak straight from the server: the same number Home, the leaderboard and the profile use.
  const [serverStreak, setServerStreak] = useState(() => readCacheEntry(currentYear)?.streak ?? null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await API.get("/workouts/daily-summary", { params: { year: currentYear, tz: userTimeZone } });
        if (cancelled || !res.data.success) return;
        setStreakData(res.data.streak_data);
        const srv = Number.isFinite(res.data.streak) ? res.data.streak : null;
        setServerStreak(srv);
        try { localStorage.setItem(cacheKey(currentYear), JSON.stringify({ t: Date.now(), data: res.data.streak_data, streak: srv })); } catch {}
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

  const { activeDays, totalMin, streak: localStreak } = useMemo(() => {
    const vals = Object.values(dataMap);
    let s = 0;
    const d = new Date();
    if (!(dataMap[localDateKey(d)] > 0)) d.setDate(d.getDate() - 1); // not trained *yet* today doesn't reset the streak
    while (dataMap[localDateKey(d)] > 0) { s++; d.setDate(d.getDate() - 1); }
    return {
      activeDays: vals.filter((v) => v > 0).length,
      totalMin: Math.floor(vals.reduce((a, b) => a + b, 0) / 60),
      streak: s,
    };
  }, [dataMap]);

  const streak = serverStreak ?? localStreak;   // server value wins; local count is only a fallback

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <div style={titleStyle}>
            <span style={{ marginRight: 8 }}>📅</span>
            Activity Heatmap
          </div>
          <div style={subtitleStyle}>{currentYear} workout history</div>
        </div>
        <div style={statsRowStyle}>
          <div style={statBubble}>
            <span style={statEmoji}>🔥</span>
            <div><div style={statVal}>{streak}</div><div style={statLbl}>Streak</div></div>
          </div>
          <div style={statBubble}>
            <span style={statEmoji}>✅</span>
            <div><div style={statVal}>{activeDays}</div><div style={statLbl}>Active Days</div></div>
          </div>
          <div style={statBubble}>
            <span style={statEmoji}>⏱</span>
            <div>
              <div style={statVal}>{totalMin >= 60 ? `${Math.floor(totalMin / 60)}h` : `${totalMin}m`}</div>
              <div style={statLbl}>Total Time</div>
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
                <div key={wi} style={{ width: colW, flexShrink: 0, fontSize: "0.62rem", color: "rgba(167,139,250,0.6)", fontWeight: 700, letterSpacing: "0.04em" }}>
                  {lbl ? MONTHS[lbl.month] : ""}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: GAP, marginRight: 5, flexShrink: 0 }}>
              {DAYS.map((d, i) => (
                <div key={i} style={{ height: CELL, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 3, fontSize: "0.58rem", color: i % 2 === 1 ? "rgba(167,139,250,0.5)" : "transparent", width: 20, fontWeight: 700 }}>
                  {d}
                </div>
              ))}
            </div>

            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: "flex", flexDirection: "column", gap: GAP, marginRight: GAP }}>
                {week.map((cell) => (
                  <Cell key={cell.date} date={cell.date} count={cell.inYear ? (dataMap[cell.date] || 0) : -1} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 14, justifyContent: "flex-end" }}>
        <span style={{ fontSize: "0.65rem", color: "rgba(167,139,250,0.4)", fontWeight: 600 }}>Less</span>
        {["l0", "l1", "l2", "l3", "l4", "l5"].map((l) => <div key={l} className={`sc-cell sc-${l} sc-legend`} />)}
        <span style={{ fontSize: "0.65rem", color: "rgba(167,139,250,0.4)", fontWeight: 600 }}>More</span>
      </div>
    </div>
  );
}

const containerStyle = {
  background: "linear-gradient(145deg, rgba(13,17,40,0.97) 0%, rgba(20,16,50,0.95) 50%, rgba(13,17,40,0.97) 100%)",
  border: "1px solid rgba(167,139,250,0.14)",
  borderRadius: 28,
  padding: "28px 28px 22px",
  backdropFilter: "blur(24px)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(167,139,250,0.06) inset",
  position: "relative",
  overflow: "hidden",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: 22,
  flexWrap: "wrap",
  gap: 14,
};

const titleStyle = {
  fontSize: "1.15rem",
  fontWeight: 800,
  color: "#eef4ff",
  letterSpacing: "-0.02em",
  display: "flex",
  alignItems: "center",
};

const subtitleStyle = {
  fontSize: "0.76rem",
  color: "rgba(167,139,250,0.55)",
  marginTop: 3,
  fontWeight: 500,
  paddingLeft: 26,
};

const statsRowStyle = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

const statBubble = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "rgba(167,139,250,0.08)",
  border: "1px solid rgba(167,139,250,0.16)",
  borderRadius: 14,
  padding: "8px 14px",
};

const statEmoji = { fontSize: "1.1rem" };

const statVal = {
  fontSize: "1rem",
  fontWeight: 800,
  color: "#e8e0ff",
  lineHeight: 1.2,
};

const statLbl = {
  fontSize: "0.63rem",
  color: "rgba(167,139,250,0.55)",
  fontWeight: 700,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};

export default StreakCalendar;
