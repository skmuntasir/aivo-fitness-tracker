// A member's own workout names + which names their workout timer shows (Profile -> Workout names).
//
//   prefs = { custom: { gym: [...], home: [...] },   // names the member added themselves
//             shown:  { gym: [...] | null, home: [...] | null } }   // null = show every name (the default)
//
// Saved on the server (per profile, follows the member across devices) and mirrored in localStorage so the timer
// opens instantly. Anything that changes the prefs calls savePrefs(), which tells the open timer / profile to refresh.
import API from '../services/api';
import { WORKOUTS, WORKOUT_GROUPS } from '../data/workouts';

export const PREFS_EVENT = 'aivo:workout-prefs';
export const MAX_CUSTOM = 40;
export const MAX_NAME = 30;

const GROUP_IDS = WORKOUT_GROUPS.map((g) => g.id);
const emptyPrefs = () => ({
  custom: Object.fromEntries(GROUP_IDS.map((g) => [g, []])),
  shown: Object.fromEntries(GROUP_IDS.map((g) => [g, null])),
});

// "Pull-Ups", "pull ups" and "PULL UPS" are the same workout
export const nameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const cleanName = (raw) => String(raw || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
export const sortNames = (list) => [...list].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));

const uniqueByKey = (list) => {
  const seen = new Set();
  return list.filter((n) => { const k = nameKey(n); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};

export const defaultNames = (group) => WORKOUTS.filter((w) => w.group === group).map((w) => w.name);
export const defaultByKey = (group, name) => defaultNames(group).find((d) => nameKey(d) === nameKey(name)) || null;
// a default name from either group (used to place names suggested by the AI coach)
export const anyDefault = (name) => WORKOUTS.find((w) => nameKey(w.name) === nameKey(name)) || null;

export const normalizePrefs = (raw) => {
  const out = emptyPrefs();
  GROUP_IDS.forEach((g) => {
    const custom = uniqueByKey((Array.isArray(raw?.custom?.[g]) ? raw.custom[g] : []).map(cleanName).filter(Boolean))
      .filter((n) => !defaultByKey(g, n)).slice(0, MAX_CUSTOM);
    out.custom[g] = sortNames(custom);
    const shown = raw?.shown?.[g];
    out.shown[g] = Array.isArray(shown) && shown.length ? sortNames(uniqueByKey(shown.map(cleanName).filter(Boolean))) : null;
  });
  return out;
};

// every name that exists for the member in a group (built-in + their own), alphabetical
export const allNames = (prefs, group) => sortNames(uniqueByKey([...defaultNames(group), ...(prefs?.custom?.[group] || [])]));

// the names the workout timer shows for a group, alphabetical
export const timerNames = (prefs, group) => {
  const all = allNames(prefs, group);
  const shown = prefs?.shown?.[group];
  if (!shown) return all;
  const keys = new Set(shown.map(nameKey));
  const list = all.filter((n) => keys.has(nameKey(n)));
  return list.length ? list : all;
};

export const isShown = (prefs, group, name) => {
  const shown = prefs?.shown?.[group];
  return !shown || shown.some((n) => nameKey(n) === nameKey(name));
};

// which group a name belongs to for this member (null = unknown)
export const groupOfName = (prefs, name) => {
  const k = nameKey(name);
  for (const g of GROUP_IDS) if ((prefs?.custom?.[g] || []).some((n) => nameKey(n) === k)) return g;
  return anyDefault(name)?.group || null;
};

// ── storage ──────────────────────────────────────────────────────────────
const CACHE_PREFIX = 'aivo_workout_prefs';
const cacheKey = () => {
  try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return `${CACHE_PREFIX}_${u.id || u._id || 'me'}`; } catch { return CACHE_PREFIX; }
};
export const readCachedPrefs = () => {
  try { return normalizePrefs(JSON.parse(localStorage.getItem(cacheKey()) || 'null')); } catch { return emptyPrefs(); }
};
const writeCache = (prefs) => { try { localStorage.setItem(cacheKey(), JSON.stringify(prefs)); } catch { /* private mode */ } };

// signed out: forget the saved copy (same as the other per-member caches)
if (typeof window !== 'undefined') {
  window.addEventListener('logout', () => {
    try { Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  });
}

export const loadPrefs = async () => {
  const res = await API.get('/users/workout-prefs');
  const prefs = normalizePrefs(res.data?.prefs);
  writeCache(prefs);
  return prefs;
};

export const savePrefs = async (next) => {
  const prefs = normalizePrefs(next);
  const res = await API.put('/users/workout-prefs', prefs);
  const saved = normalizePrefs(res.data?.prefs || prefs);
  writeCache(saved);
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: saved }));
  return saved;
};

