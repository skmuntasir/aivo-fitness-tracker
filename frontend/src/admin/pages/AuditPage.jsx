import React, { useMemo, useState } from 'react';
import ADMIN from '../adminApi';
import Icon from '../Icon';
import { Badge, Card, Empty, ErrorBox, PageHeader, Pagination, Spinner, fmtDateTime, useDebounce, useFetch } from '../ui';

const tone = (a) => (/delete|suspend|reset|demote/.test(a) ? 'bad' : /login|export/.test(a) ? 'neutral' : /hide|role|settings|points/.test(a) ? 'warn' : 'accent');

export default function AuditPage() {
  const [f, setF] = useState({ actor: '', action: '', from: '', to: '', page: 1 });
  const da = useDebounce(f.actor), dn = useDebounce(f.action);
  const set = (p) => setF((s) => ({ ...s, page: 1, ...p }));
  const params = useMemo(() => ({ actor: da || undefined, action: dn || undefined, from: f.from || undefined, to: f.to || undefined, page: f.page, limit: 30 }), [da, dn, f.from, f.to, f.page]);
  const { data, loading, error, reload } = useFetch(() => ADMIN.get('/audit', { params }).then((r) => r.data), [params]);
  const logs = data?.logs || [];
  return (
    <>
      <PageHeader title="Audit log" subtitle="A permanent record of every action taken in this console" />
      <Card flush>
        <div className="a-filters">
          <div className="a-search"><Icon name="search" size={16} /><input className="a-input" placeholder="Filter by admin email…" value={f.actor} onChange={(e) => set({ actor: e.target.value })} /></div>
          <input className="a-input sm" placeholder="Action (e.g. user.suspend)" value={f.action} onChange={(e) => set({ action: e.target.value })} />
          <input className="a-input sm" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label="From" />
          <input className="a-input sm" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label="To" />
        </div>
        {error && <div style={{ padding: 16 }}><ErrorBox message={error} onRetry={reload} /></div>}
        {loading && !data ? <Spinner /> : logs.length === 0 ? <Empty icon="file" title="No entries match" /> : (
          <table className="a-table" style={{ opacity: loading ? 0.6 : 1 }}>
            <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
            <tbody>{logs.map((l) => (
              <tr key={l._id}>
                <td className="a-muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.ts)}</td>
                <td><b>{l.actor_name || '—'}</b><br /><small className="a-muted">{l.actor_email}</small></td>
                <td><Badge tone={tone(l.action)}>{l.action}</Badge></td>
                <td className="a-muted">{l.target_type || '—'}{l.target_id ? <><br /><span className="a-mono">{l.target_id.slice(-8)}</span></> : null}</td>
                <td className="a-kv">{l.details && Object.keys(l.details).length ? JSON.stringify(l.details) : ''}</td>
                <td className="a-muted a-mono">{l.ip}</td>
              </tr>))}</tbody>
          </table>
        )}
        <Pagination meta={data} onPage={(page) => setF((s) => ({ ...s, page }))} />
      </Card>
    </>
  );
}
