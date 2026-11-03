"""Demo sandbox - one private, self-resetting copy of the demo world PER VISITOR.

Three public demo accounts (shown as clickable chips on the login page):

    admin@gmail.com  / Admin@123   demo admin
    user1@gmail.com  / User@123    demo member
    user2@gmail.com  / User@234    demo member

How isolation works
-------------------
Every route reads and writes through ``mongo.db``. For a demo session ``mongo.db`` is transparently swapped for
a view of the SAME database whose collections are prefixed ``demo_`` (``users`` -> ``demo_users`` ...), and on
top of that every query / write is pinned to ONE sandbox by a hidden ``_ds`` (demo session) field. So, without
touching a single route:

  * demo accounts live ONLY in ``demo_*`` collections - real members never see them;
  * every visitor gets their OWN sandbox (own demo admin, own two demo members, own posts, settings ...). Any
    number of recruiters can use the demo at the same time and never see or disturb each other;
  * the demo admin has the full admin console, but every change lands in that visitor's sandbox only;
  * a sandbox is rebuilt from scratch (suspended / deleted / edited demo members and everything else come back)
      - when the visitor signs out of a demo account,
      - when a demo admin signs in,
      - automatically 30 minutes after the sandbox was (re)built - checked on the next request, so nothing has
        to be running in the background for it to work.

A request is "demo" when it carries a JWT with ``demo: true`` and the sandbox id ``ds`` (both issued only at
demo login), or is the login call for one of the three demo emails. The browser remembers its sandbox id and
sends it with the next demo login (``X-Demo-Session``), so the demo admin and the demo members opened by the
same visitor share one world; a browser without one simply gets a new sandbox.
"""
import hashlib
import re
import secrets
import threading
import time
from datetime import timedelta

from bson import ObjectId
from flask import g, has_request_context, jsonify, request
from pymongo.errors import DuplicateKeyError
from werkzeug.security import generate_password_hash

from .utils import utcnow

PREFIX = 'demo_'

# collection names used by the app (kept explicit so a reset wipes exactly these)
COLLECTIONS = ('users', 'workouts', 'posts', 'messages', 'friend_requests', 'reports', 'announcements',
               'audit_logs', 'ai_usage', 'workout_sessions', 'streak_freezes', 'challenges', 'saved_plans', 'settings',
               'leaderboard_seasons')

SANDBOXES = PREFIX + 'sandboxes'          # bookkeeping: one row per live sandbox (never scoped, never shown to routes)
SESSION_TTL = timedelta(minutes=30)       # a sandbox is rebuilt this long after it was (re)built
IDLE_GRACE = timedelta(minutes=5)         # abandoned sandboxes are deleted this long after their TTL
MAX_SANDBOXES = 2000                      # hard ceiling; the least recently used ones are dropped first
NEW_SANDBOX_LIMIT = (40, 600)             # at most 40 new sandboxes per IP per 10 minutes
SID_RE = re.compile(r'^[0-9a-f]{16}$')
SID_HEADER = 'X-Demo-Session'
HIDE = {'_ds': 0}                         # keeps the hidden scope field out of every result

# (key, id suffix) - a demo account's ObjectId is built from the sandbox id, so ids never collide between sandboxes
DEMO_ACCOUNTS = (
    {'code': 'a1', 'email': 'admin@gmail.com', 'password': 'Admin@123', 'full_name': 'Demo Admin',
     'username': 'demoadmin', 'label': 'Demo admin', 'is_admin': True},
    {'code': 'b1', 'email': 'user1@gmail.com', 'password': 'User@123', 'full_name': 'Demo User One',
     'username': 'demouser1', 'label': 'Demo user 1', 'is_admin': False},
    {'code': 'b2', 'email': 'user2@gmail.com', 'password': 'User@234', 'full_name': 'Demo User Two',
     'username': 'demouser2', 'label': 'Demo user 2', 'is_admin': False},
)
DEMO_EMAILS = frozenset(a['email'] for a in DEMO_ACCOUNTS)
DEMO_ADMIN_EMAIL = 'admin@gmail.com'


def account_id(sid, code):
    """ObjectId of a demo account inside sandbox ``sid`` ('d3' + 16 hex sandbox id + '0000' + 2 hex account code)."""
    return ObjectId(f'd3{sid}0000{code}')


