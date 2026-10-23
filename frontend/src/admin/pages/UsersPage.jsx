import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ADMIN, { downloadFile, errMsg } from '../adminApi';
import { useAdmin } from '../adminContext';
import Icon from '../Icon';
import { Avatar, Badge, Card, Empty, ErrorBox, Modal, PageHeader, Pagination, Spinner, fmtDate, fmtNum, timeAgo, useConfirm, useDebounce, useFetch, useToast } from '../ui';

const EMPTY_FORM = { full_name: '', email: '', password: '', is_admin: false };

export default function UsersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { admin } = useAdmin();
  const canManage = admin?.role === 'admin';   // moderators get a read-only view (the API enforces this too)
  const [f, setF] = useState({ q: '', status: '', role: '', level: '', joined: '', inactive: '', sort: 'created_at', order: 'desc', page: 1 });
  const [selected, setSelected] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const dq = useDebounce(f.q);

  const params = useMemo(() => ({ q: dq || undefined, status: f.status || undefined, role: f.role || undefined, level: f.level || undefined, joined_within: f.joined || undefined, inactive_days: f.inactive || undefined, sort: f.sort, order: f.order, page: f.page, limit: 20 }),
    [dq, f.status, f.role, f.level, f.joined, f.inactive, f.sort, f.order, f.page]);
  const { data, loading, error, reload } = useFetch(() => ADMIN.get('/users', { params }).then((r) => r.data), [params]);
  useEffect(() => { setSelected(new Set()); }, [params]);

  const set = (patch) => setF((s) => ({ ...s, page: 1, ...patch }));
  const sortBy = (field) => set({ sort: field, order: f.sort === field && f.order === 'desc' ? 'asc' : 'desc' });
  const arrow = (field) => (f.sort === field ? (f.order === 'asc' ? ' ↑' : ' ↓') : '');
  const QUICK = [
    { id: 'all', label: 'Everyone', patch: { status: '', role: '', joined: '', inactive: '' } },
    { id: 'new', label: 'Joined this week', patch: { status: '', role: '', joined: '7', inactive: '' } },
    { id: 'dormant', label: 'Inactive 30+ days', patch: { status: '', role: '', joined: '', inactive: '30' } },
    { id: 'suspended', label: 'Suspended', patch: { status: 'suspended', role: '', joined: '', inactive: '' } },
    { id: 'team', label: 'Admins & moderators', patch: { status: '', role: 'staff', joined: '', inactive: '' } },
  ];
  const quickActive = QUICK.find((q) => (q.patch.joined === f.joined && q.patch.inactive === f.inactive && q.patch.status === f.status && q.patch.role === f.role))?.id;
  const users = data?.users || [];
  const allSelected = users.length > 0 && users.every((u) => selected.has(u.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulk = async (action) => {
    const ids = [...selected];
    const cfg = {
      suspend: { title: `Suspend ${ids.length} member(s)?`, message: 'They will be signed out immediately and cannot log in until reactivated.', confirmLabel: 'Suspend', tone: 'danger', input: { label: 'Reason (shown in the audit log)', placeholder: 'e.g. Spam / abusive behaviour', required: false } },
      reactivate: { title: `Reactivate ${ids.length} member(s)?`, confirmLabel: 'Reactivate' },
      delete: { title: `Permanently delete ${ids.length} member(s)?`, message: 'This removes their profile, workouts, posts, messages and friendships. It cannot be undone.', confirmLabel: 'Delete forever', tone: 'danger', typed: 'DELETE' },
    }[action];
    const res = await confirm(cfg);
    if (!res) return;
    try {
      const { data: d } = await ADMIN.post('/users/bulk', { ids, action, reason: res.value });
      toast(`${d.done} updated${d.skipped.length ? `, ${d.skipped.length} skipped (${d.skipped[0].reason})` : ''}`, d.skipped.length ? 'warn' : 'good');
      setSelected(new Set()); reload();
    } catch (e) { toast(errMsg(e), 'bad'); }
  };

  const exportCsv = async () => {
    try { const { page, limit, ...rest } = params; await downloadFile('/users/export', rest, 'aivo_users.csv'); }
    catch (e) { toast(errMsg(e), 'bad'); }
  };

  const create = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await ADMIN.post('/users', form);
      toast('User created'); setAdding(false); setForm(EMPTY_FORM); reload();
    } catch (err) { toast(errMsg(err), 'bad'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Users" subtitle="Search, review and manage every member account">
        {canManage && <button className="a-btn ghost" onClick={exportCsv}><Icon name="download" size={15} /> Export CSV</button>}
        {canManage && <button className="a-btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add user</button>}
      </PageHeader>

      <Card flush>
        <div className="a-filters" style={{ paddingBottom: 0, borderBottom: 0 }}>
          {QUICK.map((q) => <button key={q.id} className={`a-btn sm ${quickActive === q.id ? 'primary' : 'ghost'}`} onClick={() => set(q.patch)}>{q.label}</button>)}
        </div>
        <div className="a-filters">
          <div className="a-search"><Icon name="search" size={16} />
            <input className="a-input" placeholder="Search name, email or username…" value={f.q} onChange={(e) => set({ q: e.target.value })} /></div>
          <select className="a-select" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status"><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
          <select className="a-select" value={f.role} onChange={(e) => set({ role: e.target.value })} aria-label="Role"><option value="">All roles</option><option value="admin">Admins</option><option value="moderator">Moderators</option><option value="staff">Admins & moderators</option><option value="user">Regular members</option></select>
          <select className="a-select" value={f.level} onChange={(e) => set({ level: e.target.value })} aria-label="Level"><option value="">All levels</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select>
        </div>
        {canManage && selected.size > 0 && (
          <div className="a-bulkbar">
            <span>{selected.size} selected</span>
            <button className="a-btn sm ghost" onClick={() => bulk('reactivate')}>Reactivate</button>
            <button className="a-btn sm danger-ghost" onClick={() => bulk('suspend')}>Suspend</button>
            <button className="a-btn sm danger" onClick={() => bulk('delete')}><Icon name="trash" size={14} /> Delete</button>
            <button className="a-btn sm ghost" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
        {error && <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={reload} /></div>}
        {loading && !data ? <Spinner /> : users.length === 0 ? <Empty icon="users" title="No members match your filters">Try clearing a filter or searching for something else.</Empty> : (
          <table className="a-table" style={{ opacity: loading ? 0.6 : 1 }}>
            <thead><tr>
              {canManage && <th style={{ width: 36 }}><input type="checkbox" className="a-check" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(users.map((u) => u.id)))} /></th>}
              <th className="sortable" onClick={() => sortBy('full_name')}>Member{arrow('full_name')}</th>
              <th>Level</th><th className="num">Workouts</th>
              <th className="sortable num" onClick={() => sortBy('points')}>Points{arrow('points')}</th>
              <th className="sortable" onClick={() => sortBy('created_at')}>Joined{arrow('created_at')}</th>
              <th className="sortable" onClick={() => sortBy('last_active')}>Last active{arrow('last_active')}</th>
              <th>Status</th><th />
            </tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  {canManage && <td><input type="checkbox" aria-label={`Select ${u.full_name}`} checked={selected.has(u.id)} onChange={() => toggle(u.id)} /></td>}
                  <td><Link to={`/admin/users/${u.id}`} className="a-user-cell"><Avatar name={u.full_name} /><span><b>{u.full_name}</b><small>{u.email}</small></span></Link></td>
                  <td>{u.fitness_level || <span className="a-muted">—</span>}</td>
                  <td className="num">{fmtNum(u.workouts)}</td>
                  <td className="num">{fmtNum(u.points)}</td>
                  <td className="a-muted">{fmtDate(u.created_at)}</td>
                  <td className="a-muted">{timeAgo(u.last_active)}</td>
                  <td><div className="a-row wrap">{u.is_admin && <Badge tone="accent">Admin</Badge>}{u.is_moderator && <Badge tone="info">Moderator</Badge>}{u.is_active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Suspended</Badge>}</div></td>
                  <td><Link className="a-btn sm ghost" to={`/admin/users/${u.id}`}>Manage</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination meta={data} onPage={(page) => setF((s) => ({ ...s, page }))} />
      </Card>

      <Modal open={adding} title="Add user" onClose={() => setAdding(false)}
        footer={<><button className="a-btn ghost" onClick={() => setAdding(false)}>Cancel</button><button className="a-btn primary" form="add-user" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button></>}>
        <form id="add-user" onSubmit={create}>
          <label className="a-field"><span>Full name</span><input className="a-input" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
          <label className="a-field"><span>Email</span><input className="a-input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="a-field"><span>Temporary password</span><input className="a-input" type="text" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="8+ chars, upper, lower & a number" /></label>
          <label className="a-check"><input type="checkbox" checked={form.is_admin} onChange={(e) => setForm({ ...form, is_admin: e.target.checked })} /> Grant admin access</label>
        </form>
      </Modal>
    </>
  );
}
