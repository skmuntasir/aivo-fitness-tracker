"""Smoke test for: streak freeze, badges, friend challenges, saved plans, streaming AI endpoint.
Runs against an in-memory MongoDB (mongomock):

    pip install mongomock
    python tests_engage.py
"""
import os
import json
from datetime import timedelta, datetime

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-engage-tests-0123456789')
os.environ.setdefault('JWT_SECRET_KEY', 'test-jwt-key-for-engage-tests-0123456789ab')
os.environ['GROQ_API_KEY'] = 'test-key'

import mongomock  # noqa: E402
import flask_pymongo  # noqa: E402


def _fake_init_app(self, app, *a, **kw):
    self.cx = mongomock.MongoClient()
    self.db = self.cx['fitness_db']


flask_pymongo.PyMongo.init_app = _fake_init_app

from bson import ObjectId  # noqa: E402
from app import create_app  # noqa: E402
from app.extensions import mongo  # noqa: E402
from app.utils import utcnow  # noqa: E402

app = create_app()
c = app.test_client()
PW = 'Passw0rdX'
REG = {'password': PW, 'age': 30, 'gender': 'male', 'weight': 80, 'height': 180,
       'fitnessLevel': 'Beginner', 'fitnessGoals': ['Lose weight']}
HDR_TZ = {'X-Timezone': 'UTC'}


def H(token):
    return {'Authorization': f'Bearer {token}', **HDR_TZ}


def ok(resp, status=200):
    assert resp.status_code == status, f'{resp.request.method} {resp.request.path} -> {resp.status_code} {resp.get_data(as_text=True)[:300]}'
    return resp.get_json() if resp.is_json else resp


def register(name, email):
    d = ok(c.post('/api/auth/register', json={**REG, 'fullName': name, 'email': email}), 201)
    return d['token'], d['user']['id']


def add_workout(uid, days_ago, minutes=5, hour=12, activity='Push-Ups'):
    start = (utcnow() - timedelta(days=days_ago)).replace(hour=hour, minute=0, second=0, microsecond=0)
    mongo.db.workouts.insert_one({'_id': f'w{uid}{days_ago}{hour}{minutes}', 'user_id': uid, 'start_time': start,
                                  'end_time': start + timedelta(minutes=minutes), 'duration': minutes * 60,
                                  'activity_type': activity, 'tz': 'UTC'})


def befriend(a, b):
    mongo.db.users.update_one({'_id': ObjectId(a)}, {'$addToSet': {'friends': ObjectId(b)}})
    mongo.db.users.update_one({'_id': ObjectId(b)}, {'$addToSet': {'friends': ObjectId(a)}})


