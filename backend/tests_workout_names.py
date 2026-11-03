"""Smoke test: personal workout names API, the AI coach prompt, and demo-account feature parity.

    pip install mongomock pytest
    python tests_workout_names.py
"""
import os

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-admin-tests-0123456789')
os.environ.setdefault('JWT_SECRET_KEY', 'test-jwt-key-for-admin-tests-0123456789ab')

import mongomock  # noqa: E402
import flask_pymongo  # noqa: E402


def _fake_init_app(self, app, *a, **kw):
    self.cx = mongomock.MongoClient()
    self.db = self.cx['fitness_db']


flask_pymongo.PyMongo.init_app = _fake_init_app

from app import create_app  # noqa: E402
from app.extensions import mongo  # noqa: E402
from app.ai.routes import get_user_profile, build_system_prompt  # noqa: E402

app = create_app()
c = app.test_client()


def login(email, pw):
    r = c.post('/api/auth/login', json={'email': email, 'password': pw})
    assert r.status_code == 200, r.get_json()
    return {'Authorization': 'Bearer ' + r.get_json()['token']}, r.get_json()


# ── demo user: has the same features (and some starter data) as a real member ─────────────────────
h1, d1 = login('user1@gmail.com', 'User@123')
assert d1['user']['is_demo']
r = c.get('/api/users/workout-prefs', headers=h1).get_json()
assert r['prefs']['custom']['gym'] == ['Cable Crossover'] and r['prefs']['shown']['gym'] is None, r

r = c.put('/api/users/workout-prefs', headers=h1, json={
    'custom': {'gym': ['  Sled Push ', 'sled push', 'Cable Crossover', '<b>Atlas</b>'], 'home': ['Pillow Pilates']},
    'shown': {'gym': ['Sled Push', 'Bench Press'], 'home': []}}).get_json()
p = r['prefs']
assert p['custom']['gym'] == ['Atlas', 'Cable Crossover', 'Sled Push'], p
assert p['shown']['gym'] == ['Bench Press', 'Sled Push'] and p['shown']['home'] is None, p   # empty list = show all

# the AI coach is told about the member's own names
from bson import ObjectId  # noqa: E402
with app.test_request_context('/api/ai/chat', headers=h1):
    from flask import g  # noqa: E402
    g.demo_sid = d1['demo_session']   # this member's private demo sandbox
    prompt = build_system_prompt(get_user_profile(mongo, str(d1['user']['id'])))
assert 'Own Gym Workout Names' in prompt and 'Sled Push' in prompt and 'Own Home Workout Names: Pillow Pilates' in prompt

# prefs are private to the profile: user 2 does not see user 1's names
h2, _ = login('user2@gmail.com', 'User@234')
assert c.get('/api/users/workout-prefs', headers=h2).get_json()['prefs']['custom']['gym'] == []

# demo extras: saved plan, announcement banner, history uses timer names
assert c.get('/api/plans', headers=h1).get_json()['plans'][0]['title'] == 'Push day'
assert c.get('/api/announcements/active', headers=h1).get_json()['announcements']

# demo admin console: open report is waiting in moderation
ha, da = login('admin@gmail.com', 'Admin@123')
assert da['admin_token']
adm = {'Authorization': 'Bearer ' + da['admin_token']}
rep = c.get('/api/admin/reports', headers=adm).get_json()
assert rep.get('reports') or rep.get('items'), rep

# demo members may delete their account like real members; it is only temporary (the demo world is rebuilt)
h1, _ = login('user1@gmail.com', 'User@123')
assert c.delete('/api/auth/account', headers=h1).get_json()['success']
h1, _ = login('user1@gmail.com', 'User@123')
assert c.get('/api/users/workout-prefs', headers=h1).get_json()['prefs']['custom']['gym'] == ['Cable Crossover']

# ── a real member ──────────────────────────────────────────────────────────────────────────────────
reg = c.post('/api/auth/register', json={'fullName': 'Real Member', 'email': 'real@example.com', 'password': 'Passw0rdX',
                                         'age': 30, 'gender': 'male', 'weight': 70, 'height': 175,
                                         'fitnessLevel': 'Beginner', 'fitnessGoals': ['Lose weight']})
