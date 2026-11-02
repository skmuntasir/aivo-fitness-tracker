import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from './Icon';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import API from "../services/api";
import { useFeedback } from './Feedback';
import { BadgeStrip } from './Badges';
import './LeaderboardPage.css';

const TABS = [
  { id: 'friends', label: 'Friends' },
  { id: 'global', label: 'Global' },
];

function Row({ user, extraClass = "", onSelect }) {
  const cls = [user.rank <= 3 ? `rank-${user.rank}` : "", user.is_me ? "is-me" : "", onSelect ? "lb-clickable" : "", extraClass]
    .filter(Boolean).join(" ");
  const open = () => onSelect && onSelect(user);
  return (
    <tr className={cls} onClick={open} tabIndex={onSelect ? 0 : undefined}
      role={onSelect ? "button" : undefined} aria-label={onSelect ? `View ${user.name}` : undefined}
      onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}>
      <td className="rank-cell"><span className="lb-rank">{user.rank <= 3 ? <Icon name="trophy" size={15} /> : null}{user.rank <= 3 ? "" : user.rank}</span></td>
      <td className="name-cell">
        <span className="lb-player"><Avatar name={user.name} size={34} showPresence={false} /><span className="lb-name">{user.name}</span>{user.is_me && <span className="lb-you">You</span>}</span>
      </td>
      <td className="points-cell">{user.points.toLocaleString()}</td>
      <td className="streak-cell"><Icon name="flame" size={15} /> {user.streak}d</td>
    </tr>
  );
}


const REL_LABEL = {
  friends: 'Friend',
  request_sent: 'Request sent',
  request_received: 'Wants to be your friend',
};

