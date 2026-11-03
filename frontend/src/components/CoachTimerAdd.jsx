import React, { useEffect, useMemo, useState } from 'react';
import { useFeedback } from './Feedback';
import Icon from './Icon';
import { addNamesToTimer, groupOfName, loadPrefs, nameKey, planNamesFromReply, readCachedPrefs } from '../utils/workoutPrefs';

// The workout names found in a coach reply (empty when the reply is not a workout plan). A reply that ends with the
// hidden [[WORKOUTS: ...]] line always works; otherwise lines with sets x reps / a time are read.
export const planWorkoutNames = (text) => {
  const names = planNamesFromReply(text);
  const hasTag = /\[\[\s*WORKOUTS?\s*:/i.test(text || '');
  if (hasTag) return names;
  const meals = ((text || '').match(/\b(breakfast|lunch|dinner|snacks?|meals?|kcal)\b/gi) || []).length;
  return names.length >= 2 && meals < names.length ? names : [];
};

// "Add to workout timer" under a coach workout plan: pick the names, confirm Gym / Home for new ones, done.
export default function CoachTimerAdd({ text, names, initialDone = false, onDone }) {
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(initialDone);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState(readCachedPrefs);
  const [picked, setPicked] = useState(() => new Set(names.map(nameKey)));
  const [groups, setGroups] = useState({});   // nameKey -> 'gym' | 'home' for names the app does not know yet

  // a plan that talks about the home / bodyweight and not the gym starts new names on the Home list
  const guess = useMemo(() => (/\b(at home|home workout|bodyweight|no equipment)\b/i.test(text) && !/\bgym\b/i.test(text) ? 'home' : 'gym'), [text]);

  useEffect(() => { if (open) loadPrefs().then(setPrefs).catch(() => {}); }, [open]);

  const groupFor = (name) => groupOfName(prefs, name) || groups[nameKey(name)] || guess;
  const isKnown = (name) => !!groupOfName(prefs, name);
  const chosen = names.filter((n) => picked.has(nameKey(n)));

  const toggle = (name) => setPicked((prev) => { const next = new Set(prev); const k = nameKey(name); if (next.has(k)) next.delete(k); else next.add(k); return next; });

  const submit = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    try {
      const { added } = await addNamesToTimer(chosen.map((name) => ({ name, group: groupFor(name) })));
      setDone(true); setOpen(false); onDone?.();
      toast(added ? `${added} workout name${added === 1 ? '' : 's'} added to your timer.` : 'Those workouts are already on your timer.', 'success');
    } catch (e) {
      toast(e?.response?.data?.message || 'Could not update your workout timer. Please try again.', 'error');
    } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" className={`ac-save ac-timer${done ? ' saved' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name={done ? 'check' : 'timer'} size={14} strokeWidth={done ? 3 : 2} />
        {done ? 'On your timer · add more' : 'Add to workout timer'}
      </button>
      {open && (
        <div className="ac-timer-panel" role="group" aria-label="Workout names from this plan">
          <div className="ac-timer-head">Add these to your workout timer</div>
          <div className="ac-timer-list">
            {names.map((name) => {
              const on = picked.has(nameKey(name));
              const known = isKnown(name);
              const g = groupFor(name);
              return (
                <div key={name} className={`ac-timer-row${on ? ' on' : ''}`}>
                  <button type="button" className="ac-timer-pick" aria-pressed={on} onClick={() => toggle(name)}>
                    <span className="ac-timer-tick">{on && <Icon name="check" size={11} strokeWidth={3} />}</span>
                    <span className="ac-timer-name">{name}</span>
                  </button>
                  {known ? <em className="ac-timer-tag">{g === 'gym' ? 'Gym' : 'Home'}</em> : (
                    <span className="ac-timer-seg" role="group" aria-label={`${name} list`}>
                      {['gym', 'home'].map((id) => (
                        <button key={id} type="button" className={g === id ? 'on' : ''} onClick={() => setGroups((p) => ({ ...p, [nameKey(name)]: id }))}>{id === 'gym' ? 'Gym' : 'Home'}</button>
                      ))}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="ac-timer-foot">
            <small>You can change these any time in Profile → Workout names.</small>
            <button type="button" className="ac-timer-go" disabled={!chosen.length || busy} onClick={submit}>{busy ? 'Adding…' : `Add ${chosen.length}`}</button>
          </div>
        </div>
      )}
    </>
  );
}
