import React, { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ADMIN, { downloadFile, errMsg } from '../adminApi';
import Icon from '../Icon';
import { Badge, Card, Empty, ErrorBox, PageHeader, Pagination, Spinner, Stat, fmtDateTime, fmtDur, fmtNum, useConfirm, useDebounce, useFetch, useToast } from '../ui';

export default function WorkoutsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const userId = sp.get('user') || '';
  const [f, setF] = useState({ q: '', activity: '', from: '', to: '', flagged: false, page: 1 });
  const dq = useDebounce(f.q);
  const set = (patch) => setF((s) => ({ ...s, page: 1, ...patch }));

  const params = useMemo(() => ({ q: dq || undefined, user_id: userId || undefined, activity: f.activity || undefined, from: f.from || undefined, to: f.to || undefined, flagged: f.flagged ? '1' : undefined, page: f.page, limit: 20 }),
    [dq, userId, f.activity, f.from, f.to, f.flagged, f.page]);
  const stats = useFetch(() => ADMIN.get('/workouts/stats').then((r) => r.data), []);
  const list = useFetch(() => ADMIN.get('/workouts', { params }).then((r) => r.data), [params]);

  const remove = async (w) => {
    const r = await confirm({ title: 'Delete this workout?', message: `${w.user_name}'s ${w.activity_type} session (${fmtDur(w.duration)}) will be removed and their streak recalculated. About ${Math.floor(w.duration / 5)} points will be deducted.`, confirmLabel: 'Delete workout', tone: 'danger' });
    if (!r) return;
    try { const { data } = await ADMIN.delete(`/workouts/${w.id}`, { data: { deduct_points: true } }); toast(`Workout deleted (${data.points_removed} points removed)`); list.reload(); stats.reload(); }
    catch (e) { toast(errMsg(e), 'bad'); }
  };
  const exportCsv = async () => { try { const { page, limit, ...rest } = params; await downloadFile('/workouts/export', rest, 'aivo_workouts.csv'); } catch (e) { toast(errMsg(e), 'bad'); } };

  const s = stats.data;
  const rows = list.data?.workouts || [];
  return (
    <>
      <PageHeader title="Workouts" subtitle="Every logged session, with automatic flags for suspicious entries">
        <button className="a-btn ghost" onClick={exportCsv}><Icon name="download" size={15} /> Export CSV</button>
      </PageHeader>

      {s && (
        <div className="a-grid stats">
          <Stat icon="activity" label="Total sessions" value={fmtNum(s.total)} />
          <Stat icon="award" tone="good" label="Training hours" value={fmtNum(s.hours)} />
          <Stat icon="refresh" tone="info" label="Average session" value={`${s.avg_minutes} min`} />
          <Stat icon="flag" tone={s.flagged ? 'warn' : 'good'} label="Flagged sessions" value={fmtNum(s.flagged)} sub="over 4h or under 1 min" onClick={() => set({ flagged: true })} />
        </div>
      )}
      {s?.by_activity?.length > 0 && (
        <Card title="Sessions by activity">
          <div className="a-chart sm"><ResponsiveContainer><BarChart data={s.by_activity}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b822" vertical={false} />
            <XAxis dataKey="activity" tick={{ fontSize: 11, fill: '#94a3b8' }} /><YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} width={32} />
            <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Bar dataKey="count" name="Sessions" fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart></ResponsiveContainer></div>
        </Card>
      )}

      <Card flush>
        <div className="a-filters">
          <div className="a-search"><Icon name="search" size={16} />
            <input className="a-input" placeholder="Search member name or email…" value={f.q} onChange={(e) => set({ q: e.target.value })} /></div>
          <select className="a-select" value={f.activity} onChange={(e) => set({ activity: e.target.value })} aria-label="Activity">
            <option value="">All activities</option>{(s?.activities || []).map((a) => <option key={a}>{a}</option>)}</select>
          <input className="a-input sm" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label="From date" />
          <input className="a-input sm" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label="To date" />
          <label className="a-check"><input type="checkbox" checked={f.flagged} onChange={(e) => set({ flagged: e.target.checked })} /> Flagged only</label>
          {userId && <button className="a-btn sm ghost" onClick={() => setSp({})}>Filtering one member <Icon name="x" size={13} /></button>}
        </div>
        {list.error && <div style={{ padding: 16 }}><ErrorBox message={list.error} onRetry={list.reload} /></div>}
        {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? <Empty icon="activity" title="No workouts found" /> : (
          <table className="a-table" style={{ opacity: list.loading ? 0.6 : 1 }}>
            <thead><tr><th>Member</th><th>Activity</th><th>Started</th><th className="num">Duration</th><th>Flag</th><th /></tr></thead>
            <tbody>{rows.map((w) => (
              <tr key={w.id}>
                <td>{w.user_id ? <Link to={`/admin/users/${w.user_id}`}><b>{w.user_name}</b></Link> : w.user_name}<br /><small className="a-muted">{w.user_email}</small></td>
                <td>{w.activity_type}</td><td className="a-muted">{fmtDateTime(w.start_time)}</td>
                <td className="num">{fmtDur(w.duration)}</td>
                <td>{w.flag ? <Badge tone="warn">{w.flag}</Badge> : <span className="a-muted">—</span>}</td>
                <td><button className="a-icon-btn" title="Delete workout" aria-label="Delete workout" onClick={() => remove(w)}><Icon name="trash" size={16} /></button></td>
              </tr>))}</tbody>
          </table>
        )}
        <Pagination meta={list.data} onPage={(page) => setF((x) => ({ ...x, page }))} />
      </Card>
    </>
  );
}
