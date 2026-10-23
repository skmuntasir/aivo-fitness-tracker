import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import ADMIN from './adminApi';
import { useAdmin } from './adminContext';
import Icon from './Icon';
import { Avatar } from './ui';

const NAV = [
  { label: 'Menu', items: [
    { to: '/admin', icon: 'grid', text: 'Dashboard', end: true },
    { to: '/admin/users', icon: 'users', text: 'Users' },
    { to: '/admin/workouts', icon: 'activity', text: 'Workouts' },
    { to: '/admin/posts', icon: 'shield', text: 'Posts & reports', badge: 'reports' },
  ] },
  { label: 'Platform', adminOnly: true, items: [
    { to: '/admin/leaderboard', icon: 'award', text: 'Leaderboard' },
    { to: '/admin/announcements', icon: 'bell', text: 'Announcements' },
    { to: '/admin/audit', icon: 'file', text: 'Audit log' },
    { to: '/admin/settings', icon: 'sliders', text: 'Settings' },
  ] },
];

export default function AdminLayout({ children }) {
  const { admin, logout, theme, toggleTheme } = useAdmin();
  const [open, setOpen] = useState(false);
  const [openReports, setOpenReports] = useState(0);
  const location = useLocation();
  const isAdmin = admin?.role === 'admin';

  // Sidebar badge: open reports (refreshed every 90s and on navigation)
  useEffect(() => {
    let alive = true;
    const load = () => ADMIN.get('/dashboard/overview').then((r) => alive && setOpenReports(r.data.kpi.open_reports)).catch(() => {});
    load();
    const t = setInterval(load, 90000);
    return () => { alive = false; clearInterval(t); };
  }, [location.pathname]);

  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <>
      <aside className={`a-side ${open ? 'open' : ''}`}>
        <div className="a-brand">
          <span className="a-brand-mark">A</span>
          <span><b>Aivo</b><small>Admin console</small></span>
        </div>
        <nav className="a-nav">
          {NAV.filter((g) => isAdmin || !g.adminOnly).map((g) => (
            <React.Fragment key={g.label}>
              <div className="a-nav-label">{g.label}</div>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <Icon name={n.icon} /> {n.text}
                  {n.badge === 'reports' && openReports > 0 && <span className="a-pill">{openReports}</span>}
                </NavLink>
              ))}
            </React.Fragment>
          ))}
        </nav>
        <div className="a-side-foot">
          <a href="/home" style={{ color: '#94a3b8', display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px' }}>
            <Icon name="external" size={15} /> Open user app
          </a>
        </div>
      </aside>
      <div className={`a-scrim ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />

      <div className="a-main">
        <header className="a-top">
          <button className="a-icon-btn a-burger" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div className="a-grow" />
          <button className="a-icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle light / dark">
            <Icon name={theme === 'light' ? 'moon' : 'sun'} />
          </button>
          <div className="a-me">
            <Avatar name={admin?.full_name || 'A'} />
            <Link to="/admin/account" className="a-me-text" style={{ color: 'inherit', textDecoration: 'none' }}><b>{admin?.full_name || 'Admin'}</b><small>{admin?.role === 'moderator' ? 'Moderator' : 'Admin'} · My account</small></Link>
          </div>
          <button className="a-btn sm ghost" onClick={logout}><Icon name="logout" size={15} /> Sign out</button>
        </header>
        <main className="a-content">{children}</main>
      </div>
    </>
  );
}
