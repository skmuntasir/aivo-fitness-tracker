import React, { useEffect, useState } from "react";
import BackButton from './BackButton';
import API from "../services/api";
import './LeaderboardPage.css';

function LeaderboardTable({ token }) {
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

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="lb-table-card">
      {loading && <div className="lb-loading">Loading leaderboard…</div>}
      {error && <div className="lb-error">{error}</div>}
      {!loading && !error && (
        <table className="lb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>Points</th>
              <th>Streak</th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((user) => (
              <tr key={user.rank + user.name} className={user.rank <= 3 ? `rank-${user.rank}` : ""}>
                <td className="rank-cell">
                  {user.rank <= 3 ? medals[user.rank - 1] : user.rank}
                </td>
                <td className="name-cell">{user.name}</td>
                <td className="points-cell">{user.points.toLocaleString()}</td>
                <td className="streak-cell">🔥 {user.streak}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const LeaderboardPage = () => {
  const token = localStorage.getItem('token');

  return (
    <div className="lb-page">
      <BackButton />
      <div className="lb-content">
        <header className="lb-hero">
          <span className="lb-chip">Rankings</span>
          <h1>🏆 Leaderboard</h1>
          <p>See who's crushing their fitness goals. Points are earned by completing workouts.</p>
        </header>
        <LeaderboardTable token={token} />
      </div>
    </div>
  );
};

export default LeaderboardPage;
