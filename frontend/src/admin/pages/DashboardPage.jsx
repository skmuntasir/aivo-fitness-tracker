import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ADMIN from '../adminApi';
import { Avatar, Badge, Card, Empty, ErrorBox, PageHeader, Spinner, Stat, fmtDate, fmtNum, useFetch } from '../ui';
import Icon from '../Icon';

const COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];
const pct = (now, prev) => (prev ? Math.round(((now - prev) / prev) * 100) : now ? 100 : 0);
const tick = { fontSize: 11, fill: '#94a3b8' };
const tooltipStyle = { borderRadius: 10, border: '1px solid #e4e8f0', fontSize: 12 };
const shortDay = (d) => d.slice(5).replace('-', '/');

function Donut({ data }) {
  if (!data?.length) return <Empty icon="activity" title="No data yet" />;
  return (
    <div className="a-chart sm">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const overview = useFetch(() => ADMIN.get('/dashboard/overview').then((r) => r.data), []);
  const charts = useFetch(() => ADMIN.get('/dashboard/charts', { params: { days } }).then((r) => r.data), [days]);
  const health = useFetch(() => ADMIN.get('/system/health').then((r) => r.data.health), []);

  const reload = () => { overview.reload(); charts.reload(); health.reload(); };
  const k = overview.data?.kpi;
  const h = health.data;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Platform health and engagement at a glance">
        {h && (
          <>
            <Badge tone={h.database.ok ? 'good' : 'bad'}>DB {h.database.ok ? `${h.database.latency_ms} ms` : 'down'}</Badge>
          </>
        )}
        <select className="a-select" style={{ width: 'auto' }} value={days} onChange={(e) => setDays(+e.target.value)} aria-label="Date range">
          <option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select>
        <button className="a-btn ghost" onClick={reload}><Icon name="refresh" size={15} /> Refresh</button>
      </PageHeader>

      {overview.error && <ErrorBox message={overview.error} onRetry={overview.reload} />}
      {overview.loading && !k ? <Spinner /> : k && (
        <div className="a-grid stats">
          <Stat icon="users" label="Total members" value={fmtNum(k.total_users)} delta={pct(k.new_7d, k.new_prev_7d)} sub={`${k.new_7d} new this week`} onClick={() => navigate('/admin/users')} />
          <Stat icon="activity" tone="good" label="Active (24h / 7d)" value={`${fmtNum(k.active_24h)} / ${fmtNum(k.active_7d)}`} sub={`${fmtNum(k.online_now)} online now`} />
          <Stat icon="activity" tone="info" label="Workouts this week" value={fmtNum(k.workouts_7d)} delta={pct(k.workouts_7d, k.workouts_prev_7d)} sub={`${fmtNum(k.total_workouts)} total`} onClick={() => navigate('/admin/workouts')} />
          <Stat icon="award" tone="accent" label="Training time" value={`${fmtNum(k.training_hours)} h`} sub="across all members" />
          <Stat icon="file" tone="info" label="Posts this week" value={fmtNum(k.posts_7d)} sub={`${fmtNum(k.total_posts)} total`} onClick={() => navigate('/admin/posts')} />
          <Stat icon="flag" tone={k.open_reports ? 'warn' : 'good'} label="Open reports" value={fmtNum(k.open_reports)} sub={k.hidden_posts ? `${k.hidden_posts} hidden posts` : 'Queue is clear'} onClick={() => navigate('/admin/posts')} />
          <Stat icon="lock" tone={k.suspended_users ? 'bad' : 'good'} label="Suspended members" value={fmtNum(k.suspended_users)} sub={`${k.admins} admin${k.admins === 1 ? '' : 's'} · ${k.moderators} moderator${k.moderators === 1 ? '' : 's'}`} />
        </div>
      )}

      {charts.error && <ErrorBox message={charts.error} onRetry={charts.reload} />}
      {charts.loading && !charts.data ? <Spinner /> : charts.data && (
        <>
          <div className="a-grid charts">
            <Card title="Workouts & active members" subtitle="Daily (UTC)">
              <div className="a-chart">
                <ResponsiveContainer>
                  <AreaChart data={charts.data.series}>
                    <defs>
                      <linearGradient id="gw" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient>
                      <linearGradient id="gu" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} /><stop offset="100%" stopColor="#06b6d4" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b822" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={shortDay} tick={tick} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis tick={tick} allowDecimals={false} width={32} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtDate(l)} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="workouts" name="Workouts" stroke="#6366f1" fill="url(#gw)" strokeWidth={2} />
                    <Area type="monotone" dataKey="active_users" name="Active members" stroke="#06b6d4" fill="url(#gu)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="New signups" subtitle="Per day">
              <div className="a-chart">
                <ResponsiveContainer>
                  <BarChart data={charts.data.series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b822" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={shortDay} tick={tick} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis tick={tick} allowDecimals={false} width={28} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtDate(l)} />
                    <Bar dataKey="signups" name="Signups" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="a-grid stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <Card title="Fitness goals"><Donut data={charts.data.goals} /></Card>
            <Card title="Experience level"><Donut data={charts.data.levels} /></Card>
            <Card title="Gender"><Donut data={charts.data.genders} /></Card>
            <Card title={`Activities (${days}d)`}><Donut data={charts.data.activities} /></Card>
          </div>
        </>
      )}

      {k && (
        <div className="a-grid two">
          <Card title="Recent signups" flush actions={<Link to="/admin/users">View all</Link>}>
            {overview.data.recent_signups.length === 0 ? <Empty icon="users" title="No members yet" /> : (
              <table className="a-table"><tbody>
                {overview.data.recent_signups.map((u) => (
                  <tr key={u.id}>
                    <td><Link to={`/admin/users/${u.id}`} className="a-user-cell"><Avatar name={u.full_name} /><span><b>{u.full_name}</b><small>{u.email}</small></span></Link></td>
                    <td className="a-muted">{fmtDate(u.created_at)}</td>
                    <td>{!u.is_active && <Badge tone="bad">Suspended</Badge>}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Card>
          <Card title="Top members by points" flush actions={<Link to="/admin/leaderboard">Leaderboard</Link>}>
            {overview.data.top_users.length === 0 ? <Empty icon="award" title="No points earned yet" /> : (
              <table className="a-table"><tbody>
                {overview.data.top_users.map((u, i) => (
                  <tr key={u.id}>
                    <td style={{ width: 36 }} className="a-muted">#{i + 1}</td>
                    <td><Link to={`/admin/users/${u.id}`} className="a-user-cell"><Avatar name={u.full_name} /><span><b>{u.full_name}</b><small>{u.email}</small></span></Link></td>
                    <td className="num"><b>{fmtNum(u.points)}</b> <span className="a-muted">pts</span></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
