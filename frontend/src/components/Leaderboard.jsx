import React, { useEffect, useState } from "react";
import API from "../services/api";

function Leaderboard({ token }) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const response = await API.get("/workouts/leaderboard");
        const data = response.data;
        if (data.success) {
          setLeaderboard(data.leaderboard);
        } else {
          setError("Failed to load leaderboard");
        }
      } catch {
        setError("Network error");
      }
    }
    fetchLeaderboard();
  }, [token]);

  if (error) return <div style={{ color: "red" }}>{error}</div>;

  return (
    <div style={{ maxWidth: 400, margin: "auto" }}>
      <h3>Leaderboard</h3>
      <ul>
        {leaderboard.map((user, i) => (
          <li key={user.email}>
            {i + 1}. {user.email} — {user.points} points
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Leaderboard;
