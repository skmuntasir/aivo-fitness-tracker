import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ADMIN, { BACKEND_URL, downloadFile, errMsg } from '../adminApi';
import { useAdmin } from '../adminContext';
import Icon from '../Icon';
import { Badge, Card, Empty, ErrorBox, PageHeader, Pagination, Spinner, Tabs, fmtDateTime, timeAgo, useConfirm, useDebounce, useFetch, useToast } from '../ui';


const REASON_TONE = { spam: 'warn', harassment: 'bad', inappropriate: 'bad', misinformation: 'info', other: 'neutral' };

function Reports({ onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const { admin } = useAdmin();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useFetch(() => ADMIN.get('/reports', { params: { status, page, limit: 10 } }).then((r) => r.data), [status, page]);

  const resolve = async (r, action) => {
    const cfg = {
      dismiss: { title: 'Dismiss this report?', message: 'The post stays visible. All open reports about it are closed.', confirmLabel: 'Dismiss' },
      hide_post: { title: 'Hide this post?', message: 'It disappears from every feed but is kept so you can restore it later.', confirmLabel: 'Hide post' },
      delete_post: { title: 'Delete this post permanently?', message: 'The post and its comments are removed.', confirmLabel: 'Delete post', tone: 'danger' },
      suspend_author: { title: `Suspend ${r.author.name}?`, message: 'The post is hidden and the author is signed out and blocked.', confirmLabel: 'Suspend author', tone: 'danger' },
    }[action];
    const res = await confirm({ ...cfg, input: { label: 'Internal note (optional)', placeholder: 'Why are you taking this action?' } });
    if (!res) return;
    try { await ADMIN.post(`/reports/${r.id}/resolve`, { action, note: res.value }); toast('Report resolved'); reload(); onChanged(); }
    catch (e) { toast(errMsg(e), 'bad'); }
  };

  return (
    <Card flush>
      <div className="a-filters">
        {['open', 'resolved', 'dismissed', 'all'].map((s) => (
          <button key={s} className={`a-btn sm ${status === s ? 'primary' : 'ghost'}`} onClick={() => { setStatus(s); setPage(1); }} style={{ textTransform: 'capitalize' }}>{s}</button>))}
      </div>
      {error && <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={reload} /></div>}
      {loading && !data ? <Spinner /> : !data?.reports.length ? <Empty icon="check" title={status === 'open' ? 'All clear — no open reports' : 'Nothing here'} /> : (
        <div className="a-list">{data.reports.map((r) => (
          <div className="a-item" key={r.id}>
            <div className="a-item-main">
              <div className="a-row wrap">
                <Badge tone={REASON_TONE[r.reason] || 'neutral'}>{r.reason}</Badge>
                {r.status !== 'open' && <Badge tone={r.status === 'dismissed' ? 'neutral' : 'good'}>{r.status}{r.resolution ? ` · ${r.resolution.replace('_', ' ')}` : ''}</Badge>}
                {!r.post_exists && <Badge tone="bad">Post deleted</Badge>}
                {r.post_hidden && <Badge tone="warn">Hidden</Badge>}
                <span className="a-muted">{timeAgo(r.created_at)}</span>
              </div>
              <div className="a-quote">{r.snippet || <i className="a-muted">(photo only)</i>}</div>
              {r.details && <span className="a-muted">Note: “{r.details}”</span>}
              <span className="a-muted">Reported by <b>{r.reporter.name}</b> · Post by <Link to={`/admin/users/${r.author.id}`}><b>{r.author.name}</b></Link>
                {r.resolved_by && <> · handled by {r.resolved_by}</>}{r.note && <> — “{r.note}”</>}</span>
            </div>
            {r.status === 'open' && (
              <div className="a-actions">
                <button className="a-btn sm ghost" onClick={() => resolve(r, 'dismiss')}>Dismiss</button>
                {r.post_exists && <button className="a-btn sm ghost" onClick={() => resolve(r, 'hide_post')}>Hide post</button>}
                {r.post_exists && <button className="a-btn sm danger-ghost" onClick={() => resolve(r, 'delete_post')}>Delete post</button>}
                {admin?.role === 'admin' && <button className="a-btn sm danger-ghost" onClick={() => resolve(r, 'suspend_author')}>Suspend author</button>}
              </div>)}
          </div>))}
        </div>
      )}
      <Pagination meta={data} onPage={setPage} />
    </Card>
  );
}

function PostRow({ p, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const loadDetail = async () => {
    try { const { data } = await ADMIN.get(`/posts/${p.id}`); setDetail(data.post); } catch (e) { toast(errMsg(e), 'bad'); }
  };
  const toggleComments = () => { const n = !open; setOpen(n); if (n && !detail) loadDetail(); };
  const hide = async (hidden) => {
    const res = hidden ? await confirm({ title: 'Hide this post?', message: 'It disappears from all feeds until restored.', confirmLabel: 'Hide', input: { label: 'Reason (optional)' } }) : { value: '' };
    if (!res) return;
    try { await ADMIN.post(`/posts/${p.id}/hide`, { hidden, reason: res.value }); toast(hidden ? 'Post hidden' : 'Post restored'); onChanged(); } catch (e) { toast(errMsg(e), 'bad'); }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete this post permanently?', message: 'The post, its photo and all comments are removed.', confirmLabel: 'Delete post', tone: 'danger' }))) return;
    try { await ADMIN.delete(`/posts/${p.id}`); toast('Post deleted'); onChanged(); } catch (e) { toast(errMsg(e), 'bad'); }
  };
  const delComment = async (c) => {
    if (!(await confirm({ title: 'Delete this comment?', message: `“${c.text}”`, confirmLabel: 'Delete comment', tone: 'danger' }))) return;
    try { await ADMIN.delete(`/posts/${p.id}/comments/${c.id}`); toast('Comment deleted'); loadDetail(); onChanged(true); } catch (e) { toast(errMsg(e), 'bad'); }
  };

  return (
    <div className="a-item">
      <div className="a-item-main">
        <div className="a-row wrap">
          <Link to={`/admin/users/${p.author.id}`}><b>{p.author.full_name}</b></Link>
          <span className="a-muted">{fmtDateTime(p.created_at)}</span>
          {p.hidden && <Badge tone="warn">Hidden</Badge>}
          {p.open_reports > 0 && <Badge tone="bad">{p.open_reports} open report{p.open_reports > 1 ? 's' : ''}</Badge>}
        </div>
        {p.content && <div className="a-quote">{p.content}</div>}
        {p.imageUrl && <img className="a-thumb" loading="lazy" alt="Post attachment" src={`${BACKEND_URL}${p.imageUrl}`} />}
        <button className="a-muted" style={{ textAlign: 'left' }} onClick={toggleComments}>{p.likes} likes · {p.comments_count} comments {p.comments_count > 0 && (open ? '▲' : '▼')}</button>
        {open && detail && (detail.comments.length === 0 ? <span className="a-muted">No comments</span> : detail.comments.map((c) => (
          <div key={c.id} className="a-row" style={{ justifyContent: 'space-between', gap: 12 }}>
            <span><b>{c.username}</b>: {c.text} <span className="a-muted">· {timeAgo(c.created_at)}</span></span>
            <button className="a-icon-btn" aria-label="Delete comment" onClick={() => delComment(c)}><Icon name="trash" size={15} /></button>
          </div>)))}
      </div>
      <div className="a-actions">
        {p.hidden ? <button className="a-btn sm ghost" onClick={() => hide(false)}><Icon name="eye" size={14} /> Restore</button>
          : <button className="a-btn sm ghost" onClick={() => hide(true)}>Hide</button>}
        <button className="a-btn sm danger-ghost" onClick={del}><Icon name="trash" size={14} /> Delete</button>
      </div>
    </div>
  );
}

function Posts({ onChanged }) {
  const [f, setF] = useState({ q: '', hidden: '', reported: false, page: 1 });
  const dq = useDebounce(f.q);
  const params = useMemo(() => ({ q: dq || undefined, hidden: f.hidden || undefined, reported: f.reported ? '1' : undefined, page: f.page, limit: 10 }), [dq, f.hidden, f.reported, f.page]);
  const { data, loading, error, reload } = useFetch(() => ADMIN.get('/posts', { params }).then((r) => r.data), [params]);
  const set = (patch) => setF((s) => ({ ...s, page: 1, ...patch }));
  return (
    <Card flush>
      <div className="a-filters">
        <div className="a-search"><Icon name="search" size={16} /><input className="a-input" placeholder="Search post text…" value={f.q} onChange={(e) => set({ q: e.target.value })} /></div>
        <select className="a-select" value={f.hidden} onChange={(e) => set({ hidden: e.target.value })} aria-label="Visibility"><option value="">All posts</option><option value="0">Visible</option><option value="1">Hidden</option></select>
        <label className="a-check"><input type="checkbox" checked={f.reported} onChange={(e) => set({ reported: e.target.checked })} /> Reported only</label>
      </div>
      {error && <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={reload} /></div>}
      {loading && !data ? <Spinner /> : !data?.posts.length ? <Empty icon="file" title="No posts found" /> : (
        <div className="a-list" style={{ opacity: loading ? 0.6 : 1 }}>{data.posts.map((p) => <PostRow key={p.id} p={p} onChanged={(soft) => { reload(); if (!soft) onChanged(); }} />)}</div>
      )}
      <Pagination meta={data} onPage={(page) => setF((s) => ({ ...s, page }))} />
    </Card>
  );
}

export default function ModerationPage() {
  const toast = useToast();
  const [tab, setTab] = useState('reports');
  const open = useFetch(() => ADMIN.get('/reports', { params: { status: 'open', limit: 1 } }).then((r) => r.data.total), []);
  const exportCsv = async () => { try { await downloadFile('/posts/export', {}, 'aivo_posts.csv'); } catch (e) { toast(errMsg(e), 'bad'); } };
  return (
    <>
      <PageHeader title="Posts & reports" subtitle="Review reports and community content. Private messages are never readable by admins.">
        <button className="a-btn ghost" onClick={exportCsv}><Icon name="download" size={15} /> Export posts CSV</button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'reports', label: 'Reports', count: open.data || 0 }, { id: 'posts', label: 'All posts' }]} />
      {tab === 'reports' ? <Reports onChanged={open.reload} /> : <Posts onChanged={open.reload} />}
    </>
  );
}
