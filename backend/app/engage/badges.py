"""Badges & achievements. Pure functions of a user's real data, so they can never drift:
nothing is stored, a badge is earned the moment the numbers say so (and a "new badge" is simply
one that appears between the stats before and after a workout)."""
from datetime import timedelta, timezone

from app.extensions import mongo
from app.utils import ZoneInfo, local_date, _frozen_days

# metric -> what the number means. tier only drives the colour in the UI.
BADGES = [
    dict(id='first_workout', name='First Step',       desc='Log your first workout',                 icon='play',     tier='bronze', metric='total',        target=1),
    dict(id='workouts_10',   name='First 10 Workouts', desc='Complete 10 workouts',                  icon='activity', tier='silver', metric='total',        target=10),
    dict(id='workouts_25',   name='Habit Builder',    desc='Complete 25 workouts',                   icon='target',   tier='silver', metric='total',        target=25),
    dict(id='workouts_50',   name='Fifty Club',       desc='Complete 50 workouts',                   icon='award',    tier='gold',   metric='total',        target=50),
    dict(id='streak_3',      name='3-Day Streak',     desc='Train 3 days in a row',                  icon='flame',    tier='bronze', metric='best_streak',  target=3),
    dict(id='streak_7',      name='7-Day Streak',     desc='Train 7 days in a row',                  icon='flame',    tier='silver', metric='best_streak',  target=7),
    dict(id='streak_14',     name='14-Day Streak',    desc='Train 14 days in a row',                 icon='flame',    tier='gold',   metric='best_streak',  target=14),
    dict(id='streak_30',     name='30-Day Streak',    desc='Train 30 days in a row',                 icon='flame',    tier='epic',   metric='best_streak',  target=30),
    dict(id='early_bird',    name='Early Bird',       desc='Start a workout before 7 AM',            icon='sun',      tier='silver', metric='early',        target=1),
    dict(id='night_owl',     name='Night Owl',        desc='Start a workout after 9 PM',             icon='moon',     tier='silver', metric='night',        target=1),
    dict(id='glow_up',       name='Glow Up',          desc='Hold a single session for 10+ minutes',  icon='zap',      tier='gold',   metric='longest_min',  target=10),
    dict(id='hour_power',    name='Hour Power',       desc='Hold a single session for 60+ minutes',  icon='timer',    tier='epic',   metric='longest_min',  target=60),
    dict(id='all_rounder',   name='All-Rounder',      desc='Try 5 different workouts',               icon='sparkles', tier='silver', metric='variety',      target=5),
    dict(id='ten_hours',     name='10 Hours Strong',  desc='Train 10 hours in total',                icon='clock',    tier='gold',   metric='total_min',    target=600),
    dict(id='smart_rest',    name='Smart Recovery',   desc='Use a streak freeze on a rest day',      icon='snow',     tier='bronze', metric='freezes',      target=1),
    dict(id='challenger',    name='Challenger',       desc='Win a friend challenge',                 icon='trophy',   tier='gold',   metric='wins',         target=1),
]


def _local_hour(dt_utc_naive, tz_name):
    if ZoneInfo is None or not tz_name or tz_name == 'UTC':
        return dt_utc_naive.hour
    try:
        return dt_utc_naive.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(tz_name)).hour
    except Exception:
        return dt_utc_naive.hour


def _best_streak(days, frozen):
    """Longest run of training days; frozen days keep the run alive without counting."""
    if not days:
        return 0
    d, last = min(days), max(days)
    run = best = 0
    while d <= last:
        if d in days:
            run += 1
            best = max(best, run)
        elif d not in frozen:
            run = 0
        d += timedelta(days=1)
    return best


def gather_stats(user_id, tz_name):
    from .challenges import settle_due, wins_for
    uid = str(user_id)
    rows = list(mongo.db.workouts.find({'user_id': uid}, {'start_time': 1, 'duration': 1, 'activity_type': 1, 'tz': 1, '_id': 0}))
    days, early, night, longest, total_s, kinds = set(), 0, 0, 0, 0, set()
    for w in rows:
        st = w.get('start_time')
        if not st:
            continue
        dur = int(w.get('duration', 0) or 0)
        days.add(local_date(st, tz_name))
        total_s += dur
        longest = max(longest, dur)
        if w.get('activity_type'):
            kinds.add(w['activity_type'])
        h = _local_hour(st, w.get('tz') or tz_name)
        if 4 <= h < 7:
            early += 1
        if h >= 21 or h < 4:
            night += 1
    frozen = _frozen_days(uid)
    try:
        settle_due(uid)
        wins = wins_for(uid)
    except Exception:
        wins = 0
    return {'total': len(rows), 'best_streak': _best_streak(days, frozen), 'early': early, 'night': night,
            'longest_min': longest // 60, 'variety': len(kinds), 'total_min': total_s // 60,
            'freezes': len(frozen), 'wins': wins}


def evaluate(stats):
    out = []
    for b in BADGES:
        value = int(stats.get(b['metric'], 0) or 0)
        out.append({'id': b['id'], 'name': b['name'], 'desc': b['desc'], 'icon': b['icon'], 'tier': b['tier'],
                    'earned': value >= b['target'], 'progress': min(value, b['target']), 'target': b['target']})
    return out


def earned_ids(badges):
    return {b['id'] for b in badges if b['earned']}
