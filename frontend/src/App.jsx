import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './App.css';
import Login from './pages/Login';  // eager: first screen for logged-out users
const Register = lazy(() => import('./pages/Register'));
const Home = lazy(() => import('./pages/Home'));
const Profile = lazy(() => import('./pages/Profile'));
const Progress = lazy(() => import('./pages/Progress'));
const Community = lazy(() => import('./pages/Community'));
const Friends = lazy(() => import('./pages/Friends'));
const Chat = lazy(() => import('./pages/Chat'));
const LeaderboardPage = lazy(() => import('./components/LeaderboardPage'));
import { ChatProvider } from './components/ChatContext';
import ChatPanel from './components/ChatPanel';
import BottomNav from './components/BottomNav';
const AdminApp = lazy(() => import('./admin/AdminApp'));

// The user-app chat widget must not appear inside the admin console
const UserChatPanel = () => (useLocation().pathname.startsWith('/admin') ? null : <ChatPanel />);


// Full-screen notice shown when an admin turned maintenance mode on
function MaintenanceNotice() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    const on = (e) => setMsg(e.detail || 'We are doing some maintenance. Please check back shortly.');
    window.addEventListener('maintenance', on);
    return () => window.removeEventListener('maintenance', on);
  }, []);
  if (!msg || window.location.pathname.startsWith('/admin')) return null;
  return (
    <div role="alert" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(5,8,22,0.96)', color: '#e8efff', textAlign: 'center' }}>
      <div style={{ maxWidth: 440 }}>
        <div style={{ fontSize: 56 }}>🛠️</div>
        <h2 style={{ margin: '12px 0 8px' }}>We’ll be right back</h2>
        <p style={{ color: '#9bb4da', lineHeight: 1.6 }}>{msg}</p>
        <button onClick={() => window.location.reload()} style={{ marginTop: 16, background: 'linear-gradient(135deg,#3b82f6,#2563eb)', border: 'none', color: '#fff', cursor: 'pointer' }}>Try again</button>
      </div>
    </div>
  );
}

function App() {
  // Initialise synchronously from localStorage: starting at `false` redirected logged-in users
  // to /login and then back to /home on every refresh.
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('token'));

  useEffect(() => {
    const checkAuth = () => {
      const token = localStorage.getItem('token');
      setIsAuthenticated(!!token);
    };

    checkAuth();

    const handleStorageChange = (e) => {
      if (e.key === 'token') {
        checkAuth();
      }
    };

    const handleAuthUpdated = () => {
      checkAuth();
    };

    const handleLogout = () => {
      setIsAuthenticated(false);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('authUpdated', handleAuthUpdated);
    window.addEventListener('logout', handleLogout);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('authUpdated', handleAuthUpdated);
      window.removeEventListener('logout', handleLogout);
    };
  }, []);

  return (
    <ChatProvider>
      <Router>
        <div className="App">
        <Suspense fallback={<div className="route-loading" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#a8b9ff' }}>Loading…</div>}>
        <Routes>
          <Route path="/admin/*" element={<AdminApp />} />
          <Route path="/" element={
            isAuthenticated ? <Navigate to="/home" replace /> : <Navigate to="/login" replace />
          } />
          <Route path="/login" element={
            isAuthenticated ? <Navigate to="/home" replace /> : <Login />
          } />
          <Route path="/register" element={
            isAuthenticated ? <Navigate to="/home" replace /> : <Register />
          } />
          <Route path="/home" element={
            isAuthenticated ? <Home /> : <Navigate to="/login" replace />
          } />
          <Route path="/profile" element={
            isAuthenticated ? <Profile /> : <Navigate to="/login" replace />
          } />
          <Route path="/leaderboard" element={
            isAuthenticated ? <LeaderboardPage /> : <Navigate to="/login" replace />
          } />
          <Route path="/progress" element={
            isAuthenticated ? <Progress /> : <Navigate to="/login" replace />
          } />
          <Route path="/community" element={
            isAuthenticated ? <Community /> : <Navigate to="/login" replace />
          } />
          <Route path="/friends" element={
            isAuthenticated ? <Friends /> : <Navigate to="/login" replace />
          } />
          <Route path="/chat/:friendId" element={
            isAuthenticated ? <Chat /> : <Navigate to="/login" replace />
          } />
        </Routes>
        </Suspense>
        </div>
        <UserChatPanel />
        <BottomNav />
        <MaintenanceNotice />
      </Router>
    </ChatProvider>
  );
}

export default App;

