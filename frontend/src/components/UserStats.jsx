import React, { useState, useEffect } from "react";
import API from '../services/api';

function UserStats({ token }) {
  const [points, setPoints] = useState(0);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUserStats() {
      try {
        const res = await API.get('/users/me');
        if (res.data.success) {
          setPoints(res.data.points);
          setStreak(res.data.streak);
        }
      } catch (e) {
        console.error("Failed to fetch user stats", e.response?.data || e.message);
      } finally {
        setLoading(false);
      }
    }
    if (token) {
      fetchUserStats();
    } else {
      setLoading(false);
    }
  }, [token]);

  if (loading) return <p style={{color:"#222", background:"#fff"}}>Loading stats...</p>;

  return (
    <div
      className="user-stats"
      style={{
        padding: '22px 32px',
        background: 'linear-gradient(135deg, #6DD5FA 0%, #2980B9 100%)',
        borderRadius: '16px',
        marginTop: '24px',
        boxShadow: '0 4px 18px rgba(52,152,219,0.14)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        fontSize: '1.22rem',
        fontWeight: 700,
        border: 'none',
        position: 'relative',
        overflow: 'hidden',
        minWidth: 340,
      }}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        flex: 1,
        alignItems: 'flex-start',
      }}>
        <span style={{
          fontWeight: 900,
          fontSize: '1.22rem',
          letterSpacing: '.8px',
          textShadow: '0 1px 2px rgba(0,0,0,0.10)',
          background: 'rgba(255,255,255,0.10)',
          padding: '7px 13px',
          borderRadius: 8,
        }}>
          <span role="img" aria-label="chart" style={{marginRight:8}}>📊</span>
          Your Workout Stats
        </span>
        <span style={{
          color: '#ffe268',
          fontWeight: 800,
          fontSize: '1.1rem',
          textShadow: '0 1px 4px #297fb920'
        }}>
          <span role="img" aria-label="star" style={{marginRight:3}}>⭐</span>
          Points: {points}
        </span>
        <span style={{
          color: '#fd6262',
          fontWeight: 800,
          fontSize: '1.1rem',
          textShadow: '0 1px 4px #e9696920'
        }}>
          <span role="img" aria-label="flame" style={{marginRight:3}}>🔥</span>
          Current Streak: {streak} day{streak !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{
        position:'absolute',
        top:'16px', right:'22px', 
        opacity: 0.14,
        fontSize:'4.3rem',
        pointerEvents:'none',
        userSelect:'none'
      }}>💪</div>
    </div>
  );
}

export default UserStats;







