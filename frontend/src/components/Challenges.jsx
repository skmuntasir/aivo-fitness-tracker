import React, { useCallback, useEffect, useState } from 'react';
import API from '../services/api';
import { useFeedback } from './Feedback';
import Icon from './Icon';
import { readEngage, writeEngage } from '../utils/engageCache';
import './Engage.css';

const fmtMin = (sec) => {
  const m = Math.floor((sec || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
};
const fmtLeft = (sec) => {
  if (sec <= 0) return 'ended';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

// Shared loader: polls every 15 s while mounted so the bar moves as soon as either side trains.
// The last result is remembered, so the bar is on screen from the very first paint after a refresh.
// An active race whose week has already ended is dropped locally; nothing is shown when there is no race.
const fromCache = () => {
  const c = readEngage('challenges');
  if (!c || !Array.isArray(c.items)) return { items: null, incoming: 0 };
  const age = Math.max(0, Math.floor((Date.now() - (c.savedAt || 0)) / 1000));
  const items = c.items
    .map((x) => (x.status === 'active' ? { ...x, seconds_left: (x.seconds_left || 0) - age } : x))
    .filter((x) => x.status !== 'active' || x.seconds_left > 0);
  return { items, incoming: c.incoming || 0 };
};
export function useChallenges(refreshKey) {
  const [data, setData] = useState(fromCache);
  const load = useCallback(async () => {
    try {
      const r = await API.get('/challenges');
      if (r.data.success) {
        writeEngage('challenges', { items: r.data.challenges, incoming: r.data.incoming_count });
        setData({ items: r.data.challenges, incoming: r.data.incoming_count });
      }
    } catch { setData((d) => (d.items ? d : { items: [], incoming: 0 })); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [load, refreshKey]);
  return { ...data, reload: load };
}

// The live "who is ahead" bar
export function VersusBar({ c, slim }) {
  const lead = c.leader;
  return (
    <div className={`vs${slim ? ' slim' : ''}`}>
      <div className="vs-names">
        <span className={lead === 'me' ? 'lead' : ''}><b>You</b> · {fmtMin(c.me.seconds)}</span>
        <span className={lead === 'friend' ? 'lead' : ''}>{fmtMin(c.friend.seconds)} · <b>{c.friend.name.split(' ')[0]}</b></span>
      </div>
      <div className="vs-bar" role="progressbar" aria-valuenow={c.my_share} aria-valuemin={0} aria-valuemax={100} aria-label="Minutes this week, you versus your friend">
        <i className="vs-me" style={{ width: `${c.my_share}%` }} />
        <i className="vs-them" style={{ width: `${100 - c.my_share}%` }} />
      </div>
    </div>
  );
}

function CompactItem({ c, onAct, busy }) {
  const first = c.friend.name.split(' ')[0];
  const status = c.status === 'active' ? fmtLeft(c.seconds_left) : 'Waiting for reply';
  return (
    <div className={`chr ch-${c.status}`}>
      <span className="chr-ic"><Icon name="swords" size={18} /></span>
      <div className="chr-main">
        <div className="chr-top">
          <strong>Most minutes this week</strong>
          <span>{c.status === 'pending' && c.role === 'opponent' ? `${first} challenged you` : c.status === 'pending' ? `Sent to ${first}` : status}</span>
        </div>
        {c.status === 'active' && <VersusBar c={c} slim />}
      </div>
      {c.status === 'pending' && (
        <div className="chr-actions">
          {c.role === 'opponent' ? (
            <>
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAct('accept', c)}>Accept</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAct('decline', c)}>Decline</button>
            </>
          ) : <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAct('cancel', c)}>Cancel</button>}
        </div>
      )}
    </div>
  );
}

function Item({ c, onAct, busy }) {
  const gap = Math.abs(c.me.seconds - c.friend.seconds);
  return (
    <div className={`ch-item ch-${c.status}`}>
      <div className="ch-top">
        <span className="ch-title"><Icon name="swords" size={16} /> Most minutes this week</span>
        <span className="ch-meta">
          {c.status === 'active' && fmtLeft(c.seconds_left)}
          {c.status === 'pending' && 'Waiting for reply'}
          {c.status === 'finished' && (c.winner === 'me' ? 'You won' : c.winner === 'tie' ? 'Tie' : `${c.friend.name.split(' ')[0]} won`)}
        </span>
      </div>
      {c.status !== 'pending' && <VersusBar c={c} />}
      {c.status === 'active' && (
        <p className="ch-note">
          {c.leader === 'tie' ? 'Dead level. Any workout puts you ahead.'
            : c.leader === 'me' ? `You lead by ${fmtMin(gap)}. Keep it up!` : `${c.friend.name.split(' ')[0]} leads by ${fmtMin(gap)}. Time to train.`}
        </p>
      )}
      {c.status === 'pending' && (
        <div className="ch-pending">
          <p className="ch-note">{c.role === 'opponent' ? `${c.friend.name} challenged you to a minutes race this week.` : `Challenge sent to ${c.friend.name}.`}</p>
          <div className="ch-actions">
            {c.role === 'opponent' ? (
              <>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAct('accept', c)}>Accept</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAct('decline', c)}>Decline</button>
              </>
            ) : <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAct('cancel', c)}>Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ChallengeList({ items, reload, limit, emptyText, compact }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const onAct = async (kind, c) => {
    setBusy(true);
    try {
      const r = kind === 'accept' ? await API.put(`/challenges/${c.id}/accept`)
        : kind === 'decline' ? await API.put(`/challenges/${c.id}/decline`) : await API.delete(`/challenges/${c.id}`);
      toast(r.data.message, 'success');
      await reload();
    } catch (e) { toast(e?.response?.data?.message || 'Something went wrong.', 'error'); }
    finally { setBusy(false); }
  };
  const shown = limit ? items.slice(0, limit) : items;
  if (!shown.length) return emptyText ? <p className="ch-empty">{emptyText}</p> : null;
  const Row = compact ? CompactItem : Item;
  return <div className={`ch-list${compact ? ' compact' : ''}`}>{shown.map((c) => <Row key={c.id} c={c} onAct={onAct} busy={busy} />)}</div>;
}

// Friends-page panel
export default function ChallengesPanel({ refreshKey }) {
  const { items, reload } = useChallenges(refreshKey);
  if (items === null) return null;
  return (
    <section className="friends-challenges card">
      <div className="friends-section-title"><Icon name="swords" size={17} /> Friend challenges</div>
      <ChallengeList items={items} reload={reload}
        emptyText="No challenge yet. Tap Challenge on a friend to start a “Most minutes this week” race." />
    </section>
  );
}

// Start a challenge with a friend (button used on each friend card)
export function useStartChallenge(onDone) {
  const { toast, confirm } = useFeedback();
  return async (friend) => {
    const ok = await confirm({
      title: `Challenge ${friend.full_name}?`,
      message: 'Most minutes trained this week (Mon to Sun) wins. They have to accept first.',
      confirmLabel: 'Send challenge',
    });
    if (!ok) return;
    try { const r = await API.post('/challenges', { friend_id: friend.id }); toast(r.data.message, 'success'); onDone && onDone(); }
    catch (e) { toast(e?.response?.data?.message || 'Could not send the challenge.', 'error'); }
  };
}
