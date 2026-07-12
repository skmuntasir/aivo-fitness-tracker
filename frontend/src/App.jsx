import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import Profile from './pages/Profile';
import Progress from './pages/Progress';
import Community from './pages/Community';
import Friends from './pages/Friends';
import Chat from './pages/Chat';
import LeaderboardPage from './components/LeaderboardPage';
import { ChatProvider } from './components/ChatContext';
import ChatPanel from './components/ChatPanel';


function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

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

    const handleToggleChat = () => {
      setChatOpen((open) => !open);
    };

    const handleLogout = () => {
      setIsAuthenticated(false);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('authUpdated', handleAuthUpdated);
    window.addEventListener('logout', handleLogout);
    window.addEventListener('toggleChatSidebar', handleToggleChat);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('authUpdated', handleAuthUpdated);
      window.removeEventListener('logout', handleLogout);
      window.removeEventListener('toggleChatSidebar', handleToggleChat);
    };
  }, []);

  return (
    <ChatProvider>
      <Router>
        <div className="App">
        <Routes>
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
        </div>
        <ChatPanel />
      </Router>
    </ChatProvider>
  );
}

export default App;

