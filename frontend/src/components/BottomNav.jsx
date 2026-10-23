import React, { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useChat } from './ChatContext';
import Icon from './Icon';
import './BottomNav.css';

// Mobile-only tab bar (hidden ≥ 769px via CSS). Hidden on auth screens, the admin console and the
// full-screen chat page (its input needs the space), and while the floating chat window is open.
const TABS = [
  { to: '/home', icon: 'home', label: 'Home' },
  { to: '/progress', icon: 'progress', label: 'Progress' },
  { to: '/community', icon: 'users', label: 'Community' },
  { to: '/friends', icon: 'userPlus', label: 'Friends', badge: 'requests' },
  { to: null, icon: 'message', label: 'Chat', badge: 'unread' },
  { to: '/profile', icon: 'user', label: 'Profile' },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  const { openChat, isOpen, totalUnread, requests } = useChat();
  const signedIn = !!localStorage.getItem('token');
  const hiddenRoute = /^\/(login|register|admin|chat)(\/|$)/.test(pathname) || pathname === '/';
  const visible = signedIn && !hiddenRoute && !isOpen;

  useEffect(() => {
    document.body.classList.toggle('has-bottom-nav', signedIn && !hiddenRoute);
    return () => document.body.classList.remove('has-bottom-nav');
  }, [signedIn, hiddenRoute]);

  if (!visible) return null;
  const counts = { requests: requests.length, unread: totalUnread };

  return (
    <nav className="bottom-nav" aria-label="Main">
      {TABS.map((t) => {
        const n = t.badge ? counts[t.badge] : 0;
        const inner = (
          <>
            <span className="bn-icon">
              <Icon name={t.icon} size={21} />
              {n > 0 && <span className="bn-badge">{n > 9 ? '9+' : n}</span>}
            </span>
            <span className="bn-label">{t.label}</span>
          </>
        );
        return t.to ? (
          <NavLink key={t.label} to={t.to} className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>{inner}</NavLink>
        ) : (
          <button key={t.label} type="button" className="bn-item" onClick={() => openChat()}>{inner}</button>
        );
      })}
    </nav>
  );
}
