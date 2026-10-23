"""End-to-end smoke test of the admin API against an in-memory MongoDB (mongomock).

    pip install mongomock pytest
    python tests_admin.py          # or: pytest tests_admin.py
"""
import os
import sys
from datetime import timedelta

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
from app.utils import utcnow  # noqa: E402

app = create_app()
c = app.test_client()
PW = 'Passw0rdX'
REG = {'password': PW, 'age': 30, 'gender': 'male', 'weight': 80, 'height': 180,
       'fitnessLevel': 'Beginner', 'fitnessGoals': ['Lose weight']}


def H(token):
    return {'Authorization': f'Bearer {token}'}


def ok(resp, status=200):
    assert resp.status_code == status, f'{resp.request.method} {resp.request.path} -> {resp.status_code} {resp.get_data(as_text=True)[:300]}'
    return resp.get_json() if resp.is_json else resp


def register(name, email):
    d = ok(c.post('/api/auth/register', json={**REG, 'fullName': name, 'email': email}), 201)
    return d['token'], d['user']['id']


def run():
    # ── bootstrap: first user is admin, others are normal ──
    admin_user_tok, admin_id = register('Ada Admin', 'ada@x.com')
    bob_tok, bob_id = register('Bob Member', 'bob@x.com')
    cy_tok, cy_id = register('Cy Reporter', 'cy@x.com')

    # ── admin login ──
    assert c.post('/api/admin/auth/login', json={'email': 'bob@x.com', 'password': PW}).status_code == 403   # not admin
    assert c.post('/api/admin/auth/login', json={'email': 'ada@x.com', 'password': 'wrong'}).status_code == 401
    d = ok(c.post('/api/admin/auth/login', json={'email': 'ada@x.com', 'password': PW}))
    A = H(d['token'])
    assert c.get('/api/admin/users').status_code == 401                 # no token
    assert c.get('/api/admin/users', headers=H(bob_tok)).status_code == 403   # user token can't reach admin
    assert ok(c.get('/api/admin/auth/me', headers=A))['admin']['email'] == 'ada@x.com'

    # ── seed activity ──
    now = utcnow()
    for i, (dur, act) in enumerate([(1800, 'Running'), (20000, 'Cycling'), (30, 'Yoga')]):
        mongo.db.workouts.insert_one({'_id': f'w{i}', 'user_id': bob_id, 'start_time': now - timedelta(hours=i + 1),
                                      'end_time': now, 'duration': dur, 'activity_type': act, 'tz': 'UTC'})
    mongo.db.users.update_one({'_id': mongo.db.users.find_one({'email': 'bob@x.com'})['_id']}, {'$set': {'points': 50}})
    post = ok(c.post('/api/posts', json={'content': 'Bob first post'}, headers=H(bob_tok)))
    post_id = post['postId']
    ok(c.post(f'/api/posts/{post_id}/comment', json={'comment': 'nice'}, headers=H(bob_tok)))

    # ── dashboard ──
    ov = ok(c.get('/api/admin/dashboard/overview', headers=A))
    assert ov['kpi']['total_users'] == 3 and ov['kpi']['total_workouts'] == 3 and ov['kpi']['total_posts'] == 1
    ch = ok(c.get('/api/admin/dashboard/charts?days=14', headers=A))
    assert len(ch['series']) == 14 and sum(s['signups'] for s in ch['series']) == 3
    assert ch['levels'] and ch['goals']
    assert ok(c.get('/api/admin/system/health', headers=A))['health']['database']['ok'] is True

    # ── users: list / filter / detail / edit ──
    lst = ok(c.get('/api/admin/users?q=bob', headers=A))
    assert lst['total'] == 1 and lst['users'][0]['workouts'] == 3
    assert ok(c.get('/api/admin/users?role=admin', headers=A))['total'] == 1
    det = ok(c.get(f'/api/admin/users/{bob_id}', headers=A))
    assert det['stats']['workouts'] == 3 and det['stats']['posts'] == 1 and 'password' not in det['user']
    assert c.put(f'/api/admin/users/{bob_id}', json={'email': 'ada@x.com'}, headers=A).status_code == 409
    ok(c.put(f'/api/admin/users/{bob_id}', json={'full_name': 'Bobby M', 'age': 31, 'points': 75}, headers=A))
    assert ok(c.get(f'/api/admin/users/{bob_id}', headers=A))['user']['full_name'] == 'Bobby M'
    assert c.put(f'/api/admin/users/{bob_id}', json={'age': 3}, headers=A).status_code == 400
    csv_resp = c.get('/api/admin/users/export', headers=A)
    assert csv_resp.status_code == 200 and b'bob@x.com' in csv_resp.data
    new = ok(c.post('/api/admin/users', json={'email': 'dee@x.com', 'password': PW, 'full_name': 'Dee New', 'is_admin': False}, headers=A), 201)

    # ── suspend: blocked on the API immediately, and at login ──
    assert ok(c.get('/api/users/me', headers=H(bob_tok)))['email'] == 'bob@x.com'
    ok(c.post(f'/api/admin/users/{bob_id}/suspend', json={'reason': 'spam'}, headers=A))
    r = c.get('/api/users/me', headers=H(bob_tok))
    assert r.status_code in (401, 403), r.status_code            # token_version bumped + inactive
    assert c.post('/api/auth/login', json={'email': 'bob@x.com', 'password': PW}).status_code == 401
    assert ok(c.get('/api/admin/users?status=suspended', headers=A))['total'] == 1
    ok(c.post(f'/api/admin/users/{bob_id}/reactivate', headers=A))
    d = ok(c.post('/api/auth/login', json={'email': 'bob@x.com', 'password': PW}))
    bob_tok = d['token']
    assert d['user']['is_admin'] is False

    # ── force logout / reset password / points ──
    ok(c.post(f'/api/admin/users/{bob_id}/force-logout', headers=A))
    assert c.get('/api/users/me', headers=H(bob_tok)).status_code == 401
    tmp = ok(c.post(f'/api/admin/users/{bob_id}/reset-password', json={}, headers=A))['temp_password']
    bob_tok = ok(c.post('/api/auth/login', json={'email': 'bob@x.com', 'password': tmp}))['token']
    assert ok(c.post(f'/api/admin/users/{bob_id}/adjust-points', json={'mode': 'add', 'value': -1000}, headers=A))['points'] == 0
    assert ok(c.post(f'/api/admin/users/{bob_id}/adjust-points', json={'mode': 'set', 'value': 120}, headers=A))['points'] == 120

    # ── roles & safeguards ──
    assert c.post(f'/api/admin/users/{admin_id}/role', json={'is_admin': False}, headers=A).status_code == 400   # self
    assert c.post(f'/api/admin/users/{admin_id}/suspend', json={}, headers=A).status_code == 400
    assert c.delete(f'/api/admin/users/{admin_id}', headers=A).status_code == 400
    ok(c.post(f'/api/admin/users/{cy_id}/role', json={'is_admin': True}, headers=A))
    ok(c.post(f'/api/admin/users/{cy_id}/role', json={'is_admin': False}, headers=A))

    # ── workouts ──
    wl = ok(c.get('/api/admin/workouts?flagged=1', headers=A))
    assert wl['total'] == 2 and all(w['flag'] for w in wl['workouts'])
    assert ok(c.get('/api/admin/workouts?activity=Running', headers=A))['total'] == 1
    st = ok(c.get('/api/admin/workouts/stats', headers=A))
    assert st['total'] == 3 and st['flagged'] == 2 and len(st['by_activity']) == 3
    assert b'Running' in c.get('/api/admin/workouts/export', headers=A).data
    res = ok(c.delete('/api/admin/workouts/w1', json={'deduct_points': True}, headers=A))
    assert res['points_removed'] == 4000 or res['points_removed'] == 120      # capped by available points
    assert c.delete('/api/admin/workouts/nope', headers=A).status_code == 404

    # ── moderation: report -> queue -> hide -> gone from feed ──
    assert c.post(f'/api/posts/{post_id}/report', json={'reason': 'bogus'}, headers=H(cy_tok)).status_code == 400
    assert c.post(f'/api/posts/{post_id}/report', json={'reason': 'spam'}, headers=H(bob_tok)).status_code == 400   # own post
    ok(c.post(f'/api/posts/{post_id}/report', json={'reason': 'spam', 'details': 'ad'}, headers=H(cy_tok)))
    assert c.post(f'/api/posts/{post_id}/report', json={'reason': 'spam'}, headers=H(cy_tok)).status_code == 409
    rep = ok(c.get('/api/admin/reports?status=open', headers=A))
    assert rep['total'] == 1 and rep['reports'][0]['reporter']['name'] == 'Cy Reporter'
    assert ok(c.get('/api/admin/posts?reported=1', headers=A))['posts'][0]['open_reports'] == 1
    pdet = ok(c.get(f'/api/admin/posts/{post_id}', headers=A))['post']
    assert len(pdet['comments']) == 1
    assert len(ok(c.get('/api/posts/feed', headers=H(bob_tok)))['posts']) == 1
    ok(c.post(f"/api/admin/reports/{rep['reports'][0]['id']}/resolve", json={'action': 'hide_post', 'note': 'ad'}, headers=A))
    assert ok(c.get('/api/posts/feed', headers=H(bob_tok)))['posts'] == []
    assert ok(c.get('/api/admin/reports?status=open', headers=A))['total'] == 0
    ok(c.post(f'/api/admin/posts/{post_id}/hide', json={'hidden': False}, headers=A))
    assert len(ok(c.get('/api/posts/feed', headers=H(bob_tok)))['posts']) == 1
    ok(c.delete(f"/api/admin/posts/{post_id}/comments/{pdet['comments'][0]['id']}", headers=A))
    assert ok(c.get(f'/api/admin/posts/{post_id}', headers=A))['post']['comments'] == []
    ok(c.delete(f'/api/admin/posts/{post_id}', headers=A))
    assert c.get(f'/api/admin/posts/{post_id}', headers=A).status_code == 404

    # ── announcements ──
    a = ok(c.post('/api/admin/announcements', json={'title': 'Hello', 'body': 'World', 'type': 'warning'}, headers=A), 201)
    assert c.post('/api/admin/announcements', json={'title': ''}, headers=A).status_code == 400
    act = ok(c.get('/api/announcements/active', headers=H(cy_tok)))['announcements']
    assert len(act) == 1 and act[0]['type'] == 'warning'
    ok(c.put(f"/api/admin/announcements/{a['id']}", json={'active': False}, headers=A))
    assert ok(c.get('/api/announcements/active', headers=H(cy_tok)))['announcements'] == []
    assert ok(c.get('/api/admin/announcements', headers=A))['announcements'][0]['state'] == 'inactive'
    ok(c.delete(f"/api/admin/announcements/{a['id']}", headers=A))

    # ── settings: registration, AI, maintenance ──
    ok(c.put('/api/admin/settings', json={'registration_enabled': False}, headers=A))
    assert c.post('/api/auth/register', json={**REG, 'fullName': 'Z', 'email': 'z@x.com'}).status_code == 403
    ok(c.put('/api/admin/settings', json={'registration_enabled': True, 'ai_enabled': False}, headers=A))
    assert 'unavailable' in ok(c.post('/api/ai/chat', json={'messages': [{'role': 'user', 'content': 'hi'}]}, headers=H(cy_tok)))['message']
    ok(c.put('/api/admin/settings', json={'ai_enabled': True, 'maintenance_mode': True}, headers=A))
    from app.runtime import invalidate_user
    invalidate_user()
    assert c.get('/api/users/me', headers=H(cy_tok)).status_code == 503
    assert ok(c.get('/api/app/status'))['maintenance_mode'] is True
    ok(c.get('/api/admin/users', headers=A))                                  # admins unaffected
    assert c.put('/api/admin/settings', json={'ai_enabled': 'yes'}, headers=A).status_code == 400
    ok(c.put('/api/admin/settings', json={'maintenance_mode': False}, headers=A))
    assert ok(c.get('/api/users/me', headers=H(cy_tok)))['email'] == 'cy@x.com'

    # ── leaderboard ──
    from bson import ObjectId
    mongo.db.users.update_one({'_id': ObjectId(bob_id)}, {'$set': {'points': 120}})   # the workout delete above removed them
    lb = ok(c.get('/api/admin/leaderboard', headers=A))
    assert lb['leaderboard'][0]['name'] == 'Bobby M'
    assert c.post('/api/admin/leaderboard/reset', json={'confirm': 'no'}, headers=A).status_code == 400
    assert ok(c.post('/api/admin/leaderboard/reset', json={'confirm': 'RESET'}, headers=A))['affected'] == 1
    assert ok(c.get('/api/admin/leaderboard', headers=A))['seasons'][0]['top'][0]['name'] == 'Bobby M'

    # ── moderator role: staff areas yes, admin-only areas no ──
    ok(c.post(f'/api/admin/users/{cy_id}/role', json={'role': 'moderator'}, headers=A))
    M = H(ok(c.post('/api/admin/auth/login', json={'email': 'cy@x.com', 'password': PW}))['token'])
    assert ok(c.get('/api/admin/auth/me', headers=M))['admin']['role'] == 'moderator'
    ok(c.get('/api/admin/dashboard/overview', headers=M)); ok(c.get('/api/admin/posts', headers=M)); ok(c.get('/api/admin/users', headers=M))
    for method, path in (('get', '/api/admin/audit'), ('get', '/api/admin/settings'), ('get', '/api/admin/leaderboard'),
                         ('post', f'/api/admin/users/{admin_id}/suspend'), ('delete', f'/api/admin/users/{new["id"]}'),
                         ('get', '/api/admin/announcements'), ('post', f'/api/admin/users/{new["id"]}/email')):
        assert getattr(c, method)(path, headers=M).status_code == 403, path
    assert ok(c.get('/api/admin/users?role=moderator', headers=A))['total'] == 1
    assert ok(c.get('/api/admin/users?role=staff', headers=A))['total'] == 2
    ok(c.post(f'/api/admin/users/{cy_id}/role', json={'role': 'user'}, headers=A))
    assert c.get('/api/admin/posts', headers=M).status_code == 403              # demoted: instant loss of access

    # ── quick filters ──
    assert ok(c.get('/api/admin/users?joined_within=7', headers=A))['total'] >= 3
    mongo.db.users.update_one({'email': 'dee@x.com'}, {'$set': {'last_active': utcnow() - timedelta(days=60)}})
    assert ok(c.get('/api/admin/users?inactive_days=30', headers=A))['total'] >= 1

    # ── banned words: posts auto-hidden + reported, comments rejected ──
    ok(c.put('/api/admin/settings', json={'banned_words': ['Scam', ' scam ', 'badword']}, headers=A))
    assert ok(c.get('/api/admin/settings', headers=A))['settings']['banned_words'] == ['scam', 'badword']
    from app.runtime import get_settings; get_settings(force=True)
    bp = ok(c.post('/api/posts', json={'content': 'This is a SCAM offer'}, headers=H(cy_tok)))['postId']
    assert mongo.db.posts.find_one({'content': 'This is a SCAM offer'})['hidden'] is True
    rep = ok(c.get('/api/admin/reports?status=open', headers=A))['reports']
    assert rep[0]['reporter']['name'] == 'Auto-filter'
    assert c.post(f'/api/posts/{bp}/comment', json={'comment': 'badword here'}, headers=H(cy_tok)).status_code == 400
    ok(c.post(f'/api/posts/{bp}/comment', json={'comment': 'scammer is not whole word'}, headers=H(cy_tok)))
    ok(c.post('/api/posts', json={'content': 'perfectly fine'}, headers=H(cy_tok)))
    assert ok(c.get('/api/posts/feed', headers=H(cy_tok)))['posts'][0]['content'] == 'perfectly fine'
    ok(c.put('/api/admin/settings', json={'banned_words': []}, headers=A)); get_settings(force=True)

    # ── posts export + email ──
    assert b'perfectly fine' in c.get('/api/admin/posts/export', headers=A).data
    assert c.post(f'/api/admin/users/{new["id"]}/email', json={'subject': 'Hi', 'message': 'Hello'}, headers=A).status_code == 400   # SMTP unset
    sent = []
    import smtplib
    class FakeSMTP:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def starttls(self): pass
        def login(self, *a): pass
        def send_message(self, m): sent.append(m)
    smtplib.SMTP = FakeSMTP
    app.config.update(SMTP_HOST='smtp.test', SMTP_FROM='Aivo <no-reply@x.com>')
    ok(c.post(f'/api/admin/users/{new["id"]}/email', json={'subject': 'Hi', 'message': 'Hello'}, headers=A))
    assert sent and sent[0]['To'] == 'dee@x.com'
    assert c.post(f'/api/admin/users/{new["id"]}/email', json={'subject': '', 'message': ''}, headers=A).status_code == 400

    # ── bulk + delete cascade ──
    b = ok(c.post('/api/admin/users/bulk', json={'ids': [bob_id, admin_id, new['id']], 'action': 'suspend', 'reason': 'x'}, headers=A))
    assert b['done'] == 2 and len(b['skipped']) == 1                           # admin can't suspend self
    ok(c.post('/api/admin/users/bulk', json={'ids': [bob_id, new['id']], 'action': 'reactivate'}, headers=A))
    ok(c.delete(f'/api/admin/users/{bob_id}', headers=A))
    assert mongo.db.workouts.count_documents({'user_id': bob_id}) == 0 and mongo.db.users.count_documents({}) == 3

    # ── audit log + own password ──
    au = ok(c.get('/api/admin/audit?limit=100', headers=A))
    actions = {l['action'] for l in au['logs']}
    assert {'admin.login', 'user.suspend', 'user.delete', 'report.hide_post', 'post.unhide', 'user.role', 'user.email', 'settings.update', 'leaderboard.reset'} <= actions
    assert ok(c.get('/api/admin/audit?action=user.suspend', headers=A))['total'] >= 1
    assert c.post('/api/admin/auth/change-password', json={'current_password': 'bad', 'new_password': 'NewPassw0rd'}, headers=A).status_code == 400
    newtok = ok(c.post('/api/admin/auth/change-password', json={'current_password': PW, 'new_password': 'NewPassw0rd'}, headers=A))['token']
    assert c.get('/api/admin/users', headers=A).status_code == 401              # old session ended
    ok(c.get('/api/admin/users', headers=H(newtok)))
    print('ALL ADMIN API CHECKS PASSED')


def test_admin_api():
    run()


if __name__ == '__main__':
    try:
        run()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
