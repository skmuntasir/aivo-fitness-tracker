"""Demo sandbox.

Three public demo accounts (shown as clickable chips on the login page):

    admin@gmail.com  / Admin@123   demo admin
    user1@gmail.com  / User@123    demo member
    user2@gmail.com  / User@234    demo member

How isolation works
-------------------
Every route reads and writes through ``mongo.db``. For a demo session ``mongo.db`` is transparently swapped
for a view of the SAME database whose collections are prefixed ``demo_`` (``users`` -> ``demo_users`` ...).
So, without touching a single route:

  * demo accounts live ONLY in ``demo_*`` collections - real members never see them (leaderboard, friend
    search, community feed, admin lists, dashboard totals ... all read the real collections);
  * demo sessions can ONLY read ``demo_*`` collections - they can't see or reach a real member;
  * the demo admin has the full admin console, but every change lands in ``demo_*`` data, so the real site
    is never affected (suspend / delete / settings / announcements / points / leaderboard reset ...);
  * the demo world is reset (re-seeded) when the demo admin logs out and when a demo admin signs in, so
    suspended / deleted / edited demo members are restored.

A request is "demo" when it carries a JWT with ``demo: true`` (issued only at demo login), or is the login
call for one of the three demo emails.
"""
from datetime import timedelta

from bson import ObjectId
from flask import g, has_request_context, request
from werkzeug.security import generate_password_hash

from .utils import utcnow

PREFIX = 'demo_'

# collection names used by the app (kept explicit so the reset wipes exactly these)
COLLECTIONS = ('users', 'workouts', 'posts', 'messages', 'friend_requests', 'reports', 'announcements',
               'audit_logs', 'ai_usage', 'workout_sessions', 'streak_freezes', 'challenges', 'saved_plans', 'settings',
               'leaderboard_seasons')

ADMIN_ID = ObjectId('d3a0000000000000000000a1')
USER1_ID = ObjectId('d3a0000000000000000000b1')
USER2_ID = ObjectId('d3a0000000000000000000b2')

DEMO_ACCOUNTS = (
    {'id': ADMIN_ID, 'email': 'admin@gmail.com', 'password': 'Admin@123', 'full_name': 'Demo Admin',
     'username': 'demoadmin', 'label': 'Demo admin', 'is_admin': True},
    {'id': USER1_ID, 'email': 'user1@gmail.com', 'password': 'User@123', 'full_name': 'Demo User One',
     'username': 'demouser1', 'label': 'Demo user 1', 'is_admin': False},
    {'id': USER2_ID, 'email': 'user2@gmail.com', 'password': 'User@234', 'full_name': 'Demo User Two',
     'username': 'demouser2', 'label': 'Demo user 2', 'is_admin': False},
)
DEMO_EMAILS = frozenset(a['email'] for a in DEMO_ACCOUNTS)
DEMO_ADMIN_EMAIL = 'admin@gmail.com'


# ── request scope ───────────────────────────────────────────────────────────
def is_demo():
    """True when the current request / socket event belongs to the demo sandbox."""
    try:
        return bool(has_request_context() and g.get('is_demo'))
    except Exception:
        return False


def set_demo(flag=True):
    g.is_demo = bool(flag)


def is_demo_email(email):
    return str(email or '').strip().lower() in DEMO_EMAILS


class DemoDB:
    """Same API as a pymongo Database, but every collection is the ``demo_`` twin of the real one."""

    def __init__(self, real):
        object.__setattr__(self, '_real', real)

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        return self._real[PREFIX + name]

    def __getitem__(self, name):
        return self._real[PREFIX + name]

    @property
    def name(self):
        return self._real.name

    def command(self, *a, **kw):
        return self._real.command(*a, **kw)


# ── seed / reset ────────────────────────────────────────────────────────────
def _profile(acc, **extra):
    now = utcnow()
    doc = {
        '_id': acc['id'], 'email': acc['email'], 'password': generate_password_hash(acc['password']),
        'full_name': acc['full_name'], 'username': acc['username'], 'age': 28,
        'gender': 'male', 'weight': 74, 'height': 176.0, 'fitness_level': 'Intermediate',
        'fitness_goals': ['Build muscle', 'Improve endurance'], 'medical_conditions': '',
        'preferred_units': 'metric', 'target_weight': 72, 'profile_picture': None, 'friends': [],
        'last_active': now, 'created_at': now - timedelta(days=60), 'is_admin': acc['is_admin'],
        'is_active': True, 'profile_complete': True, 'points': 0, 'token_version': 0, 'is_demo': True,
    }
    doc.update(extra)
    return doc


def _demo_workouts(user_id, days_back_pairs):
    """[(days_ago, minutes, activity)] -> workout docs (same shape /workouts/complete writes)."""
    now = utcnow().replace(hour=7, minute=0, second=0, microsecond=0)
    out = []
    for i, (ago, minutes, activity) in enumerate(days_back_pairs):
        start = now - timedelta(days=ago)
        out.append({'_id': f'demo-{str(user_id)[-2:]}-{i}', 'user_id': str(user_id), 'activity_type': activity,
                    'duration': minutes * 60, 'start_time': start, 'end_time': start + timedelta(minutes=minutes)})
    return out


_EXTRAS = {
    ADMIN_ID: {'points': 0, 'full_name': 'Demo Admin'},
    USER1_ID: {'points': 420, 'friends': [USER2_ID], 'fitness_level': 'Intermediate'},
    USER2_ID: {'points': 310, 'friends': [USER1_ID], 'gender': 'female', 'weight': 62, 'height': 165.0,
               'fitness_level': 'Beginner', 'fitness_goals': ['Lose weight'], 'target_weight': 58},
}