# ── request scope ───────────────────────────────────────────────────────────
def current_sid():
    """Sandbox id of the current request / socket event, or None for the real site."""
    try:
        return (g.get('demo_sid') or None) if has_request_context() else None
    except Exception:
        return None


def is_demo():
    """True when the current request / socket event belongs to a demo sandbox."""
    return current_sid() is not None


def set_demo(sid=None):
    """Pin the current context to sandbox ``sid`` (a string) - or back to the real site (None / False)."""
    g.demo_sid = sid if isinstance(sid, str) and SID_RE.match(sid) else None


def is_demo_email(email):
    return str(email or '').strip().lower() in DEMO_EMAILS


def _filter(flt, sid, name):
    f = dict(flt or {})
    if name == 'settings' and f.get('_id') == 'global':
        f['_id'] = f'global:{sid}'        # the one fixed-id document must not collide between sandboxes
    f['_ds'] = sid
    return f


def _projection(proj):
    """Add the hidden-field exclusion unless that would make the projection invalid."""
    if not proj:
        return dict(HIDE)
    if isinstance(proj, (list, tuple, set)):
        return proj
    if any(not isinstance(v, (int, bool)) for v in proj.values()):
        return proj
    rest = [v for k, v in proj.items() if k != '_id']
    if rest and any(rest):
        return proj                       # inclusion projection: _ds is not in it anyway
    if not rest and proj.get('_id'):
        return proj
    return {**proj, **HIDE}


class _ScopedCollection:
    """A collection pinned to one sandbox: every read / write only sees and touches documents stamped with its ``_ds``."""

    _BLOCKED = frozenset({'bulk_write', 'drop', 'rename', 'watch', 'with_options', 'aggregate_raw_batches',
                          'find_raw_batches', 'database'})

    def __init__(self, coll, sid, name):
        object.__setattr__(self, '_c', coll)
        object.__setattr__(self, '_sid', sid)
        object.__setattr__(self, '_n', name)

    def __getattr__(self, name):
        if name.startswith('_') or name in self._BLOCKED:
            raise AttributeError(name)
        return getattr(self._c, name)     # name, create_index ...

    def _f(self, flt):
        return _filter(flt, self._sid, self._n)

    # reads
    def find(self, filter=None, projection=None, *a, **kw):
        return self._c.find(self._f(filter), _projection(projection), *a, **kw)

    def find_one(self, filter=None, projection=None, *a, **kw):
        return self._c.find_one(self._f(filter), _projection(projection), *a, **kw)

    def count_documents(self, filter=None, *a, **kw):
        return self._c.count_documents(self._f(filter), *a, **kw)

    def estimated_document_count(self, *a, **kw):
        return self._c.count_documents({'_ds': self._sid})   # the metadata count would include every sandbox

    def distinct(self, key, filter=None, *a, **kw):
        return self._c.distinct(key, self._f(filter), *a, **kw)

    def aggregate(self, pipeline, *a, **kw):
        return self._c.aggregate([{'$match': {'_ds': self._sid}}] + list(pipeline), *a, **kw)

    # writes
    def insert_one(self, doc, *a, **kw):
        stamped = dict(doc, _ds=self._sid)
        res = self._c.insert_one(stamped, *a, **kw)
        doc.setdefault('_id', stamped['_id'])
        return res

    def insert_many(self, docs, *a, **kw):
        docs = list(docs)
        stamped = [dict(d, _ds=self._sid) for d in docs]
        res = self._c.insert_many(stamped, *a, **kw)
        for orig, new in zip(docs, stamped):
            orig.setdefault('_id', new['_id'])
        return res

    def update_one(self, filter, update, *a, **kw):
        return self._c.update_one(self._f(filter), update, *a, **kw)

    def update_many(self, filter, update, *a, **kw):
        return self._c.update_many(self._f(filter), update, *a, **kw)

    def replace_one(self, filter, replacement, *a, **kw):
        return self._c.replace_one(self._f(filter), dict(replacement, _ds=self._sid), *a, **kw)

    def delete_one(self, filter, *a, **kw):
        return self._c.delete_one(self._f(filter), *a, **kw)

    def delete_many(self, filter, *a, **kw):
        return self._c.delete_many(self._f(filter), *a, **kw)

    def find_one_and_delete(self, filter, *a, **kw):
        return self._c.find_one_and_delete(self._f(filter), *a, **kw)

    def find_one_and_update(self, filter, update, *a, **kw):
        return self._c.find_one_and_update(self._f(filter), update, *a, **kw)


