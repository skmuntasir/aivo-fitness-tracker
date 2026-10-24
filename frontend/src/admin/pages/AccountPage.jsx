import React, { useState } from 'react';
import ADMIN, { TOKEN_KEY, errMsg } from '../adminApi';
import { useAdmin } from '../adminContext';
import { Avatar, Badge, Card, PageHeader, useToast } from '../ui';

export default function AccountPage() {
  const { admin } = useAdmin();
  const toast = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (f.new_password !== f.confirm) return toast('New passwords do not match', 'bad');
    setBusy(true);
    try {
      const { data } = await ADMIN.post('/auth/change-password', { current_password: f.current_password, new_password: f.new_password });
      localStorage.setItem(TOKEN_KEY, data.token);   // old sessions ended; keep this one signed in
      toast('Password changed. Other sessions were signed out.');
      setF({ current_password: '', new_password: '', confirm: '' });
    } catch (err) { toast(errMsg(err), 'bad'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="My account" subtitle="Your admin sign-in details" />
      <div className="a-grid two">
        <Card title="Profile">
          <div className="a-row" style={{ gap: 14 }}>
            <Avatar name={admin?.full_name || 'A'} size={56} />
            <div><b style={{ fontSize: 16 }}>{admin?.full_name}</b><br /><span className="a-muted">{admin?.email}</span><br />
              <Badge tone="accent">{admin?.role === 'moderator' ? 'Moderator' : 'Administrator'}</Badge></div>
          </div>
        </Card>
        <Card title="Change password" subtitle="This also signs you out of every other device.">
          <form onSubmit={submit}>
            <label className="a-field"><span>Current password</span><input className="a-input" type="password" autoComplete="current-password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></label>
            <label className="a-field"><span>New password</span><input className="a-input" type="password" autoComplete="new-password" required value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} placeholder="8+ characters, upper, lower & a number" /></label>
            <label className="a-field"><span>Confirm new password</span><input className="a-input" type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
            <button className="a-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
          </form>
        </Card>
      </div>
    </>
  );
}
