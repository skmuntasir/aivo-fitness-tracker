import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import './index.css';
import './styles/tokens.css';
import './styles/theme.css';
import './styles/performance.css';
import './styles/heat.css';
import './styles/light.css';
import { applyTheme, getTheme } from './utils/theme';
import App from './App';
import { FeedbackProvider } from './components/Feedback';
import { BACKEND_URL } from './services/api';
import { warmUp } from './utils/prefetch';
import { applyRememberChoice } from './utils/rememberMe';

// "Remember me" unchecked + browser was closed since? Drop the saved sign-in BEFORE the app reads it.
applyRememberChoice();

applyTheme(getTheme());   // keep <html data-theme> in sync with the saved choice

// Open the connection (DNS + TLS) to the API while the app is still booting
try {
  const origin = new URL(BACKEND_URL).origin;
  if (origin !== window.location.origin) {
    const l = document.createElement('link');
    l.rel = 'preconnect'; l.href = origin; l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  }
} catch { /* invalid URL: nothing to preconnect */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  </React.StrictMode>
);

// After the first screen is up, quietly download the other pages' code while the browser is idle
warmUp();