assert reg.status_code in (200, 201), reg.get_json()
hr, dr = login('real@example.com', 'Passw0rdX')
assert c.get('/api/users/workout-prefs', headers=hr).get_json()['prefs']['custom'] == {'gym': [], 'home': []}
c.put('/api/users/workout-prefs', headers=hr, json={'custom': {'home': ['Stair Hops']}, 'shown': {}})
assert c.get('/api/users/workout-prefs', headers=hr).get_json()['prefs']['custom']['home'] == ['Stair Hops']
assert c.get('/api/users/workout-prefs').status_code == 401
print('ALL WORKOUT-NAME CHECKS PASSED')

# ── coach memory: the coach remembers the plans it gave ─────────────────────────────────────────────
from app.ai import memory as cm  # noqa: E402

PLAN = ("Here is your push day.\n## Monday: Upper body\n- Bench Press: 3 x 12\n- Shoulder Press: 3 x 10\n- Plank: 45 sec\n"
        "Warm up first, rest 60 sec between sets.\n[[WORKOUTS: Bench Press | Shoulder Press | Plank]]")
assert cm.looks_like_plan(PLAN) and not cm.looks_like_plan('Great job, keep it up!')
assert cm.exercise_names(PLAN) == ['Bench Press', 'Shoulder Press', 'Plank']
assert 'WORKOUTS' not in cm.strip_tag(PLAN)
with app.test_request_context():
    g.demo_sid = d1['demo_session']   # this member's private demo sandbox   # demo members live in the demo_* collections
    h1, d1 = login('user1@gmail.com', 'User@123')
    uid1 = d1['user']['id']
    cm.remember(mongo, uid1, 'Build me a push workout', PLAN)
    cm.remember(mongo, uid1, 'Build me a push workout', PLAN)                 # same plan twice -> stored once
    cm.remember(mongo, uid1, 'How is my streak?', 'Your streak is 3 days!')   # small talk is not remembered
    mem = mongo.db.users.find_one({'_id': ObjectId(uid1)})['coach_memory']
    assert len(mem) == 1 and 'Bench Press' in mem[0]['gist'] and mem[0]['ask'] == 'Build me a push workout', mem
    for i in range(8):
        cm.remember(mongo, uid1, f'plan {i}', PLAN.replace('Bench Press', f'Move {i}'))
    assert len(mongo.db.users.find_one({'_id': ObjectId(uid1)})['coach_memory']) == cm.MAX_ENTRIES   # capped
    prompt2 = build_system_prompt(get_user_profile(mongo, uid1))
    assert 'PLANS YOU ALREADY GAVE THIS MEMBER' in prompt2 and 'Move 7' in prompt2 and '[[WORKOUTS:' in prompt2
r = c.delete('/api/ai/memory', headers=h1).get_json()
assert r['success']
with app.test_request_context():
    g.demo_sid = d1['demo_session']   # this member's private demo sandbox
    assert not mongo.db.users.find_one({'_id': ObjectId(uid1)}).get('coach_memory')
    assert 'PLANS YOU ALREADY GAVE' not in build_system_prompt(get_user_profile(mongo, uid1))
print('ALL COACH MEMORY CHECKS PASSED')

# ── admin dashboard: the few-queries path gives the same numbers as the plain per-count path ─────────
import mongomock  # noqa: E402
ha, da = login('admin@gmail.com', 'Admin@123')
adm = {'Authorization': 'Bearer ' + da['admin_token']}
fast = c.get('/api/admin/dashboard/overview', headers=adm).get_json()['kpi']
_orig_agg = mongomock.collection.Collection.aggregate


def _no_cond(self, pipeline, *a, **k):
    if '$cond' in str(pipeline):
        raise RuntimeError('force the fallback')
    return _orig_agg(self, pipeline, *a, **k)


mongomock.collection.Collection.aggregate = _no_cond
try:
    slow = c.get('/api/admin/dashboard/overview', headers=adm).get_json()['kpi']
finally:
    mongomock.collection.Collection.aggregate = _orig_agg
assert fast == slow and fast['total_users'] >= 3 and fast['open_reports'] == 1, (fast, slow)
health = c.get('/api/admin/system/health', headers=adm).get_json()['health']['collections']
assert health['users'] == fast['total_users'], health
print('ALL ADMIN DASHBOARD CHECKS PASSED')