class DemoDB:
    """Same API as a pymongo Database, but every collection is the ``demo_`` twin of the real one, pinned to sandbox ``sid``."""

    def __init__(self, real, sid):
        object.__setattr__(self, '_real', real)
        object.__setattr__(self, '_sid', sid)

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        return _ScopedCollection(self._real[PREFIX + name], self._sid, name)

    def __getitem__(self, name):
        return _ScopedCollection(self._real[PREFIX + name], self._sid, name)

    @property
    def name(self):
        return self._real.name

    def command(self, *a, **kw):
        return self._real.command(*a, **kw)


# ── seed ────────────────────────────────────────────────────────────────────
def _profile(acc, sid, **extra):
    now = utcnow()
    doc = {
        '_id': account_id(sid, acc['code']), 'email': acc['email'], 'password': generate_password_hash(acc['password']),
        'full_name': acc['full_name'], 'username': acc['username'], 'age': 28,
        'gender': 'male', 'weight': 74, 'height': 176.0, 'fitness_level': 'Intermediate',
        'fitness_goals': ['Build muscle', 'Improve endurance'], 'medical_conditions': '',
        'preferred_units': 'metric', 'target_weight': 72, 'profile_picture': None, 'friends': [],
        'last_active': now, 'created_at': now - timedelta(days=60), 'is_admin': acc['is_admin'],
        'is_active': True, 'profile_complete': True, 'points': 0, 'token_version': 0, 'is_demo': True,
    }
    doc.update(extra)
    return doc


def _demo_workouts(sid, user_id, days_back_pairs):
    """[(days_ago, minutes, activity)] -> workout docs (same shape /workouts/complete writes)."""
    now = utcnow().replace(hour=7, minute=0, second=0, microsecond=0)
    out = []
    for i, (ago, minutes, activity) in enumerate(days_back_pairs):
        start = now - timedelta(days=ago)
        out.append({'_id': f'demo-{sid[:8]}-{str(user_id)[-2:]}-{i}', 'user_id': str(user_id), 'activity_type': activity,
                    'duration': minutes * 60, 'points': minutes,   # 1 minute = 1 point, like /workouts/complete
                    'start_time': start, 'end_time': start + timedelta(minutes=minutes)})
    return out


# (days ago, minutes, activity) - activity names are the ones the workout timer offers (data/workouts.js)
_USER1_WORKOUTS = [(0, 32, 'Treadmill Run'), (1, 45, 'Bench Press'), (2, 20, 'Stationary Bike'),
                   (3, 55, 'Back Squat'), (5, 12, 'Yoga Flow'), (6, 40, 'Treadmill Run'),
                   (9, 25, 'Stationary Bike'), (12, 8, 'Brisk Walk')]
_USER2_WORKOUTS = [(0, 18, 'Yoga Flow'), (1, 30, 'Brisk Walk'), (4, 6, 'Stretching'), (7, 42, 'Jog')]
_total_points = lambda spec: sum(minutes for _, minutes, _ in spec)   # a member's points = the sum of their workouts


def _extras(sid):
    a, u1, u2 = (account_id(sid, c) for c in ('a1', 'b1', 'b2'))
    return {
        a: {'points': 0, 'full_name': 'Demo Admin'},
        u1: {'points': _total_points(_USER1_WORKOUTS), 'friends': [u2], 'fitness_level': 'Intermediate',
             'workout_prefs': {'custom': {'gym': ['Cable Crossover'], 'home': ['Pillow Pilates']},
                               'shown': {'gym': None, 'home': None}}},
        u2: {'points': _total_points(_USER2_WORKOUTS), 'friends': [u1], 'gender': 'female', 'weight': 62, 'height': 165.0,
             'fitness_level': 'Beginner', 'fitness_goals': ['Lose weight'], 'target_weight': 58},
    }


def _seed_user(acc, sid):
    return _profile(acc, sid, **_extras(sid).get(account_id(sid, acc['code']), {}))