// Small profile sheet opened from a leaderboard row: friend actions live here.
function PlayerSheet({ user, onClose, onRelation }) {
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [badges, setBadges] = useState(null);   // earned badges of this player

  useEffect(() => {
    let alive = true;
    API.get(`/badges/user/${user.id}`).then((r) => { if (alive) setBadges(r.data.badges || []); }).catch(() => { if (alive) setBadges([]); });
    return () => { alive = false; };
  }, [user.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn, okMsg, nextRelation) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onRelation(user.id, nextRelation, null);
      if (okMsg) toast(okMsg, 'success');
    } catch (e) {
      toast(e?.response?.data?.message || 'Something went wrong. Please try again.', 'error');
    } finally { setBusy(false); }
  };

  const addFriend = () => run(() => API.post(`/friends/request/${user.id}`), `Friend request sent to ${user.name}.`, 'request_sent');
  const accept = () => run(() => API.put(`/friends/accept/${user.request_id}`), `You and ${user.name} are now friends.`, 'friends');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box lb-sheet" role="dialog" aria-label={`${user.name} profile`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <Avatar name={user.name} size={72} showPresence={false} />
        <h3 className="lb-sheet-name">{user.name}</h3>
        {user.is_me
          ? <span className="lb-you">You</span>
          : REL_LABEL[user.relation] && <span className={`lb-rel lb-rel-${user.relation}`}>{REL_LABEL[user.relation]}</span>}

        <div className="lb-sheet-stats">
          <div><strong>#{user.rank}</strong><span>Rank</span></div>
          <div><strong>{user.points.toLocaleString()}</strong><span>Points</span></div>
          <div><strong className="lb-heat"><Icon name="flame" size={15} /> {user.streak}d</strong><span>Streak</span></div>
        </div>

        <div className="lb-badges">
          <small>Badges{badges ? ` · ${badges.length}` : ''}</small>
          {badges === null ? <div className="sk" style={{ height: 30 }} />
            : badges.length ? <BadgeStrip badges={badges} max={6} />
            : <span className="lb-sheet-nobadge">No badges yet</span>}
        </div>

        <div className="lb-sheet-actions">
          {user.is_me && <Link to="/profile" className="btn btn-ghost" onClick={onClose}>View my profile</Link>}
          {!user.is_me && user.relation === 'none' && (
            <button type="button" className="btn btn-primary" onClick={addFriend} disabled={busy}>
              <Icon name="userPlus" size={17} /> {busy ? 'Sending…' : 'Add friend'}
            </button>
          )}
          {!user.is_me && user.relation === 'request_sent' && (
            <button type="button" className="btn btn-ghost" disabled><Icon name="clock" size={17} /> Request sent</button>
          )}
          {!user.is_me && user.relation === 'request_received' && (
            <button type="button" className="btn btn-primary" onClick={accept} disabled={busy}>
              <Icon name="check" size={17} /> {busy ? 'Accepting…' : 'Accept request'}
            </button>
          )}
          {!user.is_me && user.relation === 'friends' && (
            <button type="button" className="btn btn-primary" onClick={() => { onClose(); navigate(`/chat/${user.id}`); }}>
              <Icon name="message" size={17} /> Message
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LeaderboardTable({ scope }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const response = await API.get("/workouts/leaderboard", { params: { scope } });
      if (response.data.success) setData(response.data);
      else setError("Failed to load leaderboard");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="lb-table-card"><div className="lb-loading">Loading leaderboard…</div></div>;
  if (error) {
    return (
      <div className="lb-table-card">
        <div className="lb-error">{error}</div>
        <div className="lb-retry-wrap"><button type="button" className="lb-retry" onClick={load}>Try again</button></div>
      </div>
    );
  }

  const rows = data?.leaderboard || [];
  const me = data?.me;
  const all = me && !rows.some((r) => r.id === me.id) ? [...rows, me] : rows;
  const selected = all.find((r) => r.id === selectedId) || null;
  const updateRelation = (id, relation, request_id) => {
    setData((d) => d && ({
      ...d,
      leaderboard: d.leaderboard.map((r) => (r.id === id ? { ...r, relation, request_id } : r)),
    }));
  };
  const meInList = rows.some((r) => r.is_me);

  if (scope === 'friends' && (data?.friend_count ?? 0) === 0) {
    return (
      <div className="lb-table-card">
        <EmptyState
          icon="users"
          title="No friends to compete with yet"
          text="Add friends and they'll show up here, ranked against you."
          action={<Link to="/friends" className="lb-cta">Find friends</Link>}
        />
      </div>
    );
  }

  return (
    <>
      {scope === 'global' && me && (
        <div className="lb-me-card">
          <span className="lb-me-label">Your global rank</span>
          <span className="lb-me-rank">#{me.rank.toLocaleString()}</span>
          <span className="lb-me-meta">
            {me.points.toLocaleString()} pts
            {data.total_players ? ` · of ${data.total_players.toLocaleString()} players` : ""}
          </span>
        </div>
      )}
      <div className="lb-table-card">
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
            {rows.map((user) => <Row key={user.id || user.rank + user.name} user={user} onSelect={(u) => setSelectedId(u.id)} />)}
            {scope === 'global' && me && !meInList && (
              <>
                <tr className="lb-gap" aria-hidden="true"><td colSpan={4}>…</td></tr>
                <Row user={me} onSelect={(u) => setSelectedId(u.id)} />
              </>
            )}
          </tbody>
        </table>
      </div>
      {selected && <PlayerSheet user={selected} onClose={() => setSelectedId(null)} onRelation={updateRelation} />}
    </>
  );
}

const LeaderboardPage = () => {
  const [tab, setTab] = useState('friends');

  return (
    <div className="lb-page">
      <div className="lb-content">
        <header className="page-head lb-hero">
          <div>
            <h1>Leaderboard</h1>
            <p>Points come from completed workouts. Equal points share a rank.</p>
          </div>
        </header>

        <div className="lb-tabs" role="tablist" aria-label="Leaderboard type">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`lb-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <LeaderboardTable key={tab} scope={tab} />
      </div>
    </div>
  );
};

export default LeaderboardPage;
