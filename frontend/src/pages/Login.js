import React, { useState } from 'react';
import ThemeToggle from '../components/ThemeToggle';
import { useNavigate } from 'react-router-dom';
import './Auth.css';
import Logo from '../components/Logo';
import API from '../services/api';
import Icon from '../components/Icon';
import { DEMO_ACCOUNTS } from '../data/demoAccounts';
import { wantsRemember, setRememberChoice } from '../utils/rememberMe';

// Free-tier hosts put the API to sleep when idle (and after a redeploy), so the first login can take
// a while. Only login gets the long timeout; every other request keeps the default 20 s.
const LOGIN_TIMEOUT_MS = 60000;
const WAKING_NOTICE_AFTER_MS = 4000;
const WAKING_MESSAGE = 'Server is waking up, this can take up to a minute';

const Login = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [waking, setWaking] = useState(false);
  const [error, setError] = useState(() => { const n = sessionStorage.getItem('aivo_notice'); if (n) sessionStorage.removeItem('aivo_notice'); return n || ''; });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error when user starts typing
    if (error) {
      setError('');
    }
  };

  const navigate = useNavigate();
  const [remember, setRemember] = useState(wantsRemember);   // checked unless the person previously un-ticked it

  // One click on a demo account fills the form (the user then presses Sign in).
  const fillDemo = (acc) => {
    setFormData({ email: acc.email, password: acc.password });
    setShowPassword(true);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setWaking(false);
    // If the server hasn't answered after a few seconds, tell the user why instead of leaving them guessing.
    const wakingTimer = setTimeout(() => setWaking(true), WAKING_NOTICE_AFTER_MS);

    try {
      // Make API call to login (long timeout for this call only)
      const response = await API.post('/auth/login', formData, { timeout: LOGIN_TIMEOUT_MS });
      
      if (response.data.success) {
        // Store token and user data
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        setRememberChoice(remember);

        // Demo admin: open the (sandboxed) admin console instead of the member home.
        // Full navigation on purpose: announcing the sign-in first would make the /login route redirect to /home.
        if (response.data.admin_token) {
          localStorage.setItem('admin_token', response.data.admin_token);
          window.location.assign('/admin');
          return;
        }

        window.dispatchEvent(new Event('authUpdated'));

        // Redirect to home page in the SPA
        navigate('/home');
      } else {
        setError(response.data.message || 'Login failed. Please try again.');
      }
      
    } catch (error) {
      console.error('Login error:', error);
      
      if (error.response && error.response.data) {
        setError(error.response.data.message || 'Login failed. Please try again.');
      } else if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setError('You appear to be offline. Please check your connection and try again.');
      } else {
        // No response at all (timeout / connection refused while the server boots)
        setError(`${WAKING_MESSAGE}. Please try again in a moment.`);
      }
    } finally {
      clearTimeout(wakingTimer);
      setWaking(false);
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container auth-page">
      <ThemeToggle className="theme-fab" />
      <aside className="auth-aside" aria-hidden="true">
        <Logo className="main-logo" priority />
        <ul className="auth-points">
          <li><span><Icon name="bot" size={18} /></span><div><strong>AI coach that knows you</strong><small>Plans, calories and form tips built around your profile.</small></div></li>
          <li><span><Icon name="flame" size={18} /></span><div><strong>Keep your streak alive</strong><small>Log every session and watch your year fill in.</small></div></li>
          <li><span><Icon name="users" size={18} /></span><div><strong>Train with friends</strong><small>Chat, post and climb the leaderboard together.</small></div></li>
        </ul>
      </aside>
      <div className="login-card auth-card">
        <div className="login-header auth-head">
          <Logo alt="Aivo" className="auth-logo-mobile" />
          <h1>Welcome back</h1>
          <p className="welcome-text">Sign in to pick up where you left off.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && (
            <div className="auth-alert error" role="alert">
              {error}
            </div>
          )}

          {waking && isLoading && (
            <div className="auth-alert warn" role="status">
              {WAKING_MESSAGE}…
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <div className="input-wrapper">
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="you@example.com" autoComplete="email"
                required
                className="form-input"
              />
              <span className="input-icon"><Icon name="mail" size={17} /></span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="input-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Your password" autoComplete="current-password"
                required
                className="form-input"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
              </button>
            </div>
          </div>

          <div className="form-options">
            <label className="checkbox-wrapper">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span className="checkmark"></span>
              Remember me
            </label>
            <a href="#" className="forgot-password">Forgot password?</a>
          </div>

          <button
            type="submit"
            className={`login-button ${isLoading ? 'loading' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <span className="login-busy">{waking ? 'Waking up server…' : 'Signing in…'}</span>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <div className="demo-box" aria-label="Demo accounts">
          <div className="demo-box-head"><Icon name="sparkles" size={13} /> Demo</div>
          <div className="demo-list">
            {DEMO_ACCOUNTS.map((acc) => {
              const active = formData.email === acc.email && formData.password === acc.password;
              return (
                <button key={acc.key} type="button" className={`demo-chip${active ? ' on' : ''}`} onClick={() => fillDemo(acc)} title={`Fill in ${acc.label}`}>
                  <b>{acc.short}</b>
                  <span>{acc.email} · {acc.password}</span>
                </button>
              );
            })}
          </div>
          <p className="demo-note">Click an account to fill the form, then press Sign in. The admin account opens a demo admin console.</p>
        </div>

        <div className="login-footer">
          <p>New to Aivo? <a href="/register" className="signup-link">Create an account</a></p>
        </div>


      </div>
    </div>
  );
};

export default Login; 