def ensure_demo_account(email):
    """Sign-in safety net: if a demo account was deleted (e.g. by the demo admin who never signed out), bring back
    just that account so the three demo logins always work. Runs inside the demo scope (mongo.db = this sandbox)."""
    from .extensions import mongo
    email = str(email or '').strip().lower()
    sid = current_sid()
    acc = next((a for a in DEMO_ACCOUNTS if a['email'] == email), None)
    if not acc or not sid:
        return
    try:
        if not mongo.db.users.find_one({'$or': [{'_id': account_id(sid, acc['code'])}, {'email': email}]}, {'_id': 1}):
            mongo.db.users.insert_one(_seed_user(acc, sid))
            from .runtime import invalidate_user
            invalidate_user(account_id(sid, acc['code']))
    except Exception as exc:
        print(f'[demo] could not restore {email}: {str(exc)[:100]}')


def _seed_world(sid, db):
    """Fill sandbox ``sid`` (through its scoped ``db``) with the pristine demo data."""
    u1, u2 = account_id(sid, 'b1'), account_id(sid, 'b2')
    db.users.insert_many([_seed_user(a, sid) for a in DEMO_ACCOUNTS])
    db.workouts.insert_many(_demo_workouts(sid, u1, _USER1_WORKOUTS) + _demo_workouts(sid, u2, _USER2_WORKOUTS))

    now = utcnow()
    posts = db.posts.insert_many([
        {'author': u1, 'content': 'Morning 5k done. Feeling great, anyone up for a weekend run?',
         'likes': [u2], 'comments': [], 'createdAt': now - timedelta(hours=5)},
        {'author': u2, 'content': 'Day 4 of my yoga streak. Small steps add up.',
         'likes': [u1], 'comments': [], 'createdAt': now - timedelta(hours=26)},
        {'author': u2, 'content': 'Huge supplement sale, message me for a discount code!',
         'likes': [], 'comments': [], 'createdAt': now - timedelta(hours=40)},
    ])
    # something to look at in every part of the demo: an open report for the moderation queue, a live announcement
    # (shows as the banner for demo members and in the admin console) and a saved coach plan on demo user 1
    db.reports.insert_one({
        'post_id': posts.inserted_ids[2], 'post_author': u2, 'reporter_id': u1, 'reason': 'spam',
        'details': 'Looks like an advert.', 'post_snippet': 'Huge supplement sale, message me for a discount code!',
        'status': 'open', 'created_at': now - timedelta(hours=30)})
    db.announcements.insert_one({
        'title': 'Welcome to the Aivo demo',
        'body': 'Everything you do here stays in your own private demo and resets when you sign out or after 30 minutes.',
        'type': 'info', 'active': True, 'starts_at': None, 'ends_at': None, 'created_at': now - timedelta(hours=2)})
    plan = ('## Push day\n- Bench Press: 3 x 10\n- Shoulder Press: 3 x 10\n- Tricep Pushdown: 3 x 12\n'
            '- Plank: 3 x 45 sec\n\nWarm up 5 minutes first, workout with good form. Tip: rest 60-90 seconds between sets.')
    db.saved_plans.insert_one({
        '_id': f'demo-plan-{sid[:8]}', 'user_id': str(u1), 'kind': 'workout', 'title': 'Push day', 'content': plan,
        'digest': hashlib.sha1(plan.encode('utf-8')).hexdigest(), 'created_at': now - timedelta(days=1)})
    db.messages.insert_one({'sender': u2, 'receiver': u1, 'timestamp': now - timedelta(hours=3),
                            'message': 'Nice run today! Want to train together this weekend?', 'read': False})


def ensure_demo_indexes(db):
    specs = [('users', [('email', 1), ('_ds', 1)], {'unique': True}),     # unique per sandbox, not globally
             ('users', 'username', {}), ('users', [('points', -1)], {}),
             ('workouts', [('user_id', 1), ('start_time', -1)], {}),
             ('messages', [('sender', 1), ('receiver', 1), ('timestamp', -1)], {}),
             ('posts', [('author', 1), ('createdAt', -1)], {}),
             ('streak_freezes', [('user_id', 1), ('date', 1)], {'unique': True})]
    specs += [(name, '_ds', {}) for name in COLLECTIONS]                    # every query is pinned to one sandbox
    try:
        db[PREFIX + 'users'].drop_index('email_1')                          # the old shared-world unique index
    except Exception:
        pass
    for coll, keys, opts in specs:
        try:
            db[PREFIX + coll].create_index(keys, **opts)
        except Exception as exc:
            print(f'[demo] index skipped {coll}: {str(exc)[:80]}')
    try:
        db[SANDBOXES].create_index('last_seen')
    except Exception:
        pass


