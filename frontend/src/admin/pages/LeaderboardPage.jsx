import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import ADMIN, { errMsg } from '../adminApi';
import Icon from '../Icon';
import { Badge, Card, Empty, ErrorBox, Modal, PageHeader, Spinner, fmtDateTime, fmtNum, useConfirm, useFetch, useToast } from '../ui';

const medal = (r) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`);

export default function LeaderboardPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useFetch(() => ADMIN.get('/leaderboard', { params: { limit: 50 } }).then((r) => r.data), []);
  const [adj, setAdj] = useState(null);

  const reset = async () => {
    const r = await confirm({ title: 'Start a new season?', message: 'The current top 10 is archived, then EVERY member’s points are set to 0. This cannot be undone.', confirmLabel: 'Reset all points', tone: 'danger', typed: 'RESET' });
    if (!r) return;
    try { const { data: d } = await ADMIN.post('/leaderboard/reset', { confirm: 'RESET' }); toast(`Season reset — ${d.affected} members cleared`); reload(); }
    catch (e) { toast(errMsg(e), 'bad'); }
  };
  const apply = async (e) => {
    e.preventDefault();
    try { await ADMIN.post(`/users/${adj.id}/adjust-points`, { mode: adj.mode, value: adj.value, reason: adj.reason }); toast('Points updated'); setAdj(null); reload(); }
    catch (err) { toast(errMsg(err), 'bad'); }
  };

  return (
    <>
      <PageHeader title="Leaderboard" subtitle="Top 50 members by points · streaks are computed live from workout history">
        <button className="a-btn danger-ghost" onClick={reset}><Icon name="refresh" size={15} /> Start new season</button>
      </PageHeader>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <Card flush>
        {loading && !data ? <Spinner /> : !data?.leaderboard.length ? <Empty icon="award" title="No members yet" /> : (
          <table className="a-table">
            <thead><tr><th>Rank</th><th>Member</th><th className="num">Points</th><th className="num">Streak</th><th>Status</th><th /></tr></thead>
            <tbody>{data.leaderboard.map((u) => (
              <tr key={u.id}>
                <td style={{ fontSize: 18, width: 70 }}>{medal(u.rank)}</td>
                <td><Link to={`/admin/users/${u.id}`}><b>{u.name}</b></Link><br /><small className="a-muted">{u.email}</small></td>
                <td className="num"><b>{fmtNum(u.points)}</b></td><td className="num">{u.streak} d</td>
                <td>{u.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Suspended</Badge>}</td>
                <td><button className="a-btn sm ghost" onClick={() => setAdj({ id: u.id, name: u.name, mode: 'add', value: '', reason: '' })}>Adjust</button></td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
      {data?.seasons?.length > 0 && (
        <Card title="Past seasons">
          <div className="a-grid two">{data.seasons.map((s) => (
            <div key={s._id} className="a-quote">
              <b>Ended {fmtDateTime(s.ended_at)}</b> <span className="a-muted">by {s.ended_by} · {s.participants} participants</span>
              <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>{s.top.slice(0, 3).map((t, i) => <li key={i}>{t.name} — {fmtNum(t.points)} pts</li>)}</ol>
            </div>))}</div>
        </Card>
      )}
      <Modal open={!!adj} title={`Adjust points · ${adj?.name || ''}`} onClose={() => setAdj(null)}
        footer={<><button className="a-btn ghost" onClick={() => setAdj(null)}>Cancel</button><button className="a-btn primary" form="adj">Apply</button></>}>
        {adj && (
          <form id="adj" onSubmit={apply}>
            <label className="a-field"><span>Mode</span><select className="a-select" value={adj.mode} onChange={(e) => setAdj({ ...adj, mode: e.target.value })}><option value="add">Add / subtract</option><option value="set">Set exact balance</option></select></label>
            <label className="a-field"><span>Value</span><input className="a-input" type="number" required value={adj.value} onChange={(e) => setAdj({ ...adj, value: e.target.value })} /></label>
            <label className="a-field"><span>Reason</span><input className="a-input" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></label>
          </form>
        )}
      </Modal>
    </>
  );
}
