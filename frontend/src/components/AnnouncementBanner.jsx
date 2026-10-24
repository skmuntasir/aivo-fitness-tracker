import React, { useEffect, useState } from 'react';
import API from '../services/api';

const COLORS = {
  info: ['rgba(59,130,246,0.16)', '#93c5fd'], success: ['rgba(16,185,129,0.16)', '#6ee7b7'],
  warning: ['rgba(245,158,11,0.16)', '#fcd34d'], critical: ['rgba(239,68,68,0.18)', '#fca5a5'],
};
const KEY = 'aivo_dismissed_announcements';
const readDismissed = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };

// Announcements written by admins (Admin console → Announcements). Dismissed ones stay hidden on this device.
export default function AnnouncementBanner() {
  const [items, setItems] = useState([]);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    let alive = true;
    API.get('/announcements/active').then((r) => alive && setItems(r.data.announcements || [])).catch(() => {});
    return () => { alive = false; };
  }, []);

  const dismiss = (id) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* optional */ }
  };
  const visible = items.filter((a) => !dismissed.includes(a.id));
  if (!visible.length) return null;
  return (
    <div style={{ display: 'grid', gap: 10, padding: '100px 20px 0', maxWidth: 1200, margin: '0 auto', position: 'relative', zIndex: 5 }}>
      {visible.map((a) => {
        const [bg, fg] = COLORS[a.type] || COLORS.info;
        return (
          <div key={a.id} role="status" style={{ background: bg, border: `1px solid ${fg}55`, color: '#e8efff', borderRadius: 14, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <strong style={{ color: fg }}>📣 {a.title}</strong>
              {a.body && <div style={{ marginTop: 4, fontSize: 14, opacity: 0.9, whiteSpace: 'pre-wrap' }}>{a.body}</div>}
            </div>
            <button onClick={() => dismiss(a.id)} aria-label="Dismiss announcement"
              style={{ background: 'transparent', border: 'none', padding: 4, color: '#e8efff', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
        );
      })}
    </div>
  );
}
