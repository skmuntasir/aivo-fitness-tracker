"""Coach memory: a short, server-side note of the plans the AI coach already gave a member, so the next plan builds
on them (progression, rotation) instead of being a fresh random one. Stored on the user document (`coach_memory`),
newest last, at most MAX_ENTRIES. It is sent to the model inside the system prompt, never shown to other members.
"""
import re
from bson import ObjectId
from app.utils import utcnow

MAX_ENTRIES = 6
TAG = re.compile(r'\[\[\s*WORKOUTS?\s*:\s*([^\]]*)\]\]', re.I)          # hidden "[[WORKOUTS: A | B]]" line the app reads
PLAN_WORDS = re.compile(r'\b(sets?|reps?|warm-?up|cool-?down|workout|exercises?|day \d|breakfast|lunch|dinner|snacks?|meal|calories|kcal|protein)\b', re.I)
PRESCRIPTION = re.compile(r':\s*\d+\s*(?:[x×]|sets?|reps?|sec|min|s\b)|\b\d+\s*[x×]\s*\d+', re.I)
BULLET = re.compile(r'^\s*(?:[-*•]|\d{1,2}[.)])\s+(.*)$')


def strip_tag(text):
    return TAG.sub('', text or '').strip()


def looks_like_plan(text):
    text = strip_tag(text)
    if len([l for l in text.split('\n') if l.strip()]) < 5:
        return False
    rx_lines = sum(1 for l in text.split('\n') if BULLET.match(l) and PRESCRIPTION.search(l))   # "- Bench Press: 3 x 12"
    return len(PLAN_WORDS.findall(text)) >= 3 or rx_lines >= 2


def _clean(s):
    return re.sub(r'\s+', ' ', re.sub(r'[*_`#]', '', s or '')).strip()


def exercise_names(text, limit=16):
    m = TAG.search(text or '')
    if m:
        names = [_clean(n) for n in m.group(1).split('|')]
    else:
        names = []
        for line in strip_tag(text).split('\n'):
            b = BULLET.match(line)
            if b and PRESCRIPTION.search(b.group(1)):
                names.append(_clean(re.split(r'\s*[:–—]\s*|\s+-\s+|\s*\(', b.group(1))[0]))
    out, seen = [], set()
    for n in names:
        k = n.lower()
        if 2 < len(n) <= 40 and k not in seen:
            seen.add(k)
            out.append(n)
    return out[:limit]


def gist(text):
    """One compact line describing a plan: its day headings and its exercise names."""
    heads = [_clean(l) for l in strip_tag(text).split('\n') if l.lstrip().startswith('#')][:8]
    names = exercise_names(text)
    parts = []
    if heads:
        parts.append('Sections: ' + '; '.join(heads))
    if names:
        parts.append('Exercises: ' + ', '.join(names))
    if not parts:   # a meal plan or a free-form plan: keep the first lines
        parts.append(_clean(' '.join(strip_tag(text).split('\n')[:4])))
    return ' | '.join(parts)[:500]


def remember(mongo, user_id, ask, reply):
    """Called after a finished coach reply. Only plans are remembered (not small talk)."""
    try:
        if not looks_like_plan(reply):
            return
        entry = {'t': utcnow(), 'ask': _clean(ask)[:160], 'gist': gist(reply)}
        user = mongo.db.users.find_one({'_id': ObjectId(user_id)}, {'coach_memory': 1}) or {}
        last = (user.get('coach_memory') or [None])[-1]
        if last and last.get('gist') == entry['gist']:
            return
        mongo.db.users.update_one({'_id': ObjectId(user_id)},
                                  {'$push': {'coach_memory': {'$each': [entry], '$slice': -MAX_ENTRIES}}})
    except Exception:
        pass   # memory is a bonus; a failure must never break the chat


def clear(mongo, user_id):
    mongo.db.users.update_one({'_id': ObjectId(user_id)}, {'$unset': {'coach_memory': ''}})


def prompt_block(entries):
    """Text added to the system prompt (empty when nothing is remembered yet)."""
    rows = []
    for e in (entries or [])[-MAX_ENTRIES:]:
        when = e.get('t')
        day = when.strftime('%d %b') if hasattr(when, 'strftime') else ''
        ask = ('asked "' + e['ask'] + '" -> ') if e.get('ask') else ''
        rows.append('- ' + day + ': ' + ask + str(e.get('gist', '')))
    if not rows:
        return ''
    return ('\nPLANS YOU ALREADY GAVE THIS MEMBER (oldest first):\n' + '\n'.join(rows) + '\n'
            'When they ask for a new or another plan, BUILD ON these: keep what suited them, progress it (more sets, reps, '
            'load or time), rotate exercises sensibly, and say briefly what you changed. Never hand out an unrelated random '
            'plan, and do not contradict your earlier advice. If they refer to an earlier plan, use these notes.\n')
