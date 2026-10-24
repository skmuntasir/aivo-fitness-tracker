import React, { useState } from 'react';
import ADMIN, { errMsg } from '../adminApi';
import Icon from '../Icon';
import { Badge, Card, Empty, ErrorBox, Modal, PageHeader, Spinner, Switch, fmtDateTime, useConfirm, useFetch, useToast } from '../ui';

const TYPES = ['info', 'success', 'warning', 'critical'];
const STATE_TONE = { live: 'good', scheduled: 'info', expired: 'neutral', inactive: 'neutral' };
const EMPTY = { title: '', body: '', type: 'info', active: true, starts_at: '', ends_at: '' };
// <input type="datetime-local"> works in local time; the API wants ISO/UTC.
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(/Z$/.test(iso) ? iso : iso + 'Z'); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toIso = (v) => (v ? new Date(v).toISOString() : null);

export default function AnnouncementsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useFetch(() => ADMIN.get('/announcements').then((r) => r.data.announcements), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const body = { title: form.title, body: form.body, type: form.type, active: form.active, starts_at: toIso(form.starts_at), ends_at: toIso(form.ends_at) };
    try {
      if (form.id) await ADMIN.put(`/announcements/${form.id}`, body); else await ADMIN.post('/announcements', body);
      toast('Announcement saved'); setForm(null); reload();
    } catch (err) { toast(errMsg(err), 'bad'); } finally { setBusy(false); }
  };
  const toggle = async (a, active) => { try { await ADMIN.put(`/announcements/${a._id}`, { active }); reload(); } catch (e) { toast(errMsg(e), 'bad'); } };
  const remove = async (a) => {
    if (!(await confirm({ title: 'Delete announcement?', message: a.title, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await ADMIN.delete(`/announcements/${a._id}`); toast('Deleted'); reload(); } catch (e) { toast(errMsg(e), 'bad'); }
  };

  return (
    <>
      <PageHeader title="Announcements" subtitle="Banners shown at the top of every member’s Home page">
        <button className="a-btn primary" onClick={() => setForm(EMPTY)}><Icon name="plus" size={15} /> New announcement</button>
      </PageHeader>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <Card flush>
        {loading && !data ? <Spinner /> : !data?.length ? <Empty icon="bell" title="No announcements yet">Create one to show a banner to all members.</Empty> : (
          <div className="a-list">{data.map((a) => (
            <div className="a-item" key={a._id}>
              <div className="a-item-main">
                <div className="a-row wrap"><b>{a.title}</b><Badge tone={STATE_TONE[a.state]}>{a.state}</Badge><Badge tone={a.type === 'critical' ? 'bad' : a.type === 'warning' ? 'warn' : a.type === 'success' ? 'good' : 'info'}>{a.type}</Badge></div>
                {a.body && <span>{a.body}</span>}
                <span className="a-muted">{a.starts_at ? `From ${fmtDateTime(a.starts_at)}` : 'Starts immediately'} · {a.ends_at ? `until ${fmtDateTime(a.ends_at)}` : 'no end date'} · by {a.created_by}</span>
              </div>
              <div className="a-actions">
                <Switch checked={a.active} onChange={(v) => toggle(a, v)} />
                <button className="a-btn sm ghost" onClick={() => setForm({ id: a._id, title: a.title, body: a.body || '', type: a.type, active: a.active, starts_at: toLocalInput(a.starts_at), ends_at: toLocalInput(a.ends_at) })}><Icon name="edit" size={14} /> Edit</button>
                <button className="a-btn sm danger-ghost" onClick={() => remove(a)}><Icon name="trash" size={14} /></button>
              </div>
            </div>))}</div>
        )}
      </Card>
      <Modal open={!!form} title={form?.id ? 'Edit announcement' : 'New announcement'} onClose={() => setForm(null)}
        footer={<><button className="a-btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="a-btn primary" form="ann" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
        {form && (
          <form id="ann" onSubmit={save}>
            <label className="a-field"><span>Title</span><input className="a-input" required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="a-field"><span>Message (optional)</span><textarea className="a-textarea" maxLength={1000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></label>
            <div className="a-form-grid">
              <label className="a-field"><span>Style</span><select className="a-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className="a-field"><span>Visible</span><div style={{ paddingTop: 6 }}><Switch checked={form.active} onChange={(v) => setForm({ ...form, active: v })} /></div></label>
              <label className="a-field"><span>Show from (optional)</span><input className="a-input" type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></label>
              <label className="a-field"><span>Hide after (optional)</span><input className="a-input" type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
