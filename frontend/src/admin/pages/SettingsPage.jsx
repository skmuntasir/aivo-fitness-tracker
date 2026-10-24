import React, { useEffect, useState } from 'react';
import ADMIN, { errMsg } from '../adminApi';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Switch, fmtNum, useConfirm, useFetch, useToast } from '../ui';

export default function SettingsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useFetch(() => ADMIN.get('/system/health').then((r) => r.data.health), []);
  const [s, setS] = useState(null);
  const [words, setWords] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { if (data) { setS(data.settings); setWords((data.settings.banned_words || []).join('\n')); setMsg(data.settings.maintenance_message); } }, [data]);

  const save = async (patch, ok = 'Saved') => {
    try { const r = await ADMIN.put('/settings', patch); setS(r.data.settings); toast(ok); } catch (e) { toast(errMsg(e), 'bad'); reload(); }
  };
  const toggleMaintenance = async (on) => {
    if (on && !(await confirm({ title: 'Turn on maintenance mode?', message: 'Every member is blocked from using the app until you turn it off. Admins are not affected.', confirmLabel: 'Turn on', tone: 'danger' }))) return;
    save({ maintenance_mode: on }, on ? 'Maintenance mode is ON' : 'Maintenance mode is off');
  };

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!s) return null;
  return (
    <>
      <PageHeader title="Settings" subtitle="Platform-wide switches. Changes apply within seconds." />

      <Card title="Platform">
        <div className="a-setting"><div><b>New registrations</b><span className="a-muted">Turn off to stop anyone creating a new account.</span></div>
          <Switch checked={s.registration_enabled} onChange={(v) => save({ registration_enabled: v })} /></div>
        <div className="a-setting"><div><b>AI coach</b><span className="a-muted">Turn off to disable the AI chat for all members.</span></div>
          <Switch checked={s.ai_enabled} onChange={(v) => save({ ai_enabled: v })} /></div>
        <div className="a-setting"><div><b>Maintenance mode</b><span className="a-muted">Blocks the whole app for members. Admins can still sign in.</span></div>
          <Switch checked={s.maintenance_mode} onChange={toggleMaintenance} /></div>
        <label className="a-field" style={{ marginTop: 14 }}><span>Maintenance message shown to members</span>
          <textarea className="a-textarea" rows={2} maxLength={240} value={msg} onChange={(e) => setMsg(e.target.value)} /></label>
        <button className="a-btn ghost" onClick={() => save({ maintenance_message: msg }, 'Message saved')}>Save message</button>
      </Card>

      <Card title="Blocked words" subtitle="One per line. Posts containing one are hidden automatically and sent to Reports; comments are rejected. Whole words only, not case-sensitive.">
        <textarea className="a-textarea" rows={6} value={words} onChange={(e) => setWords(e.target.value)} placeholder={'spamword\nanother word'} />
        <div className="a-row" style={{ marginTop: 12 }}>
          <button className="a-btn primary" onClick={() => save({ banned_words: words.split(/[\n,]/).map((w) => w.trim()).filter(Boolean) }, 'Blocked words saved')}>Save blocked words</button>
          <span className="a-muted">{(s.banned_words || []).length} active</span>
        </div>
      </Card>

      <Card title="System status" actions={<button className="a-btn sm ghost" onClick={reload}>Refresh</button>}>
        <dl className="a-dl">
          <dt>Database</dt><dd><Badge tone={data.database.ok ? 'good' : 'bad'}>{data.database.ok ? `Connected · ${data.database.latency_ms} ms` : 'Unreachable'}</Badge></dd>
          <dt>AI coach key</dt><dd><Badge tone={data.ai_configured ? 'good' : 'warn'}>{data.ai_configured ? 'GROQ_API_KEY set' : 'Not configured'}</Badge></dd>
          <dt>Email (SMTP)</dt><dd><Badge tone={data.email_configured ? 'good' : 'warn'}>{data.email_configured ? 'Configured' : 'Not configured — emailing members is disabled'}</Badge></dd>
          <dt>Online now</dt><dd>{fmtNum(data.online_users)} member(s)</dd>
          <dt>Environment</dt><dd>{data.environment} · Python {data.python} · up {Math.floor(data.uptime_seconds / 3600)}h {Math.floor((data.uptime_seconds % 3600) / 60)}m</dd>
          <dt>Records</dt><dd>{Object.entries(data.collections).map(([k, v]) => `${k}: ${fmtNum(v)}`).join(' · ')}</dd>
        </dl>
      </Card>
    </>
  );
}
