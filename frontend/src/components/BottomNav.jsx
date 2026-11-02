import React, { useEffect, useState, lazy, Suspense } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import API from '../services/api';
import { useChat } from './ChatContext';
import Icon from './Icon';
import Avatar from './Avatar';
import ThemeToggle from './ThemeToggle';
import Logo from './Logo';
import './BottomNav.css';

const CalorieCalculator = lazy(() => import('./CalorieCalculator'));

// Chat is a phone-only tab: on desktop the messages icon in the top bar (next to notifications) opens it.
// App navigation. Desktop (≥ 900px): a fixed sidebar. Phones: a bottom tab bar.
// Hidden on auth screens and the admin console. On the full-screen chat page the phone tab bar is
// hidden (the message box needs the room) but the desktop sidebar stays. While the floating chat
// window is open the phone tab bar steps aside too.
const LINKS = [
  { to: '/home', icon: 'home', label: 'Home' },
  { to: '/progress', icon: 'progress', label: 'Progress' },
  { to: '/community', icon: 'users', label: 'Community' },
  { to: '/friends', icon: 'userPlus', label: 'Friends', badge: 'requests' },
  { to: null, icon: 'message', label: 'Chat', badge: 'unread', mobileOnly: true },
  { to: '/leaderboard', icon: 'trophy', label: 'Leaderboard', desktopOnly: true },
  { to: null, action: 'calc', icon: 'calculator', label: 'Calories', desktopOnly: true },
  { to: '/profile', icon: 'user', label: 'Profile' },
];

const readUser = () => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } };

export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { openChat, isOpen, totalUnread, requests } = useChat();
  const [loggingOut, setLoggingOut] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const signedIn = !!localStorage.getItem('token');
  const hiddenRoute = /^\/(login|register|admin)(\/|$)/.test(pathname) || pathname === '/';
  const isChatPage = /^\/chat(\/|$)/.test(pathname);
  const visible = signedIn && !hiddenRoute;

  useEffect(() => {
    document.body.classList.toggle('has-sidenav', visible);
    document.body.classList.toggle('has-bottom-nav', visible && !isChatPage);
    return () => { document.body.classList.remove('has-sidenav'); document.body.classList.remove('has-bottom-nav'); };
  }, [visible, isChatPage]);

  // other screens (e.g. the phone Home shortcut) can open the calculator too
  useEffect(() => {
    const open = () => setShowCalc(true);
    window.addEventListener('aivo:open-calc', open);
    return () => window.removeEventListener('aivo:open-calc', open);
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try { await API.post('/auth/logout'); } catch (e) { console.error(e); }
    finally {
      if (readUser().is_demo) localStorage.removeItem('admin_token');   // demo admin: end the console session too
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.dispatchEvent(new Event('logout'));
      setLoggingOut(false);
      navigate('/login');
    }
  };

  if (!visible) return null;
  const counts = { requests: requests.length, unread: totalUnread };
  const user = readUser();
  const cls = `appnav${isChatPage ? ' is-chat' : ''}${isOpen ? ' chat-open' : ''}`;

  return (
    <nav className={cls} aria-label="Main">
      <NavLink to="/home" className="an-brand" aria-label="Aivo home">
        <Logo alt="Aivo" />
      </NavLink>

      <div className="an-links">
        {LINKS.map((t) => {
          const n = t.badge ? counts[t.badge] : 0;
          const inner = (
            <>
              <span className="an-icon">
                <Icon name={t.icon} size={20} />
                {n > 0 && <span className="an-badge">{n > 9 ? '9+' : n}</span>}
              </span>
              <span className="an-label">{t.label}</span>
            </>
          );
          const extra = `${t.desktopOnly ? ' an-desk' : ''}${t.mobileOnly ? ' an-mob' : ''}`;
          return t.to ? (
            <NavLink key={t.label} to={t.to} className={({ isActive }) => `an-item${extra}${isActive ? ' active' : ''}`}>{inner}</NavLink>
          ) : (
            <button key={t.label} type="button" className={`an-item${extra}`} onClick={() => (t.action === 'calc' ? setShowCalc(true) : openChat())}>{inner}</button>
          );
        })}
      </div>

      <div className="an-foot">
        <NavLink to="/profile" className="an-user">
          <Avatar name={user.full_name || '?'} size={36} showPresence={false} />
          <span className="an-user-meta">
            <strong>{user.full_name || 'Athlete'}</strong>
            <small>{user.points != null ? `${user.points} pts` : 'Member'}</small>
          </span>
        </NavLink>
        <ThemeToggle className="an-theme" />
        <button type="button" className="an-logout" onClick={handleLogout} disabled={loggingOut} aria-label="Log out" title="Log out">
          <Icon name="logout" size={18} />
        </button>
      </div>
      {showCalc && (
        <div className="modal-overlay" onClick={() => setShowCalc(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCalc(false)} aria-label="Close"><Icon name="x" size={16} /></button>
            <Suspense fallback={<div className="modal-loading"><span className="route-spinner" /></div>}>
              <CalorieCalculator token={localStorage.getItem('token')} profile={user} />
            </Suspense>
          </div>
        </div>
      )}
    </nav>
  );
}