# ── sandbox lifecycle ───────────────────────────────────────────────────────
_STRIPES = tuple(threading.RLock() for _ in range(64))   # one lock per sandbox id bucket (no unbounded dict)
_known = {}                                              # sid -> (started_at, checked monotonic): skips a DB read per request
_KNOWN_FOR = 10.0                                        # seconds a "this sandbox is fresh" answer is trusted
_TOUCH_EVERY = timedelta(seconds=60)                     # how often last_seen is written
_new_hits = {}                                           # ip -> [timestamps] of sandbox creations
_hits_lock = threading.Lock()
_last_sweep = [0.0]


def _lock_for(sid):
    return _STRIPES[int(sid[:8], 16) % len(_STRIPES)]


def new_sid():
    return secrets.token_hex(8)


def _real():
    from .extensions import mongo
    return mongo.real_db


def _drop_world(real, sid):
    for name in COLLECTIONS:
        real[PREFIX + name].delete_many({'_ds': sid})


def _remove_account(db, uid):
    """Same clean-up as the admin 'delete user' action, for a demo account that must stay deleted."""
    suid = str(uid)
    post_ids = [p['_id'] for p in db.posts.find({'author': uid}, {'_id': 1})]
    for coll, flt in (('workouts', {'user_id': suid}), ('workout_sessions', {'_id': suid}), ('streak_freezes', {'user_id': suid}),
                      ('saved_plans', {'user_id': suid}), ('challenges', {'$or': [{'challenger': suid}, {'opponent': suid}]}),
                      ('posts', {'author': uid}), ('messages', {'$or': [{'sender': uid}, {'receiver': uid}]}),
                      ('friend_requests', {'$or': [{'sender': uid}, {'receiver': uid}]}),
                      ('reports', {'$or': [{'reporter_id': uid}, {'post_id': {'$in': post_ids}}]}), ('ai_usage', {'user_id': suid})):
        db[coll].delete_many(flt)
    db.posts.update_many({}, {'$pull': {'likes': uid, 'comments': {'user': suid}}})
    db.users.update_many({'friends': uid}, {'$pull': {'friends': uid}})
    db.users.delete_one({'_id': uid})


def note_deleted(email):
    """Remember that the visitor's demo admin deleted a demo account: it stays deleted for 30 minutes from now,
    even across sign-outs (they rebuild the demo but keep it deleted)."""
    sid, email = current_sid(), str(email or '').strip().lower()
    acc = next((a for a in DEMO_ACCOUNTS if a['email'] == email), None)
    if sid and acc:
        _real()[SANDBOXES].update_one({'_id': sid}, {'$set': {f"deleted.{acc['code']}": utcnow()}})


def _rebuild(sid, keep_deleted=False):
    """Wipe sandbox ``sid`` and seed it again. Caller holds the sandbox lock. With ``keep_deleted`` the demo accounts
    deleted less than 30 minutes ago stay deleted; otherwise everything comes back."""
    from .runtime import invalidate_user, invalidate_settings
    real = _real()
    row = real[SANDBOXES].find_one({'_id': sid}, {'deleted': 1}) or {}
    now = utcnow()
    still_deleted = {code: at for code, at in (row.get('deleted') or {}).items() if keep_deleted and now - at <= SESSION_TTL}
    old_ids = [str(u['_id']) for u in real[PREFIX + 'users'].find({'_ds': sid}, {'_id': 1})]
    for attempt in (1, 2):
        _drop_world(real, sid)
        try:
            _seed_world(sid, DemoDB(real, sid))
            break
        except DuplicateKeyError:      # another worker rebuilt it at the same moment: wipe and go again
            if attempt == 2:
                raise
    for code in still_deleted:
        _remove_account(DemoDB(real, sid), account_id(sid, code))
    now = utcnow()
    real[SANDBOXES].update_one({'_id': sid}, {'$set': {'started_at': now, 'last_seen': now, 'deleted': still_deleted}}, upsert=True)
    _known[sid] = (now, time.monotonic())
    for uid in old_ids + [str(account_id(sid, a['code'])) for a in DEMO_ACCOUNTS]:
        invalidate_user(uid)           # drop cached suspended / token-version state
    invalidate_settings(sid)


