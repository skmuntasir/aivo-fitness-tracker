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
  ['users', 'Members & roles'],
  ['shield', 'Moderation'],
  ['activity', 'Live analytics'],
  ['file', 'Audit log'],
];

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
      <div className="a-auth-card">
        <div className="a-auth-head">
          <img src={logo} alt="Aivo" className="a-auth-logo" decoding="async" />
          <span className="a-auth-badge"><Icon name="shield" size={14} /> Admin Console</span>
          <p className="a-auth-welcome">Welcome back! Sign in to manage the platform.</p>
        </div>

        <form onSubmit={submit} className="a-auth-form">
          {error && <div className="a-auth-error" role="alert">{error}</div>}

          <div className="a-auth-group">
            <label htmlFor="admin-email">Email</label>
            <div className="a-auth-wrap">
              <input id="admin-email" name="email" type="email" autoComplete="username" required autoFocus
                value={form.email} onChange={change} placeholder="Enter your admin email" className="a-auth-input" />
            </div>
          </div>

          <div className="a-auth-group">
            <label htmlFor="admin-password">Password</label>
            <div className="a-auth-wrap">
              <input id="admin-password" name="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required
                value={form.password} onChange={change} placeholder="Enter your password" className="a-auth-input" />
              <button type="button" className="a-auth-eye" onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}>
                {showPw ? <EyeOff /> : <Icon name="eye" size={18} />}
              </button>
            </div>
          </div>

          <button type="submit" className="a-auth-submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <ul className="a-auth-features">
          {FEATURES.map(([icon, label]) => (
            <li key={label}><Icon name={icon} size={14} /> {label}</li>
          ))}
        </ul>

        <div className="a-auth-foot">
          <Link to="/login">← Back to the Aivo app</Link>
          <small>Restricted area · authorised administrators only</small>
        </div>
      </div>
    </div>
  );
}
