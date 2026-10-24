import React, { useEffect, useState } from "react";
import API from "../services/api";

function LeaderboardModal({ token, onClose }) {
  const [leaders, setLeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const response = await API.get("/workouts/leaderboard");
        const data = response.data;
        if (data.success) {
          setLeaders(data.leaderboard);
        } else {
          setError("Failed to load leaderboard");
        }
      } catch {
        setError("Network error");
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, [token]);

  return (
    <div
      style={{
        position: "fixed",
        top: "15%",
        left: "50%",
        transform: "translate(-50%, 0)",
        background: "#222",
        color: "#fff",
        minWidth: 350,
        maxWidth: 400,
        borderRadius: 14,
        boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
        zIndex: 10000,
        padding: 24
      }}
    >
      <h3 style={{ textAlign: "center", marginBottom: 18 }}>Leaderboard</h3>
      {loading && <div>Loading...</div>}
      {error && <div style={{ color: "#ff6b6b" }}>{error}</div>}
      <table style={{ width: "100%", background: "transparent", color: "#fff" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #444" }}>
            <th>#</th>
            <th>Name</th>
            <th>Points</th>
            <th>Streak</th>
          </tr>
        </thead>
        <tbody>
          {leaders.map(user => (
            <tr key={user.name + user.rank}>
              <td>{user.rank}</td>
              <td>{user.name}</td>
              <td>{user.points}</td>
              <td>{user.streak}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={onClose}
        style={{
          marginTop: 12,
          padding: "8px 16px",
          borderRadius: 8,
          background: "#444",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          width: "100%"
        }}
      >
        Close
      </button>
    </div>
  );
}

export default LeaderboardModal;