def _creation_allowed():
    """Cheap brake against someone spamming the login endpoint to mass-create sandboxes."""
    limit, per = NEW_SANDBOX_LIMIT
    ident = (request.headers.get('X-Forwarded-For') or request.remote_addr or '').split(',')[0].strip()
    now = time.time()
    with _hits_lock:
        q = [t for t in _new_hits.get(ident, []) if now - t < per]
        if len(q) >= limit:
            _new_hits[ident] = q
            return False
        q.append(now)
        _new_hits[ident] = q
        if len(_new_hits) > 5000:
            for k in [k for k, v in _new_hits.items() if not v or now - v[-1] > per]:
                _new_hits.pop(k, None)
    return True


def ensure_session(sid, force=False):
    """Make sure sandbox ``sid`` exists and is younger than 30 minutes; otherwise rebuild it pristine.
    Returns True when it was (re)built. ``force`` rebuilds regardless (logout / demo-admin sign-in / delete account)."""
    now = utcnow()
    if not force:
        hit = _known.get(sid)
        if hit and time.monotonic() - hit[1] < _KNOWN_FOR and now - hit[0] <= SESSION_TTL:
            return False
    real = _real()
    row = None if force else real[SANDBOXES].find_one({'_id': sid})
    if row and now - row['started_at'] <= SESSION_TTL:
        deletion_over = any(now - at > SESSION_TTL for at in (row.get('deleted') or {}).values())
        if not deletion_over:
            _known[sid] = (row['started_at'], time.monotonic())
            if now - row.get('last_seen', now) > _TOUCH_EVERY:
                real[SANDBOXES].update_one({'_id': sid}, {'$set': {'last_seen': now}})
            return False
        force = True   # a deleted demo account's 30 minutes are up: bring it back
    if not force and row is None:
        sweep_if_due(real)   # a brand-new sandbox: first tidy up abandoned ones (outside our lock)
    with _lock_for(sid):
        row = None if force else real[SANDBOXES].find_one({'_id': sid})
        if row and utcnow() - row['started_at'] <= SESSION_TTL:   # a concurrent request rebuilt it while we waited
            return False
        _rebuild(sid, keep_deleted=force)
    if len(_known) > 5000:
        _known.clear()
    return True


