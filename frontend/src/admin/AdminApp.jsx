// Admin portal entry. Mounted at /admin/* by App.jsx. Owns its own auth state (admin_token), theme and
// routes, completely separate from the user app.
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import './admin.css';
import ADMIN, { TOKEN_KEY } from './adminApi';
import { AdminContext } from './adminContext';
import { ConfirmProvider, Spinner, ToastProvider } from './ui';
import AdminLayout from './AdminLayout';
import LoginPage from './pages/LoginPage';

const Dashboard = lazy(() => import('./pages/DashboardPage'));
const Users = lazy(() => import('./pages/UsersPage'));
const UserDetail = lazy(() => import('./pages/UserDetailPage'));
const Workouts = lazy(() => import('./pages/WorkoutsPage'));
const Posts = lazy(() => import('./pages/ModerationPage'));
const Leaderboard = lazy(() => import('./pages/LeaderboardPage'));
const Announcements = lazy(() => import('./pages/AnnouncementsPage'));
const Audit = lazy(() => import('./pages/AuditPage'));
const Settings = lazy(() => import('./pages/SettingsPage'));
const Account = lazy(() => import('./pages/AccountPage'));

// Moderators are bounced from admin-only screens (the API enforces this too)
function AdminOnly({ role, children }) { return role === 'admin' ? children : <Navigate to="/admin" replace />; }

function Gate({ status }) {
  const location = useLocation();
  if (status === 'checking') return <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}><Spinner label="Verifying session…" /></div>;
  if (status === 'out') return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  return (
    <AdminLayout>
      <Suspense fallback={<Spinner />}><Outlet /></Suspense>
    </AdminLayout>
  );
}

export default function AdminApp() {
  const location = useLocation();
  const [auth, setAuth] = useState(() => ({ status: localStorage.getItem(TOKEN_KEY) ? 'checking' : 'out', admin: null }));
  const [theme, setTheme] = useState(() => localStorage.getItem('admin_theme') || 'light');

  useEffect(() => {
    document.title = 'Aivo Admin';
    return () => { document.title = 'Aivo'; };
  }, []);

  useEffect(() => {
    if (auth.status !== 'checking') return;
    ADMIN.get('/auth/me')
      .then((r) => setAuth({ status: 'in', admin: r.data.admin }))
      .catch(() => { localStorage.removeItem(TOKEN_KEY); setAuth({ status: 'out', admin: null }); });
  }, [auth.status]);

  useEffect(() => {
    const out = () => setAuth({ status: 'out', admin: null });
    window.addEventListener('admin-logout', out);
    return () => window.removeEventListener('admin-logout', out);
  }, []);

  const login = useCallback((token, admin) => {
    localStorage.setItem(TOKEN_KEY, token);
    setAuth({ status: 'in', admin });
  }, []);
  const logout = useCallback(() => { localStorage.removeItem(TOKEN_KEY); setAuth({ status: 'out', admin: null }); }, []);
  const toggleTheme = useCallback(() => setTheme((t) => {
    const next = t === 'light' ? 'dark' : 'light';
    localStorage.setItem('admin_theme', next);
    return next;
  }), []);

  const ctx = useMemo(() => ({ admin: auth.admin, setAdmin: (a) => setAuth((s) => ({ ...s, admin: a })), login, logout, theme, toggleTheme }),
    [auth.admin, login, logout, theme, toggleTheme]);
  const isLogin = location.pathname.replace(/\/$/, '') === '/admin/login';

  return (
    <AdminContext.Provider value={ctx}>
      <div className={`adm ${isLogin ? 'a-login' : ''}`} data-theme={theme}>
        <ToastProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="login" element={auth.status === 'in' ? <Navigate to="/admin" replace /> : <LoginPage />} />
              <Route element={<Gate status={auth.status} />}>
                <Route index element={<Dashboard />} />
                <Route path="users" element={<Users />} />
                <Route path="users/:id" element={<UserDetail />} />
                <Route path="workouts" element={<Workouts />} />
                <Route path="posts" element={<Posts />} />
                <Route path="account" element={<Account />} />
                <Route path="leaderboard" element={<AdminOnly role={auth.admin?.role}><Leaderboard /></AdminOnly>} />
                <Route path="announcements" element={<AdminOnly role={auth.admin?.role}><Announcements /></AdminOnly>} />
                <Route path="audit" element={<AdminOnly role={auth.admin?.role}><Audit /></AdminOnly>} />
                <Route path="settings" element={<AdminOnly role={auth.admin?.role}><Settings /></AdminOnly>} />
                <Route path="*" element={<Navigate to="/admin" replace />} />
              </Route>
            </Routes>
          </ConfirmProvider>
        </ToastProvider>
      </div>
    </AdminContext.Provider>
  );
}