def run():
    a_tok, a = register('Ann Streak', 'ann@x.com')
    b_tok, b = register('Ben Rival', 'ben@x.com')
    z_tok, z = register('Zed Stranger', 'zed@x.com')
    befriend(a, b)

    # ── streak freeze ───────────────────────────────────────────────
    d = ok(c.get('/api/streak/freeze', headers=H(a_tok)))
    assert d['can_freeze_today'] is False and d['today_reason'] == 'no_streak', d     # nothing to protect yet
    for n in (3, 2, 1):                                                               # streak ending yesterday
        add_workout(a, n)
    d = ok(c.get('/api/workouts/daily-summary', headers=H(a_tok)))
    assert d['streak'] == 3
    st = ok(c.get('/api/streak/freeze', headers=H(a_tok)))
    assert st['can_freeze_today'] and not st['used_this_week'], st
    d = ok(c.post('/api/streak/freeze', json={'day': 'today'}, headers=H(a_tok)))
    assert d['frozen_today'] and d['streak'] == 3, d
    assert ok(c.post('/api/streak/freeze', json={'day': 'today'}, headers=H(a_tok)), 409)['success'] is False   # one per week
    assert ok(c.get('/api/workouts/daily-summary', headers=H(a_tok)))['frozen_dates'][-1] == st['today']
    # the freeze does not add a day and it survives the next morning: simulate by checking the helper
    from app.utils import streak_from_days, local_today
    t = local_today('UTC')
    days = {t - timedelta(days=n) for n in (1, 2, 3)}
    assert streak_from_days(days, t + timedelta(days=1), {t}) == 3          # tomorrow, no workout today yet
    assert streak_from_days(days, t + timedelta(days=2), {t}) == 0          # two idle days really break it
    ok(c.delete('/api/streak/freeze', headers=H(a_tok)))                     # undo
    assert ok(c.get('/api/streak/freeze', headers=H(a_tok)))['used_this_week'] is False
    # training on a frozen day hands the freeze back
    ok(c.post('/api/streak/freeze', json={'day': 'today'}, headers=H(a_tok)))
    now = utcnow()
    st = ok(c.post('/api/workouts/start', headers=H(a_tok), json={'activity_type': 'Barbell Squat', 'tz': 'UTC'}))
    mongo.db.workout_sessions.update_one({'_id': a}, {'$set': {'start_time': now - timedelta(minutes=10),
                                                               'last_confirmed': now - timedelta(minutes=10)}})
    r = ok(c.post('/api/workouts/complete', headers=H(a_tok), json={
        'session_id': st['session_id'], 'activity_type': 'Barbell Squat', 'tz': 'UTC'}))
    assert r['streak'] == 4, r
    assert ok(c.get('/api/streak/freeze', headers=H(a_tok)))['frozen_today'] is False
    # rescue yesterday: user B trained 3 days ago, 2 days ago, skipped yesterday, trained today
    for n in (3, 2, 0):
        add_workout(b, n)
    sb = ok(c.get('/api/streak/freeze', headers=H(b_tok)))
    assert sb['streak'] == 1 and sb['can_freeze_yesterday'], sb
    d = ok(c.post('/api/streak/freeze', json={'day': 'yesterday'}, headers=H(b_tok)))
    assert d['streak'] == 3, d
    # a day you already trained can't be frozen
    assert ok(c.post('/api/streak/freeze', json={'day': 'today'}, headers=H(b_tok)), 409)['success'] is False

    # ── badges ──────────────────────────────────────────────────────
    new_ids = [x['id'] for x in r['new_badges']]
    assert 'glow_up' in new_ids and 'first_workout' not in new_ids, r['new_badges']   # only what was JUST unlocked
    add_workout(a, 9, hour=5, activity='Plank')
    bd = ok(c.get('/api/badges', headers=H(a_tok)))
    got = {x['id']: x for x in bd['badges']}
    assert got['early_bird']['earned'] and got['streak_3']['earned'] and not got['streak_7']['earned'], got
    assert got['smart_rest']['earned'] is False or got['smart_rest']['earned'] is True
    assert got['streak_7']['progress'] == 4 and got['streak_7']['target'] == 7
    other = ok(c.get(f'/api/badges/user/{a}', headers=H(b_tok)))
    assert other['earned_count'] == bd['earned_count'] and all(x['earned'] for x in other['badges'])
    assert c.get('/api/badges/user/nope', headers=H(b_tok)).status_code == 400

    # ── friend challenges ───────────────────────────────────────────
    assert ok(c.post('/api/challenges', json={'friend_id': z}, headers=H(a_tok)), 403)['success'] is False   # not a friend
    assert ok(c.post('/api/challenges', json={'friend_id': a}, headers=H(a_tok)), 400)['success'] is False   # self
    ok(c.post('/api/challenges', json={'friend_id': b}, headers=H(a_tok)), 201)
    assert ok(c.post('/api/challenges', json={'friend_id': a}, headers=H(b_tok)), 409)['success'] is False   # duplicate (either side)
    lb = ok(c.get('/api/challenges', headers=H(b_tok)))
    assert lb['incoming_count'] == 1 and lb['challenges'][0]['status'] == 'pending' and lb['challenges'][0]['role'] == 'opponent'
    cid = lb['challenges'][0]['id']
    assert ok(c.put(f'/api/challenges/{cid}/accept', headers=H(a_tok)), 404)['success'] is False             # only the friend can accept
    ok(c.put(f'/api/challenges/{cid}/accept', headers=H(b_tok)))
    live = ok(c.get('/api/challenges', headers=H(a_tok)))['challenges'][0]
    assert live['status'] == 'active' and live['friend']['name'] == 'Ben Rival'
    wk_start = mongo.db.challenges.find_one({'_id': cid})['week_start']
    mongo.db.workouts.delete_many({})                       # clean slate inside the challenge week
    for uid, mins in ((a, 12), (b, 30)):
        mongo.db.workouts.insert_one({'_id': f'c{uid}', 'user_id': uid, 'start_time': wk_start + timedelta(hours=3),
                                      'end_time': wk_start + timedelta(hours=4), 'duration': mins * 60, 'activity_type': 'Plank', 'tz': 'UTC'})
    live = ok(c.get('/api/challenges', headers=H(a_tok)))['challenges'][0]
    assert live['me']['seconds'] == 720 and live['friend']['seconds'] == 1800 and live['leader'] == 'friend', live
    assert live['my_share'] == round(720 * 100 / 2520)
    # the week ends -> finished, winner stored, "Challenger" badge for Ben
    mongo.db.challenges.update_one({'_id': cid}, {'$set': {'week_end': utcnow() - timedelta(minutes=1)}})
    done = ok(c.get('/api/challenges', headers=H(a_tok)))['challenges'][0]
    assert done['status'] == 'finished' and done['winner'] == 'friend', done
    bb = {x['id']: x for x in ok(c.get('/api/badges', headers=H(b_tok)))['badges']}
    assert bb['challenger']['earned'], bb['challenger']
    # decline + cancel flows
    ok(c.post('/api/challenges', json={'friend_id': a}, headers=H(b_tok)), 201)
    new_id = [x for x in ok(c.get('/api/challenges', headers=H(a_tok)))['challenges'] if x['status'] == 'pending'][0]['id']
    ok(c.put(f'/api/challenges/{new_id}/decline', headers=H(a_tok)))
    ok(c.post('/api/challenges', json={'friend_id': a}, headers=H(b_tok)), 201)
    cancel_id = [x for x in ok(c.get('/api/challenges', headers=H(b_tok)))['challenges'] if x['status'] == 'pending'][0]['id']
    ok(c.delete(f'/api/challenges/{cancel_id}', headers=H(b_tok)))

    # ── saved plans ─────────────────────────────────────────────────
    plan = ("**3-Day Workout Plan**\n- Day 1: Squats 4 sets x 10 reps\n- Day 2: Push-ups 3 sets x 15 reps, plank\n"
            "- Day 3: Lunges 3 sets x 12 reps and cardio. Warm-up first, cool-down after.")
    p = ok(c.post('/api/plans', json={'content': plan}, headers=H(a_tok)), 201)['plan']
    assert p['kind'] == 'workout' and p['title'] == '3-Day Workout Plan', p
    assert ok(c.post('/api/plans', json={'content': plan}, headers=H(a_tok)))['duplicate'] is True
    meal = "Meal plan\nBreakfast: oatmeal with eggs\nLunch: chicken and rice, 600 kcal\nDinner: salmon, carbs and protein\nSnack: yogurt"
    assert ok(c.post('/api/plans', json={'content': meal}, headers=H(a_tok)), 201)['plan']['kind'] == 'meal'
    assert len(ok(c.get('/api/plans', headers=H(a_tok)))['plans']) == 2
    assert len(ok(c.get('/api/plans', headers=H(b_tok)))['plans']) == 0          # private
    assert c.post('/api/plans', json={'content': 'short'}, headers=H(a_tok)).status_code == 400
    assert c.delete(f"/api/plans/{p['id']}", headers=H(b_tok)).status_code == 404  # not yours
    ok(c.delete(f"/api/plans/{p['id']}", headers=H(a_tok)))
    assert len(ok(c.get('/api/plans', headers=H(a_tok)))['plans']) == 1

    # ── streaming AI reply ──────────────────────────────────────────
    import app.ai.routes as ai

    class FakeResp:
        status_code = 200
        encoding = None

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def iter_lines(self, decode_unicode=False):
            for piece in ['Hello', ' there', ' 💪']:
                yield 'data: ' + json.dumps({'choices': [{'delta': {'content': piece}}]})
                yield ''
            yield 'data: ' + json.dumps({'choices': [{'delta': {'reasoning': 'thinking...'}}]})
            yield 'data: [DONE]'

    seen = {}

    def fake_post(url, **kw):
        seen['payload'] = kw['json']
        return FakeResp()

    real = ai.http_requests.post
    ai.http_requests.post = fake_post
    try:
        r = c.post('/api/ai/chat/stream', json={'messages': [{'role': 'user', 'content': 'hi'}]},
                   headers={**H(a_tok), 'Accept-Encoding': 'gzip'})
        assert r.status_code == 200 and r.mimetype == 'text/event-stream', (r.status_code, r.mimetype)
        assert 'gzip' not in (r.headers.get('Content-Encoding') or '')            # must never be buffered/compressed
        events = [json.loads(line[5:]) for line in r.get_data(as_text=True).splitlines() if line.startswith('data:')]
        text = ''.join(e.get('t', '') for e in events)
        assert text == 'Hello there 💪' and events[-1] == {'done': True}, events
        assert seen['payload']['stream'] is True
        assert mongo.db.ai_usage.count_documents({'user_id': a}) == 1
        assert c.post('/api/ai/chat/stream', json={'messages': []}, headers=H(a_tok)).status_code == 400
    finally:
        ai.http_requests.post = real

    # ── fair-play workout rules: server-owned sessions, caps, check-ins ──────
    from app.routes import _points_for

    def open_session(tok, uid, started_min_ago, confirmed_min_ago=None):
        sid = ok(c.post('/api/workouts/start', headers=H(tok), json={'activity_type': 'Plank', 'tz': 'UTC'}))['session_id']
        n = utcnow()
        conf = started_min_ago if confirmed_min_ago is None else confirmed_min_ago
        mongo.db.workout_sessions.update_one({'_id': uid}, {'$set': {'start_time': n - timedelta(minutes=started_min_ago),
                                                                     'last_confirmed': n - timedelta(minutes=conf)}})
        return sid

    assert _points_for(60, 0) == 1 and _points_for(3600, 0) == 60          # 1 point per minute
    assert _points_for(119, 0) == 1 and _points_for(7200, 0) == 120        # whole minutes only
    assert _points_for(3600, 10) == 60                                     # no streak multiplier
    # a made-up completion (no / wrong session) is refused; the browser's own times and duration are ignored
    assert ok(c.post('/api/workouts/complete', headers=H(b_tok), json={
        'start_time': '2020-01-01T00:00:00Z', 'end_time': '2020-01-01T12:00:00Z', 'duration': 43200}), 409)['success'] is False
    # under a minute is not logged
    sid = open_session(b_tok, b, 0.5)
    assert ok(c.post('/api/workouts/complete', headers=H(b_tok), json={'session_id': sid}), 400)['success'] is False
    # a session is saved once only
    sid = open_session(b_tok, b, 5)
    ok(c.post('/api/workouts/complete', headers=H(b_tok), json={'session_id': sid}))
    assert ok(c.post('/api/workouts/complete', headers=H(b_tok), json={'session_id': sid}), 409)['success'] is False
    # restarting replaces the open session: the old one can no longer be saved
    old_sid = open_session(b_tok, b, 5)
    new_sid = ok(c.post('/api/workouts/start', headers=H(b_tok), json={'activity_type': 'Plank'}))['session_id']
    assert ok(c.post('/api/workouts/complete', headers=H(b_tok), json={'session_id': old_sid}), 409)['success'] is False
    ok(c.post('/api/workouts/cancel', headers=H(b_tok)))
    assert ok(c.get('/api/workouts/active', headers=H(b_tok)))['active'] is False
    # forgotten timer: nobody answered the check-in -> credit only up to the prompt (30 min), never the full 50
    sid = open_session(b_tok, b, 50)
    r = ok(c.post('/api/workouts/complete', headers=H(b_tok), json={'session_id': sid}))
    assert r['auto_stopped'] is True and r['duration'] == 1800, r
    # check-ins keep a long session alive; late ones are refused
    sid = open_session(b_tok, b, 20)
    ok(c.post('/api/workouts/checkin', headers=H(b_tok), json={'session_id': sid}))
    mongo.db.workout_sessions.update_one({'_id': b}, {'$set': {'last_confirmed': utcnow() - timedelta(minutes=40)}})
    assert ok(c.post('/api/workouts/checkin', headers=H(b_tok), json={'session_id': sid}), 409)['code'] == 'expired'
    mongo.db.workout_sessions.delete_one({'_id': b})
    # 3-hour cap + 600-point daily ceiling (1 point a minute) (checked in all along, so it is not "abandoned"). Near UTC midnight a
    # session started 5 h ago falls on the previous day, so this block can only be trusted when run after ~05:00 UTC.
    sid = open_session(a_tok, a, 300, 1)
    r = ok(c.post('/api/workouts/complete', headers=H(a_tok), json={'session_id': sid}))
    assert r['duration'] == 3 * 3600 and r['length_capped'] and r['auto_stopped'] is False, r
    assert r['points_earned'] == 180 and r['daily_cap_hit'] is False, r      # 3 h = 180 points at 1 point a minute
    # fill the rest of today's 600-point ceiling, then another session earns nothing
    mongo.db.workouts.update_one({'user_id': a, 'points': 180}, {'$set': {'points': 600}})
    sid = open_session(a_tok, a, 10)
    r = ok(c.post('/api/workouts/complete', headers=H(a_tok), json={'session_id': sid}))
    assert r['points_earned'] == 0 and r['daily_points_left'] == 0, r      # daily ceiling already reached

    print('ALL ENGAGE CHECKS PASSED')


if __name__ == '__main__':
    run()
