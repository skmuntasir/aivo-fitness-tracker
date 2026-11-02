import React, { useCallback, useEffect, useState } from 'react';
import API from '../services/api';
import { invalidateCache } from '../services/api';
import { userTimeZone } from '../utils/time';
import { useFeedback } from './Feedback';
import Icon from './Icon';
import { readEngage, writeEngage } from '../utils/engageCache';
import './Engage.css';

const todayKey = () => new Date().toDateString();
// Last known state, reused only for the same calendar day (a freeze depends on today / this week)
const cachedState = () => { const c = readEngage('freeze'); return c && c.day === todayKey() ? c.state : null; };

// "Rest-day freeze": one per calendar week turns a rest day into a day that keeps your streak alive.
export default function StreakFreeze({ onChange, refreshKey }) {
  const { toast, confirm } = useFeedback();
  const [st, setSt] = useState(cachedState);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await API.get('/streak/freeze', { params: { tz: userTimeZone } });
      if (r.data.success) { setSt(r.data); writeEngage('freeze', { day: todayKey(), state: r.data }); }
    } catch { /* keep showing the last known state */ }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const act = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      if (r.data.success) { setSt(r.data); writeEngage('freeze', { day: todayKey(), state: r.data }); invalidateCache('/workouts'); toast(okMsg || r.data.message, 'success'); onChange && onChange(); }
    } catch (e) { toast(e?.response?.data?.message || 'Could not update your streak freeze.', 'error'); }
    finally { setBusy(false); }
  };

  const freeze = async (day) => {
    const ok = await confirm({
      title: day === 'today' ? 'Freeze today as a rest day?' : 'Freeze yesterday?',
      message: `You get one freeze per week. A frozen day keeps your ${st?.streak || ''} day streak alive but doesn't add to it.`,
      confirmLabel: 'Use freeze',
    });
    if (ok) act(() => API.post('/streak/freeze', { day }, { params: { tz: userTimeZone } }), 'Rest day frozen. Your streak is safe.');
  };

  // Before the very first answer arrives the card is still there (same size, actions disabled), so nothing pops in.
  if (!st) {
    return (
      <div className="sf-card" aria-busy="true">
        <span className="sf-icon"><Icon name="snow" size={20} /></span>
        <div className="sf-text"><strong>Streak freeze</strong><small>Skip a rest day safely</small></div>
        <div className="sf-actions"><span className="sf-why">&nbsp;</span></div>
      </div>
    );
  }
  const left = st.used_this_week ? 0 : 1;

  return (
    <div className={`sf-card${st.frozen_today ? ' on' : ''}`}>
      <span className="sf-icon"><Icon name="snow" size={20} /></span>
      <div className="sf-text">
        <strong>{st.frozen_today ? 'Today is a rest day' : 'Streak freeze'}</strong>
        <small>
          {st.frozen_today ? 'Your streak is protected.'
            : `${left} left this week · skip a rest day safely`}
        </small>
      </div>
      <div className="sf-actions">
        {st.frozen_today && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => API.delete('/streak/freeze', { params: { tz: userTimeZone } }), 'Freeze removed.')}>Undo</button>}
        {!st.frozen_today && st.can_freeze_today && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => freeze('today')}>Freeze today</button>}
        {!st.frozen_today && !st.can_freeze_today && st.can_freeze_yesterday && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => freeze('yesterday')}>Save yesterday</button>}
        {!st.frozen_today && !st.can_freeze_today && !st.can_freeze_yesterday && (
          <span className="sf-why" title={st.today_message || ''}>{st.used_this_week ? 'Used' : st.today_reason === 'trained' ? 'Trained today' : 'Need a streak'}</span>
        )}
      </div>
    </div>
  );
}
