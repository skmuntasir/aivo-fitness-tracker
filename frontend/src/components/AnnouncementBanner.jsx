import React, { useEffect, useState } from 'react';
import { readData, refreshData } from '../utils/dataCache';
import Icon from './Icon';

const COLORS = {
  info: ['rgba(92,182,255,0.12)', '#5cb6ff'], success: ['rgba(56,215,159,0.12)', '#38d79f'],
  warning: ['rgba(251,191,36,0.12)', '#fbbf24'], critical: ['rgba(248,113,113,0.14)', '#f87171'],
};
const KEY = 'aivo_dismissed_announcements';
const readDismissed = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };

// Announcements written by admins (Admin console → Announcements). Dismissed ones stay hidden on this device.
export default function AnnouncementBanner() {
  const [items, setItems] = useState(() => readData('announcements')?.data?.announcements || []);   // saved copy first: no pop-in
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    let alive = true;
    refreshData('announcements').then((d) => alive && setItems(d.announcements || [])).catch(() => {});
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
    <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
      {visible.map((a) => {
        const [bg, fg] = COLORS[a.type] || COLORS.info;
        return (
          <div key={a.id} role="status" style={{ background: bg, border: `1px solid ${fg}55`, color: 'var(--text)', borderRadius: 14, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ color: fg, display: 'inline-flex', marginTop: 2 }}><Icon name="megaphone" size={18} /></span>
            <div style={{ flex: 1 }}>
              <strong style={{ color: fg }}>{a.title}</strong>
              {a.body && <div style={{ marginTop: 4, fontSize: 14, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{a.body}</div>}
            </div>
            <button onClick={() => dismiss(a.id)} aria-label="Dismiss announcement"
              style={{ color: 'var(--muted)', cursor: 'pointer', display: 'inline-flex', padding: 4 }}><Icon name="x" size={16} /></button>
          </div>
        );
      })}
    </div>
  );
}
