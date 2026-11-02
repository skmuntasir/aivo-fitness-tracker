import React, { useEffect, useState } from 'react';
import Icon from './Icon';
import { getTheme, toggleTheme, subscribeTheme } from '../utils/theme';
import './Engage.css';

// Sun / moon switch for the member app. `variant="switch"` is the labelled row used on Profile.
export default function ThemeToggle({ variant = 'icon', className = '' }) {
  const [theme, setThemeState] = useState(getTheme);
  useEffect(() => subscribeTheme(setThemeState), []);
  const light = theme === 'light';
  const label = light ? 'Switch to dark theme' : 'Switch to light theme';

  if (variant === 'switch') {
    return (
      <button type="button" className={`theme-switch ${className}`} onClick={toggleTheme} role="switch" aria-checked={light} aria-label="Light theme">
        <span className="theme-switch-text">
          <strong>{light ? 'Light theme' : 'Dark theme'}</strong>
          <small>Tap to switch to {light ? 'dark' : 'light'}</small>
        </span>
        <span className={`theme-switch-track ${light ? 'on' : ''}`}>
          <span className="theme-switch-thumb"><Icon name={light ? 'sun' : 'moon'} size={14} /></span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" className={`theme-btn ${className}`} onClick={toggleTheme} aria-label={label} title={label}>
      <Icon name={light ? 'moon' : 'sun'} size={18} />
    </button>
  );
}