def minutes_until_reset():
    """Whole minutes (at least 1) until the current visitor's sandbox rebuilds itself."""
    try:
        row = _real()[SANDBOXES].find_one({'_id': current_sid()}, {'started_at': 1})
        left = SESSION_TTL - (utcnow() - row['started_at'])
        return max(1, int(left.total_seconds() // 60) + 1)
    except Exception:
        return int(SESSION_TTL.total_seconds() // 60)


def deleted_account_message():
    return f'This demo account was deleted. It returns automatically in about {minutes_until_reset()} min.'


def reserved_account_message():
    return f'That demo account can\'t be created yet. Please wait about {minutes_until_reset()} min for the demo to reset.'


def reset_current_session():
    """Put the CURRENT visitor's demo world back to its original state (everything else is untouched)."""
    sid = current_sid()
    if not sid:
        return
    try:
        ensure_session(sid, force=True)
    except Exception as exc:
        print(f'[demo] reset failed: {str(exc)[:100]}')


restore_demo_after_admin = reset_current_session   # name used by the auth routes (logout / demo-admin sign-in / delete account)


# ── cleanup of abandoned sandboxes ──────────────────────────────────────────
def cleanup_idle(real=None, limit=100):
    """Delete sandboxes nobody has touched for 35+ minutes (a returning visitor just gets a fresh one rebuilt)."""
    real = real if real is not None else _real()
    sb = real[SANDBOXES]
    cutoff = utcnow() - SESSION_TTL - IDLE_GRACE
    removed = 0
    for row in list(sb.find({'last_seen': {'$lt': cutoff}}, {'_id': 1}).limit(limit)):
        sid = row['_id']
        with _lock_for(sid):
            if sb.delete_one({'_id': sid, 'last_seen': {'$lt': cutoff}}).deleted_count:   # still idle: it's ours to remove
                _drop_world(real, sid)
                _known.pop(sid, None)
                removed += 1
    return removed


def _evict_oldest(real, count=50):
    sb = real[SANDBOXES]
    for row in list(sb.find({}, {'_id': 1}).sort('last_seen', 1).limit(count)):
        with _lock_for(row['_id']):
            sb.delete_one({'_id': row['_id']})
            _drop_world(real, row['_id'])
            _known.pop(row['_id'], None)


def sweep_if_due(real=None, every=60.0):
    """Throttled cleanup, run whenever a brand-new sandbox is about to be created."""
    now = time.monotonic()
    if now - _last_sweep[0] < every:
        return
    _last_sweep[0] = now
    real = real if real is not None else _real()
    try:
        cleanup_idle(real)
        if real[SANDBOXES].estimated_document_count() >= MAX_SANDBOXES:
            _evict_oldest(real)
    except Exception as exc:
        print(f'[demo] cleanup skipped: {str(exc)[:100]}')


def start_janitor(interval=300):
    """Background sweep for quiet periods (the lazy 30-minute reset needs no background work; this only frees space)."""
    def loop():
        while True:
            time.sleep(interval)
            try:
                cleanup_idle()
            except Exception as exc:
                print(f'[demo] janitor: {str(exc)[:100]}')
    threading.Thread(target=loop, name='demo-janitor', daemon=True).start()


def seed_demo_if_missing(db=None):
    """Startup: make sure indexes exist, remove data of the old single shared demo world and sweep idle sandboxes.
    Sandboxes themselves are built on demand, the first time a visitor signs in to a demo account."""
    db = db if db is not None else _real()
    try:
        ensure_demo_indexes(db)
        for name in COLLECTIONS:   # documents without a sandbox id belong to the old shared demo world
            db[PREFIX + name].delete_many({'_ds': {'$exists': False}})
        cleanup_idle(db)
    except Exception as exc:
        print(f'[demo] startup skipped: {str(exc)[:100]}')


def demo_public_accounts():
    return [{'label': a['label'], 'email': a['email'], 'password': a['password'],
             'role': 'admin' if a['is_admin'] else 'user'} for a in DEMO_ACCOUNTS]


_LOGIN_PATHS = ('/api/auth/login', '/api/admin/auth/login')


def detect_scope():
    """before_request (registered FIRST): decide whether this request runs in a demo sandbox, and which one."""
    g.demo_sid = None
    path = request.path
    if not path.startswith('/api/'):
        return None
    if path == '/api/auth/register':
        return None   # sign-ups are always real (a stale demo token in the browser must never create demo users)
    sid = None
    if request.method == 'POST' and path in _LOGIN_PATHS:
        if not is_demo_email((request.get_json(silent=True) or {}).get('email')):
            return None
        sent = request.headers.get(SID_HEADER, '')
        sid = sent if SID_RE.match(sent) else None
        if not sid:
            if not _creation_allowed():
                return jsonify(success=False, message='Too many demo sessions started from this network. Please try again in a few minutes.'), 429
            sid = new_sid()
    else:
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            try:
                from flask_jwt_extended import decode_token
                claims = decode_token(auth[7:])
            except Exception:
                return None   # invalid / expired token: the normal auth checks answer it
            if claims.get('demo'):
                sid = claims.get('ds')
                if not isinstance(sid, str) or not SID_RE.match(sid):   # a token from before per-visitor sandboxes
                    return jsonify(success=False, message='Your demo session has ended. Please sign in again.'), 401
    if sid:
        g.demo_sid = sid
        try:
            ensure_session(sid)   # builds the sandbox on first use and rebuilds it 30 minutes after its last rebuild
        except Exception as exc:
            print(f'[demo] sandbox unavailable: {str(exc)[:100]}')
            g.demo_sid = None
            return jsonify(success=False, message='The demo is temporarily unavailable. Please try again.'), 503
    return None


def token_claims(user):
    """Extra JWT claims for a user document: marks demo sessions and pins them to their sandbox."""
    sid = current_sid()
    return {'demo': True, 'ds': sid} if user.get('is_demo') and sid else {}


STALE_SUSPENSION = timedelta(minutes=30)


def restore_if_stale_suspension(user):
    """Safety net: if a demo admin suspended a demo member and walked away without logging out, the member
    must not stay locked out for the visitor. Returns the (possibly restored) user document."""
    from .extensions import mongo
    at = user.get('suspended_at')
    if user.get('is_demo') and user.get('is_active') is False and at and utcnow() - at > STALE_SUSPENSION:
        reset_current_session()
        return mongo.db.users.find_one({'_id': user['_id']}) or user
    return user