def _seed_user(acc):
    return _profile(acc, **_EXTRAS.get(acc['id'], {}))


def ensure_demo_account(email):
    """Sign-in safety net: if a demo account was deleted (e.g. by the demo admin who never signed out), bring back
    just that account so the three demo logins always work. Runs inside the demo scope (mongo.db = demo data)."""
    from .extensions import mongo
    email = str(email or '').strip().lower()
    acc = next((a for a in DEMO_ACCOUNTS if a['email'] == email), None)
    if not acc:
        return
    try:
        if not mongo.db.users.find_one({'$or': [{'_id': acc['id']}, {'email': email}]}, {'_id': 1}):
            mongo.db.users.insert_one(_seed_user(acc))
            from .runtime import invalidate_user
            invalidate_user()
    except Exception as exc:
        print(f'[demo] could not restore {email}: {str(exc)[:100]}')


def reset_demo(db=None):
    """Wipe the whole demo world and rebuild it. Real collections are never touched."""
    if db is None:
        from .extensions import mongo
        db = mongo.real_db
    for name in COLLECTIONS:
        db[PREFIX + name].delete_many({})
    ensure_demo_indexes(db)

    db[PREFIX + 'users'].insert_many([_seed_user(a) for a in DEMO_ACCOUNTS])

    w = _demo_workouts(USER1_ID, [(0, 32, 'Running'), (1, 45, 'Weight Training'), (2, 20, 'Cycling'),
                                  (3, 55, 'Weight Training'), (5, 12, 'Yoga'), (6, 40, 'Running'),
                                  (9, 25, 'Cycling'), (12, 8, 'Walking')])
    w += _demo_workouts(USER2_ID, [(0, 18, 'Yoga'), (1, 30, 'Walking'), (4, 6, 'Yoga'), (7, 42, 'Running')])
    db[PREFIX + 'workouts'].insert_many(w)

    now = utcnow()
    db[PREFIX + 'posts'].insert_many([
        {'author': USER1_ID, 'content': 'Morning 5k done. Feeling great, anyone up for a weekend run?',
         'likes': [USER2_ID], 'comments': [], 'createdAt': now - timedelta(hours=5)},
        {'author': USER2_ID, 'content': 'Day 4 of my yoga streak. Small steps add up.',
         'likes': [USER1_ID], 'comments': [], 'createdAt': now - timedelta(hours=26)},
    ])
    db[PREFIX + 'messages'].insert_one({'sender': USER2_ID, 'receiver': USER1_ID, 'timestamp': now - timedelta(hours=3),
                                        'message': 'Nice run today! Want to train together this weekend?', 'read': False})


def ensure_demo_indexes(db):
    specs = [('users', 'email', {'unique': True}), ('users', 'username', {}), ('users', [('points', -1)], {}),
             ('workouts', [('user_id', 1), ('start_time', -1)], {}),
             ('messages', [('sender', 1), ('receiver', 1), ('timestamp', -1)], {}),
             ('posts', [('author', 1), ('createdAt', -1)], {}),
             ('streak_freezes', [('user_id', 1), ('date', 1)], {'unique': True})]
    for coll, keys, opts in specs:
        try:
            db[PREFIX + coll].create_index(keys, **opts)
        except Exception as exc:
            print(f'[demo] index skipped {coll}: {str(exc)[:80]}')


def seed_demo_if_missing(db=None):
    """Startup: build the demo world once (never wipes an existing one)."""
    if db is None:
        from .extensions import mongo
        db = mongo.real_db
    try:
        if db[PREFIX + 'users'].count_documents({'is_demo': True}) < len(DEMO_ACCOUNTS):
            reset_demo(db)
            print('[demo] demo accounts ready')
    except Exception as exc:
        print(f'[demo] seed skipped: {str(exc)[:100]}')


def restore_demo_after_admin():
    """Called when the demo admin logs out / signs in: puts the demo world back to its pristine state."""
    from .runtime import invalidate_user
    try:
        from .runtime import invalidate_settings
        reset_demo()
        invalidate_user()   # drop cached suspended / token-version state
        invalidate_settings(demo=True)
    except Exception as exc:
        print(f'[demo] reset failed: {str(exc)[:100]}')


def demo_public_accounts():
    return [{'label': a['label'], 'email': a['email'], 'password': a['password'],
             'role': 'admin' if a['is_admin'] else 'user'} for a in DEMO_ACCOUNTS]


def detect_scope():
    """before_request (registered FIRST): decide whether this request runs in the demo sandbox."""
    g.is_demo = False
    path = request.path
    if not path.startswith('/api/'):
        return None
    if path == '/api/auth/register':
        return None   # sign-ups are always real (a stale demo token in the browser must never create demo users)
    if request.method == 'POST' and path in ('/api/auth/login', '/api/admin/auth/login'):
        g.is_demo = is_demo_email((request.get_json(silent=True) or {}).get('email'))
        return None
    auth = request.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        try:
            from flask_jwt_extended import decode_token
            g.is_demo = bool(decode_token(auth[7:]).get('demo'))
        except Exception:
            g.is_demo = False
    return None


def token_claims(user):
    """Extra JWT claims for a user document: marks demo sessions."""
    return {'demo': True} if user.get('is_demo') else {}


STALE_SUSPENSION = timedelta(minutes=30)


def restore_if_stale_suspension(user):
    """Safety net: if a demo admin suspended a demo member and walked away without logging out, the member
    must not stay locked out for visitors. Returns the (possibly restored) user document."""
    from .extensions import mongo
    at = user.get('suspended_at')
    if user.get('is_demo') and user.get('is_active') is False and at and utcnow() - at > STALE_SUSPENSION:
        restore_demo_after_admin()
        return mongo.db.users.find_one({'_id': user['_id']}) or user
    return user
