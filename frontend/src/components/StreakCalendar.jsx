import React, { useEffect, useState } from "react";
import API from "../services/api";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS   = ["S","M","T","W","T","F","S"];

function StreakCalendar({ token , refreshKey }) {
  const [streakData, setStreakData] = useState([]);
  const [tooltip, setTooltip]       = useState(null);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await API.get("/workouts/daily-summary");
        const data = res.data;
        if (data.success) setStreakData(data.streak_data);
      } catch {}
    })();
  }, [token , refreshKey]);

  const dataMap = {};
  streakData.forEach(e => { dataMap[e.date] = e.total_duration; });

  const startDate = new Date(currentYear, 0, 1);
  const endDate   = new Date(currentYear, 11, 31);

  const weeks  = [];
  const first  = startDate.getDay();
  let current  = new Date(currentYear, 0, 1 - first);

  while (current <= endDate) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const iso    = current.toISOString().slice(0, 10);
      const inYear = current.getFullYear() === currentYear;
      week.push({ date: iso, count: inYear ? (dataMap[iso] || 0) : -1, day: new Date(current), inYear });
      current = new Date(current.getTime() + 86400000);
    }
    weeks.push(week);
  }

  const monthLabels = [];
  weeks.forEach((week, wi) => {
    week.forEach(cell => {
      if (cell.inYear && cell.day.getDate() <= 7) {
        const m = cell.day.getMonth();
        if (!monthLabels.find(l => l.month === m)) monthLabels.push({ month: m, weekIndex: wi });
      }
    });
  });

  const getColor = (count) => {
    if (count < 0)    return "transparent";
    if (count === 0)  return "rgba(255,255,255,0.04)";
    if (count < 900)  return "rgba(99,102,241,0.3)";
    if (count < 1800) return "rgba(99,102,241,0.55)";
    if (count < 2700) return "rgba(139,92,246,0.7)";
    if (count < 3600) return "rgba(167,139,250,0.85)";
    return "#a78bfa";
  };

  const fmtMin = (sec) => {
    if (!sec) return "Rest day";
    const m = Math.floor(sec / 60);
    return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m active` : `${m} min active`;
  };

  const activeDays  = Object.values(dataMap).filter(v => v > 0).length;
  const totalMin    = Math.floor(Object.values(dataMap).reduce((a, b) => a + b, 0) / 60);

  // Current streak calc
  const today = new Date().toISOString().slice(0, 10);
  let streak = 0;
  let d = new Date();
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (dataMap[key] > 0) { streak++; d = new Date(d.getTime() - 86400000); }
    else break;
  }

  const CELL = 12;
  const GAP  = 3;
  const colW = CELL + GAP;

  return (
    <div style={containerStyle}>
      {/* Header */}
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
            <div>
              <div style={statVal}>{streak}</div>
              <div style={statLbl}>Streak</div>
            </div>
          </div>
          <div style={statBubble}>
            <span style={statEmoji}>✅</span>
            <div>
              <div style={statVal}>{activeDays}</div>
              <div style={statLbl}>Active Days</div>
            </div>
          </div>
          <div style={statBubble}>
            <span style={statEmoji}>⏱</span>
            <div>
              <div style={statVal}>
                {totalMin >= 60 ? `${Math.floor(totalMin/60)}h` : `${totalMin}m`}
              </div>
              <div style={statLbl}>Total Time</div>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Grid */}
      <div style={{ overflowX: "auto", paddingBottom: 6 }}>
        <div style={{ position: "relative", minWidth: weeks.length * colW + 36 }}>
          {/* Month labels */}
          <div style={{ display: "flex", marginBottom: 5, paddingLeft: 26 }}>
            {weeks.map((_, wi) => {
              const lbl = monthLabels.find(l => l.weekIndex === wi);
              return (
                <div key={wi} style={{ width: colW, flexShrink: 0, fontSize: "0.62rem", color: "rgba(167,139,250,0.6)", fontWeight: 700, letterSpacing: "0.04em" }}>
                  {lbl ? MONTHS[lbl.month] : ""}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex" }}>
            {/* Day labels */}
            <div style={{ display: "flex", flexDirection: "column", gap: GAP, marginRight: 5, flexShrink: 0 }}>
              {DAYS.map((d, i) => (
                <div key={i} style={{ height: CELL, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 3, fontSize: "0.58rem", color: i % 2 === 1 ? "rgba(167,139,250,0.5)" : "transparent", width: 20, fontWeight: 700 }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Cells */}
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: "flex", flexDirection: "column", gap: GAP, marginRight: GAP }}>
                {week.map((cell, di) => (
                  <div
                    key={di}
                    title={cell.inYear ? `${cell.date}: ${fmtMin(cell.count)}` : ""}
                    style={{
                      width: CELL, height: CELL,
                      borderRadius: 3,
                      background: getColor(cell.count),
                      border: cell.count > 0 ? "1px solid rgba(167,139,250,0.25)" : "1px solid rgba(255,255,255,0.04)",
                      cursor: cell.inYear ? "pointer" : "default",
                      transition: "transform 0.12s ease, box-shadow 0.12s ease",
                      transform: tooltip?.date === cell.date ? "scale(1.4)" : "scale(1)",
                      boxShadow: tooltip?.date === cell.date && cell.count > 0 ? "0 0 10px rgba(167,139,250,0.6)" : "none",
                    }}
                    onMouseEnter={() => cell.inYear && setTooltip({ date: cell.date, count: cell.count })}
                    onMouseLeave={() => setTooltip(null)}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(8,10,24,0.97)",
              border: "1px solid rgba(167,139,250,0.35)",
              borderRadius: 10, padding: "7px 14px",
              display: "flex", flexDirection: "column", gap: 2,
              pointerEvents: "none", whiteSpace: "nowrap",
              boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
              zIndex: 100,
            }}>
              <strong style={{ color: "#eef4ff", fontSize: "0.8rem" }}>{tooltip.date}</strong>
              <span style={{ color: "rgba(167,139,250,0.85)", fontSize: "0.75rem" }}>{fmtMin(tooltip.count)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 14, justifyContent: "flex-end" }}>
        <span style={{ fontSize: "0.65rem", color: "rgba(167,139,250,0.4)", fontWeight: 600 }}>Less</span>
        {["rgba(255,255,255,0.04)", "rgba(99,102,241,0.3)", "rgba(99,102,241,0.55)", "rgba(139,92,246,0.7)", "rgba(167,139,250,0.85)", "#a78bfa"].map((c, i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: 3, background: c, border: i === 0 ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(167,139,250,0.2)" }} />
        ))}
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
