import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ADMIN, { errMsg } from '../adminApi';
import { useAdmin } from '../adminContext';
import Icon from '../Icon';
import { Avatar, Badge, Card, Empty, ErrorBox, Modal, Spinner, Stat, fmtDate, fmtDateTime, fmtDur, fmtNum, timeAgo, useConfirm, useFetch, useToast } from '../ui';

const FIELDS = [
  ['full_name', 'Full name', 'text'], ['username', 'Username', 'text'], ['email', 'Email', 'email'],
  ['age', 'Age', 'number'], ['gender', 'Gender', 'text'], ['fitness_level', 'Fitness level', 'text'],
  ['weight', 'Weight', 'number'], ['height', 'Height (cm)', 'number'], ['target_weight', 'Target weight', 'number'],
  ['points', 'Points', 'number'],
];

export default function UserDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { admin } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useFetch(() => ADMIN.get(`/users/${id}`).then((r) => r.data), [id]);
  const [edit, setEdit] = useState(null);
  const [points, setPoints] = useState(null);
  const [tempPw, setTempPw] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mail, setMail] = useState(null);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  const { user: u, stats, recent_workouts: workouts, recent_posts: posts, activity, weight_history: weights } = data;
  const isMe = admin?.id === u.id;
  const canManage = admin?.role === 'admin';   // moderators: read-only

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) toast(okMsg); await reload(); return r; }
    catch (e) { toast(errMsg(e), 'bad'); } finally { setBusy(false); }
  };

  const suspend = async () => {
    const r = await confirm({ title: `Suspend ${u.full_name}?`, message: 'They are signed out immediately and cannot log in until reactivated. Their posts stay visible unless you hide them.', confirmLabel: 'Suspend', tone: 'danger', input: { label: 'Reason (kept in the audit log)', placeholder: 'e.g. Repeated spam' } });
    if (r) act(() => ADMIN.post(`/users/${id}/suspend`, { reason: r.value }), 'Member suspended');
  };
  const reactivate = () => act(() => ADMIN.post(`/users/${id}/reactivate`), 'Member reactivated');
  const changeRole = async (role) => {
    if (role === u.role) return;
    const label = { admin: 'an admin (full access to this console)', moderator: 'a moderator (posts, reports and read-only member view)', user: 'a regular member (no console access)' }[role];
    if (await confirm({ title: `Make ${u.full_name} ${label}?`, confirmLabel: 'Change role', tone: role === 'user' ? 'danger' : undefined }))
      act(() => ADMIN.post(`/users/${id}/role`, { role }), 'Role updated');
  };
  const sendMail = async (e) => {
    e.preventDefault();
    await act(() => ADMIN.post(`/users/${id}/email`, mail), 'Email sent');
    setMail(null);
  };
  const forceLogout = async () => {
    if (await confirm({ title: 'Sign this member out everywhere?', message: 'All of their active sessions end immediately. They can sign in again.', confirmLabel: 'Force logout' }))
      act(() => ADMIN.post(`/users/${id}/force-logout`), 'Sessions ended');
  };
  const resetPassword = async () => {
    if (!(await confirm({ title: 'Reset password?', message: 'A temporary password is generated and shown once. Their current sessions end.', confirmLabel: 'Reset password' }))) return;
    const r = await act(() => ADMIN.post(`/users/${id}/reset-password`, {}));
    if (r) setTempPw(r.data.temp_password);
  };
  const remove = async () => {
    if (!(await confirm({ title: `Permanently delete ${u.full_name}?`, message: 'Removes their profile, workouts, posts, messages and friendships. This cannot be undone.', confirmLabel: 'Delete forever', tone: 'danger', typed: 'DELETE' }))) return;
    try { await ADMIN.delete(`/users/${id}`); toast('Member deleted'); navigate('/admin/users'); } catch (e) { toast(errMsg(e), 'bad'); }
  };
  const openEdit = () => setEdit({ ...Object.fromEntries(FIELDS.map(([k]) => [k, u[k] ?? ''])), fitness_goals: (u.fitness_goals || []).join(', ') });
  const saveEdit = async (e) => {
    e.preventDefault();
    const body = { ...edit, fitness_goals: edit.fitness_goals.split(',').map((s) => s.trim()).filter(Boolean) };
    await act(() => ADMIN.put(`/users/${id}`, body), 'Profile saved');
    setEdit(null);
  };
  const savePoints = async (e) => {
    e.preventDefault();
    await act(() => ADMIN.post(`/users/${id}/adjust-points`, points), 'Points updated');
    setPoints(null);
  };

  return (
    <>
      <Link to="/admin/users" className="a-muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="left" size={14} /> All users</Link>
      <div className="a-page-head">
        <div className="a-row" style={{ gap: 16 }}>
          <Avatar name={u.full_name} size={64} />
          <div>
            <h1>{u.full_name}</h1>
            <p className="a-muted">{u.email} · @{u.username}</p>
            <div className="a-row wrap" style={{ marginTop: 6 }}>
              {u.is_admin && <Badge tone="accent">Admin</Badge>}{u.is_moderator && <Badge tone="info">Moderator</Badge>}
              {u.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Suspended</Badge>}
              {isMe && <Badge>You</Badge>}
            </div>
          </div>
        </div>
        {canManage && (
          <div className="a-row wrap">
            <button className="a-btn ghost" onClick={openEdit}><Icon name="edit" size={15} /> Edit</button>
            <button className="a-btn ghost" onClick={() => setMail({ subject: '', message: '' })}><Icon name="bell" size={15} /> Email</button>
            <button className="a-btn ghost" onClick={() => setPoints({ mode: 'add', value: '', reason: '' })}><Icon name="award" size={15} /> Points</button>
            <button className="a-btn ghost" onClick={resetPassword} disabled={busy}><Icon name="lock" size={15} /> Reset password</button>
            <button className="a-btn ghost" onClick={forceLogout} disabled={busy}><Icon name="logout" size={15} /> Force logout</button>
          </div>
        )}
      </div>

      {!u.is_active && (
        <div className="a-error"><span><b>Suspended</b>{u.suspended_by ? ` by ${u.suspended_by}` : ''}{u.suspended_at ? ` on ${fmtDateTime(u.suspended_at)}` : ''}{u.suspended_reason ? ` — “${u.suspended_reason}”` : ''}</span>
          {canManage && <button className="a-btn sm ghost" onClick={reactivate} disabled={busy}>Reactivate</button>}</div>
      )}

      <div className="a-grid stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <Stat icon="activity" label="Workouts" value={fmtNum(stats.workouts)} sub={`${fmtNum(stats.minutes)} min trained`} />
        <Stat icon="award" tone="good" label="Points · streak" value={`${fmtNum(u.points || 0)} · ${u.streak}d`} />
        <Stat icon="users" tone="info" label="Friends" value={fmtNum(stats.friends)} sub={`${fmtNum(stats.messages_sent)} messages sent`} />
        <Stat icon="file" tone="accent" label="Posts" value={fmtNum(stats.posts)} />
      </div>

      <div className="a-grid two">
        <Card title="Profile">
          <dl className="a-dl">
            <dt>Joined</dt><dd>{fmtDateTime(u.created_at)}</dd>
            <dt>Last active</dt><dd>{timeAgo(u.last_active)}</dd>
            <dt>Age / gender</dt><dd>{u.age ?? '—'} / {u.gender || '—'}</dd>
            <dt>Level</dt><dd>{u.fitness_level || '—'}</dd>
            <dt>Goals</dt><dd>{(u.fitness_goals || []).join(', ') || '—'}</dd>
            <dt>Weight</dt><dd>{u.weight ?? '—'} → {u.target_weight ?? '—'} (target) · height {u.height ?? '—'}</dd>
            <dt>Units</dt><dd>{u.preferred_units || 'metric'}</dd>
            <dt>Medical notes</dt><dd>{u.medical_conditions || '—'}</dd>
            <dt>User ID</dt><dd className="a-mono">{u.id}</dd>
          </dl>
        </Card>
        <Card title="Weight history">
          {weights.length < 2 ? <Empty icon="activity" title="Not enough data">The chart appears after the member logs two or more weights.</Empty> : (
            <div className="a-chart sm"><ResponsiveContainer><LineChart data={weights}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b822" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(d) => d.slice(5)} />
              <YAxis domain={['dataMin - 2', 'dataMax + 2']} tick={{ fontSize: 11, fill: '#94a3b8' }} width={34} />
              <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
              <Line type="monotone" dataKey="weight" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart></ResponsiveContainer></div>
          )}
        </Card>
      </div>

      <div className="a-grid two">
        <Card title="Recent workouts" flush actions={<Link to={`/admin/workouts?user=${u.id}`}>All workouts</Link>}>
          {workouts.length === 0 ? <Empty icon="activity" title="No workouts yet" /> : (
            <table className="a-table"><tbody>{workouts.map((w) => (
              <tr key={w.id}><td><b>{w.activity_type || 'Unspecified'}</b></td><td>{fmtDur(w.duration)}</td><td className="a-muted">{fmtDateTime(w.start_time)}</td></tr>
            ))}</tbody></table>
          )}
        </Card>
        <Card title="Recent posts" flush>
          {posts.length === 0 ? <Empty icon="file" title="No posts" /> : (
            <div className="a-list">{posts.map((p) => (
              <div className="a-item" key={p.id}>
                <div className="a-item-main"><span>{p.content || <i className="a-muted">(photo only)</i>}</span>
                  <span className="a-muted">{fmtDate(p.created_at)} · {p.likes} likes · {p.comments} comments</span></div>
                {p.hidden && <Badge tone="warn">Hidden</Badge>}
              </div>))}</div>
          )}
        </Card>
      </div>

      <Card title="Admin activity on this member" flush>
        {activity.length === 0 ? <Empty icon="file" title="No admin actions recorded" /> : (
          <table className="a-table"><tbody>{activity.map((a) => (
            <tr key={a.id || a._id}><td><Badge tone="accent">{a.action}</Badge></td><td>{a.actor_name || a.actor_email}</td><td className="a-muted">{fmtDateTime(a.ts)}</td>
              <td className="a-kv">{a.details && Object.keys(a.details).length ? JSON.stringify(a.details) : ''}</td></tr>
          ))}</tbody></table>
        )}
      </Card>

      {canManage && (
        <Card title="Danger zone">
          <div className="a-setting"><div><b>{u.is_active ? 'Suspend account' : 'Account is suspended'}</b><span className="a-muted">Blocks sign-in and API access immediately.</span></div>
            {u.is_active ? <button className="a-btn danger-ghost" onClick={suspend} disabled={isMe || busy}>Suspend</button> : <button className="a-btn ghost" onClick={reactivate} disabled={busy}>Reactivate</button>}</div>
          <div className="a-setting"><div><b>Role</b><span className="a-muted">{isMe ? 'You cannot change your own role.' : 'Moderators can handle posts and reports. Admins can do everything.'}</span></div>
            <select className="a-select" style={{ width: 170 }} value={u.role} disabled={isMe || busy} onChange={(e) => changeRole(e.target.value)} aria-label="Role">
              <option value="user">Regular member</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select></div>
          <div className="a-setting"><div><b>Delete account</b><span className="a-muted">Permanently removes the member and all of their data.</span></div>
            <button className="a-btn danger" onClick={remove} disabled={isMe || busy}><Icon name="trash" size={15} /> Delete</button></div>
        </Card>
      )}

      <Modal open={!!edit} wide title="Edit member" onClose={() => setEdit(null)}
        footer={<><button className="a-btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="a-btn primary" form="edit-user" disabled={busy}>Save changes</button></>}>
        {edit && (
          <form id="edit-user" onSubmit={saveEdit}>
            <div className="a-form-grid">
              {FIELDS.map(([k, label, type]) => (
                <label className="a-field" key={k}><span>{label}</span>
                  <input className="a-input" type={type} step="any" value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>
              ))}
            </div>
            <label className="a-field"><span>Fitness goals (comma separated)</span><input className="a-input" value={edit.fitness_goals} onChange={(e) => setEdit({ ...edit, fitness_goals: e.target.value })} /></label>
          </form>
        )}
      </Modal>

      <Modal open={!!points} title="Adjust points" onClose={() => setPoints(null)}
        footer={<><button className="a-btn ghost" onClick={() => setPoints(null)}>Cancel</button><button className="a-btn primary" form="pts" disabled={busy}>Apply</button></>}>
        {points && (
          <form id="pts" onSubmit={savePoints}>
            <p className="a-muted" style={{ marginBottom: 14 }}>Current balance: <b>{fmtNum(u.points || 0)}</b></p>
            <label className="a-field"><span>Mode</span>
              <select className="a-select" value={points.mode} onChange={(e) => setPoints({ ...points, mode: e.target.value })}>
                <option value="add">Add / subtract (use a negative number to subtract)</option><option value="set">Set exact balance</option></select></label>
            <label className="a-field"><span>Value</span><input className="a-input" type="number" required value={points.value} onChange={(e) => setPoints({ ...points, value: e.target.value })} /></label>
            <label className="a-field"><span>Reason</span><input className="a-input" value={points.reason} onChange={(e) => setPoints({ ...points, reason: e.target.value })} placeholder="Shown in the audit log" /></label>
          </form>
        )}
      </Modal>

      <Modal open={!!mail} title={`Email ${u.full_name}`} onClose={() => setMail(null)}
        footer={<><button className="a-btn ghost" onClick={() => setMail(null)}>Cancel</button><button className="a-btn primary" form="mail" disabled={busy}>{busy ? 'Sending…' : 'Send email'}</button></>}>
        {mail && (
          <form id="mail" onSubmit={sendMail}>
            <p className="a-muted" style={{ marginTop: 0 }}>To: {u.email}. Requires SMTP to be configured on the server.</p>
            <label className="a-field"><span>Subject</span><input className="a-input" required maxLength={150} value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></label>
            <label className="a-field"><span>Message</span><textarea className="a-textarea" rows={6} required maxLength={5000} value={mail.message} onChange={(e) => setMail({ ...mail, message: e.target.value })} /></label>
          </form>
        )}
      </Modal>

      <Modal open={!!tempPw} title="Temporary password" onClose={() => setTempPw(null)}
        footer={<button className="a-btn primary" onClick={() => setTempPw(null)}>Done</button>}>
        <p className="a-muted" style={{ marginTop: 0 }}>Share this securely. It is shown only once and is not stored in readable form.</p>
        <div className="a-code"><span>{tempPw}</span>
          <button className="a-btn sm ghost" onClick={() => navigator.clipboard?.writeText(tempPw).then(() => toast('Copied'))}>Copy</button></div>
      </Modal>
    </>
  );
}
