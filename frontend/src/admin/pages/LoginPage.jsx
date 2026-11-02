import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ADMIN, { errMsg } from '../adminApi';
import { useAdmin } from '../adminContext';
import Icon from '../Icon';
import logo from '../../pages/images/aivo_logo.webp';

const EyeOff = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const FEATURES = [
  ['users', 'Members & roles', 'Search, edit, suspend and manage every account.'],
  ['shield', 'Moderation', 'Review reported posts and take action quickly.'],
  ['activity', 'Live analytics', 'Signups, workouts and activity at a glance.'],
  ['file', 'Audit log', 'Every admin action, recorded.'],
];

// Admin sign-in. Same two-pane layout as the member login so both feel like one product;
// the "Admin console" badge is what tells them apart.
export default function LoginPage() {
  const { login } = useAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const change = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    if (error) setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await ADMIN.post('/auth/login', form);
      login(data.token, data.admin);
      navigate(location.state?.from?.startsWith('/admin') ? location.state.from : '/admin', { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="a-auth">
      <aside className="a-auth-aside" aria-hidden="true">
        <img src={logo} alt="" className="a-auth-logo" width="360" height="240" decoding="async" fetchpriority="high" />
        <ul className="a-auth-points">
          {FEATURES.map(([icon, title, text]) => (
            <li key={title}><span><Icon name={icon} size={18} /></span><div><strong>{title}</strong><small>{text}</small></div></li>
          ))}
        </ul>
      </aside>

      <main className="a-auth-main">
        <div className="a-auth-card">
          <div className="a-auth-head">
            <img src={logo} alt="Aivo" className="a-auth-mobile-logo" width="360" height="240" decoding="async" />
            <span className="a-auth-badge"><Icon name="shield" size={14} /> Admin console</span>
            <h1>Welcome back</h1>
            <p className="a-auth-welcome">Sign in to manage the platform.</p>
          </div>

          <form onSubmit={submit} className="a-auth-form">
            {error && <div className="a-auth-error" role="alert">{error}</div>}

            <div className="a-auth-group">
              <label htmlFor="admin-email">Email</label>
              <div className="a-auth-wrap">
                <input id="admin-email" name="email" type="email" autoComplete="username" required autoFocus
                  value={form.email} onChange={change} placeholder="admin@example.com" className="a-auth-input" />
                <span className="a-auth-ico"><Icon name="mail" size={17} /></span>
              </div>
            </div>

            <div className="a-auth-group">
              <label htmlFor="admin-password">Password</label>
              <div className="a-auth-wrap">
                <input id="admin-password" name="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required
                  value={form.password} onChange={change} placeholder="Your password" className="a-auth-input" />
                <button type="button" className="a-auth-eye" onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff /> : <Icon name="eye" size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="a-auth-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="a-auth-foot">
            <Link to="/login">← Back to the Aivo app</Link>
            <small>Restricted area · authorised administrators only</small>
          </div>
        </div>
      </main>
    </div>
  );
}
