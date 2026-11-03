import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { WORKOUT_GROUPS } from '../data/workouts';
import { useFeedback } from './Feedback';
import Icon from './Icon';
import {
  PREFS_EVENT, MAX_CUSTOM, MAX_NAME, allNames, cleanName, defaultByKey, isShown, loadPrefs, nameKey,
  normalizePrefs, readCachedPrefs, savePrefs,
} from '../utils/workoutPrefs';
import './WorkoutNames.css';

// Profile card: add your own workout names (Gym / Home) and pick which names the workout timer shows.
export default function WorkoutNames() {
  const { toast } = useFeedback();
  const [prefs, setPrefs] = useState(readCachedPrefs);
  const [ready, setReady] = useState(false);
  const [group, setGroup] = useState('gym');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPrefs().then((p) => { if (alive) { setPrefs(p); setReady(true); } }).catch(() => { if (alive) setReady(true); });
    const onPrefs = (e) => e.detail && setPrefs(e.detail);   // e.g. the AI coach added names
    window.addEventListener(PREFS_EVENT, onPrefs);
    return () => { alive = false; window.removeEventListener(PREFS_EVENT, onPrefs); };
  }, []);

  const names = useMemo(() => allNames(prefs, group), [prefs, group]);
  const customKeys = useMemo(() => new Set(prefs.custom[group].map(nameKey)), [prefs, group]);
  const shownCount = names.filter((n) => isShown(prefs, group, n)).length;

  const commit = useCallback(async (next, okMsg) => {
    const before = prefs;
    setPrefs(normalizePrefs(next));            // instant
    setBusy(true);
    try { setPrefs(await savePrefs(next)); if (okMsg) toast(okMsg, 'success'); }
    catch (e) { setPrefs(before); toast(e?.response?.data?.message || 'Could not save your workout names. Please try again.', 'error'); }
    finally { setBusy(false); }
  }, [prefs, toast]);

  const withShown = (list) => ({ ...prefs, shown: { ...prefs.shown, [group]: list } });

  const toggle = (name) => {
    const on = isShown(prefs, group, name);
    if (on && shownCount <= 1) { toast('Keep at least one workout on your timer.', 'info'); return; }
    const current = prefs.shown[group] || names;
    const list = on ? current.filter((n) => nameKey(n) !== nameKey(name)) : [...current, name];
    commit(withShown(list.length === names.length ? null : list));
  };

  const add = (e) => {
    e.preventDefault();
    const name = cleanName(draft);
    if (name.length < 2) { toast('Type a workout name first.', 'info'); return; }
    if (names.some((n) => nameKey(n) === nameKey(name))) {
      toast(defaultByKey(group, name) ? 'That workout is already in the list.' : 'You already added that one.', 'info'); return;
    }
    if (prefs.custom[group].length >= MAX_CUSTOM) { toast(`You can add up to ${MAX_CUSTOM} names per list.`, 'error'); return; }
    const next = { ...prefs, custom: { ...prefs.custom, [group]: [...prefs.custom[group], name] } };
    if (next.shown[group]) next.shown[group] = [...next.shown[group], name];   // new names show on the timer straight away
    setDraft('');
    commit(next, `“${name}” added to your ${group === 'gym' ? 'Gym' : 'Home'} timer.`);
  };

  const remove = (name) => {
    const next = { ...prefs, custom: { ...prefs.custom, [group]: prefs.custom[group].filter((n) => nameKey(n) !== nameKey(name)) } };
    if (next.shown[group]) {
      const left = next.shown[group].filter((n) => nameKey(n) !== nameKey(name));
      next.shown[group] = left.length ? left : null;
    }
    commit(next, `“${name}” removed.`);
  };

  const groupLabel = WORKOUT_GROUPS.find((g) => g.id === group)?.label;

  return (
    <div className="prof-card card prof-wide wn-card">
      <div className="prof-card-header">
        <span className="prof-card-icon"><Icon name="timer" size={20} /></span>
        <div>
          <div className="prof-card-title">Workout names</div>
          <div className="prof-card-sub">Add your own and choose what your workout timer shows</div>
        </div>
      </div>

      <div className="wn-tabs" role="tablist" aria-label="Workout type">
        {WORKOUT_GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>

      <form className="wn-add" onSubmit={add}>
        <input className="wn-input" value={draft} maxLength={MAX_NAME} onChange={(e) => setDraft(e.target.value)} placeholder={`Add your own ${groupLabel} workout`} aria-label={`New ${groupLabel} workout name`} />
        <button type="submit" className="prof-btn-primary wn-add-btn" disabled={busy || !draft.trim()}><Icon name="plus" size={16} /> Add</button>
      </form>

      <div className="wn-meta">
        <span>{ready ? `${shownCount} of ${names.length} shown on your ${groupLabel} timer` : 'Loading…'}</span>
        <span className="wn-meta-actions">
          <button type="button" disabled={busy || shownCount === names.length} onClick={() => commit(withShown(null))}>Show all</button>
        </span>
      </div>

      <div className="wn-grid" role="group" aria-label={`${groupLabel} workouts`}>
        {names.map((name) => {
          const on = isShown(prefs, group, name);
          const own = customKeys.has(nameKey(name));
          return (
            <div key={name} className={`wn-chip${on ? ' on' : ''}${own ? ' own' : ''}`}>
              <button type="button" className="wn-chip-main" aria-pressed={on} onClick={() => toggle(name)} disabled={busy}>
                <span className="wn-tick" aria-hidden="true">{on && <Icon name="check" size={12} strokeWidth={3} />}</span>
                <span className="wn-chip-name">{name}</span>
              </button>
              {own && <button type="button" className="wn-del" onClick={() => remove(name)} disabled={busy} aria-label={`Remove ${name}`} title="Remove"><Icon name="x" size={13} /></button>}
            </div>
          );
        })}
      </div>
      <p className="wn-hint">Tap a name to show or hide it on your timer. Names with an × are yours; the built-in ones can be hidden but stay available.</p>
    </div>
  );
}