// Adds names (from the AI coach) to the member's workout timer. `items` = [{ name, group }].
// Names that already exist keep their spelling; new ones become the member's own names. Returns { prefs, added }.
export const addNamesToTimer = async (items) => {
  const prefs = await loadPrefs();
  const next = normalizePrefs(prefs);
  let added = 0;
  items.forEach(({ name, group }) => {
    const clean = cleanName(name);
    if (!clean || !GROUP_IDS.includes(group)) return;
    const existing = allNames(next, group).find((n) => nameKey(n) === nameKey(clean));
    const finalName = existing || clean;
    if (!existing) {
      if (next.custom[group].length >= MAX_CUSTOM) return;
      next.custom[group] = [...next.custom[group], finalName];
      added += 1;
    } else if (!isShown(next, group, finalName)) {
      added += 1;
    }
    if (next.shown[group]) next.shown[group] = [...next.shown[group], finalName];   // "show everything" needs no change
  });
  const saved = await savePrefs(next);
  return { prefs: saved, added };
};

// ── reading workout names out of a coach reply ───────────────────────────
// The coach writes plans as "- Bench Press: 3 x 12". Only bullet / numbered lines are read; headings, meals and
// generic lines (rest, warm-up, tips...) are skipped.
const SKIP = /^(rest( day)?|warm-?\s?up|cool-?\s?down|tip|tips|note|notes|total|day \d+|week \d+|breakfast|lunch|dinner|snacks?|meals?|hydrate|water|sleep|recovery|stretch(es)?( and|\/)? mobility|rest and recovery|off)$/i;
export const extractWorkoutNames = (text) => {
  const found = [];
  const seen = new Set();
  String(text || '').split('\n').forEach((raw) => {
    const m = raw.match(/^\s*(?:[-*•–]|\d{1,2}[.)])\s+(.*)$/);
    if (!m || /\b\d+\s*(kcal|cal|calories|g\s+protein|grams?)\b/i.test(m[1])) return;   // meal lines carry calories
    let t = m[1].replace(/\*\*|__|`/g, '').trim();
    t = t.split(/\s*[:–—]\s+|:\s*|\s+-\s+|\s*\(|\s+x\s*\d|\s+\d+\s*(?:x|sets?|reps?|min|sec|s\b)/i)[0];
    t = cleanName(t.replace(/^[\s\d.)]+/, '').replace(/[.,;!]+$/, ''));
    if (t.length < 3 || t.length > MAX_NAME || t.split(' ').length > 5 || SKIP.test(t) || !/[a-z]/i.test(t)) return;
    if (/\b(calories|kcal|protein|grams?|cup|oz|serving)\b/i.test(t)) return;
    const k = nameKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    found.push(t.replace(/\b([a-z])([a-z]*)/g, (_, a, b) => a.toUpperCase() + b));
  });
  return found;
};

// ── hidden "[[WORKOUTS: A | B]]" line ────────────────────────────────────────
// The coach ends every workout plan with this line (see backend ai/routes.py). The app never shows it: it is cut from
// the displayed / saved text and read here to build the "Add to workout timer" button reliably.
const TAG_FULL = /\[\[\s*WORKOUTS?\s*:\s*([^\]]*)\]\]/i;
const TAG_PARTIAL = /\[\[\s*W[^\]]*$/i;          // the line while it is still streaming in
export const stripCoachTags = (text) => String(text || '').replace(TAG_FULL, '').replace(TAG_PARTIAL, '').trimEnd();

const PRESCRIPTION = /:\s*\d+\s*(?:[x×]|sets?|reps?|sec|min|s\b)|\b\d+\s*[x×]\s*\d+/i;   // "Bench Press: 3 x 12", "Plank: 45 sec"

// Workout names in a coach reply: the hidden line first; else bullet lines that carry sets x reps / a time; else the
// older loose reading (kept as a last resort).
export const planNamesFromReply = (text) => {
  const raw = String(text || '');
  const tag = raw.match(TAG_FULL);
  const finish = (list) => {
    const seen = new Set();
    return list.map((n) => cleanName(n.replace(/\*\*|__|`/g, ''))).filter((n) => {
      const k = nameKey(n);
      if (n.length < 2 || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((n) => n.replace(/\b([a-z])([a-z]*)/g, (_, a, b) => a.toUpperCase() + b));
  };
  if (tag) { const names = finish(tag[1].split('|')); if (names.length) return names; }
  const withRx = [];
  raw.split('\n').forEach((line) => {
    const m = line.match(/^\s*(?:[-*•–]|\d{1,2}[.)])\s+(.*)$/);
    if (!m || !PRESCRIPTION.test(m[1])) return;
    if (/\b\d+\s*(kcal|cal|calories|g\s+protein|grams?)\b/i.test(m[1])) return;
    const name = m[1].replace(/\*\*|__|`/g, '').split(/\s*[:–—]\s*|\s+-\s+|\s*\(/)[0];
    if (name.length >= 3 && name.length <= MAX_NAME && name.split(' ').length <= 5 && !SKIP.test(name.trim())) withRx.push(name);
  });
  const fromRx = finish(withRx);
  if (fromRx.length >= 2) return fromRx;
  return extractWorkoutNames(raw);
};
