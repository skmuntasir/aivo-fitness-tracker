"""Shared helpers: UTC-safe timestamps, timezone handling, tiny rate limiter."""
import time
import threading
from datetime import datetime, timezone, timedelta
from functools import wraps
from flask import request, jsonify

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None


def utcnow():
    """Naive UTC datetime (what we store in Mongo)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso_utc(dt):
    """Serialize a (naive-UTC or aware) datetime as ISO-8601 with a trailing 'Z'.

    Without the 'Z' browsers parse the string as *local* time, which is why
    message/post times used to be shifted by the user's UTC offset.
    """
    if not dt:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat(timespec='milliseconds') + 'Z'


def parse_client_dt(value):
    """Parse an ISO string from the browser (with or without Z) -> naive UTC."""
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def valid_tz(name):
    """Return an IANA tz name if valid, else 'UTC'."""
    if not name or ZoneInfo is None:
        return 'UTC'
    try:
        ZoneInfo(str(name))
        return str(name)
    except Exception:
        return 'UTC'


def request_tz():
    return valid_tz(request.args.get('tz') or request.headers.get('X-Timezone'))


def local_date(dt_utc_naive, tz_name):
    """Local calendar date (YYYY-MM-DD) for a naive-UTC datetime."""
    if ZoneInfo is None or tz_name == 'UTC':
        return dt_utc_naive.date()
    return dt_utc_naive.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(tz_name)).date()


def local_today(tz_name):
    return local_date(utcnow(), tz_name)


def streak_from_days(days, today):
    """Consecutive active days ending today (or yesterday: not having trained *yet* today
    must not reset a running streak). `days` is a set of datetime.date."""
    d = today
    if d not in days:
        d = d - timedelta(days=1)
    n = 0
    while d in days:
        n += 1
        d = d - timedelta(days=1)
    return n


def _active_days(user_id, tz_name, since=None):
    """Set of LOCAL calendar dates on which the user logged at least one workout."""
    from .extensions import mongo
    query = {'user_id': str(user_id)}
    if since is not None:
        query['start_time'] = {'$gte': since}
    return {local_date(w['start_time'], tz_name)
            for w in mongo.db.workouts.find(query, {'start_time': 1, '_id': 0})
            if w.get('start_time')}


def compute_streak(user_id, tz_name):
    """THE source of truth for a user's streak, derived from their real workout records.

    Same rule as the activity heatmap, so every screen (Home, heatmap, workout-complete popup,
    leaderboard, profile, progress) shows the same number. Looks back 45 days first and only
    widens the window if the streak actually reaches the edge of it.
    Returns (streak, last_active_date_or_None).
    """
    today = local_today(tz_name)
    for lookback in (45, 400, None):
        since = local_midnight_utc(today - timedelta(days=lookback), tz_name) if lookback else None
        days = _active_days(user_id, tz_name, since)
        streak = streak_from_days(days, today)
        edge_reached = lookback is not None and streak >= lookback - 1
        if not edge_reached:
            return streak, (max(days) if days else None)
    return streak, (max(days) if days else None)


def effective_streak(user, tz_name, persist=True):
    """Streak for a user document, always derived from the workouts collection.

    The stored `streak` field used to be incremented/reset by hand in /workouts/complete and read
    everywhere else, so it drifted from what the heatmap showed (legacy users without
    `last_workout_date`, timezone changes, back-dated sessions...). It is now just a cache that
    gets repaired whenever it is read.
    """
    from .extensions import mongo
    uid = user.get('_id')
    if uid is None:
        return int(user.get('streak', 0) or 0)
    try:
        streak, last = compute_streak(uid, tz_name)
    except Exception:
        return int(user.get('streak', 0) or 0)

    if persist:
        fields = {}
        if int(user.get('streak', 0) or 0) != streak:
            fields['streak'] = streak
        last_str = last.isoformat() if last else None
        if last_str and user.get('last_workout_date') != last_str:
            fields['last_workout_date'] = last_str
        if tz_name and user.get('tz') != tz_name:
            fields['tz'] = tz_name
        if fields:
            try:
                mongo.db.users.update_one({'_id': uid}, {'$set': fields})
            except Exception:
                pass
    return streak


def streaks_for_users(users, default_tz):
    """Batch version for the leaderboard: ONE workouts query for all listed users, each user
    evaluated in their own timezone (stored on their profile), falling back to `default_tz`."""
    from .extensions import mongo
    if not users:
        return {}
    tz_of = {str(u['_id']): valid_tz(u.get('tz') or default_tz) for u in users}
    horizon = utcnow() - timedelta(days=402)
    days_by_user = {uid: set() for uid in tz_of}
    for w in mongo.db.workouts.find({'user_id': {'$in': list(tz_of)}, 'start_time': {'$gte': horizon}},
                                    {'user_id': 1, 'start_time': 1, '_id': 0}):
        uid = w.get('user_id')
        if uid in days_by_user and w.get('start_time'):
            days_by_user[uid].add(local_date(w['start_time'], tz_of[uid]))
    out = {}
    for uid, days in days_by_user.items():
        tz = tz_of[uid]
        n = streak_from_days(days, local_today(tz))
        out[uid] = n if n < 395 else compute_streak(uid, tz)[0]   # very long streaks: exact recount
    return out


# ── Minimal in-memory rate limiter (per IP + key). Fine for a single process. ──
_hits = {}
_lock = threading.Lock()


def rate_limit(key, limit, per_seconds):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            ident = f"{key}:{request.headers.get('X-Forwarded-For', request.remote_addr)}"
            now = time.time()
            with _lock:
                q = [t for t in _hits.get(ident, []) if now - t < per_seconds]
                if len(q) >= limit:
                    return jsonify(success=False, message='Too many requests. Please slow down.'), 429
                q.append(now)
                _hits[ident] = q
            return fn(*a, **kw)
        return wrapper
    return deco


def local_midnight_utc(day, tz_name):
    """Naive-UTC datetime for 00:00 local time on `day` (a date)."""
    from datetime import time as _time
    if ZoneInfo is None or tz_name == 'UTC':
        return datetime.combine(day, _time())
    return (datetime.combine(day, _time(), tzinfo=ZoneInfo(tz_name))
            .astimezone(timezone.utc).replace(tzinfo=None))
