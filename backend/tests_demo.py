"""Demo-sandbox isolation tests (in-memory MongoDB via mongomock).

    pip install mongomock pytest
    python tests_demo.py          # or: pytest tests_demo.py

Checks that the public demo accounts can never read or change real data, that the sandbox cannot take itself
(or the real site) offline, and that real operations cannot collide with the reserved demo emails.
"""
import os
import sys

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-demo-tests-0123456789')
os.environ.setdefault('JWT_SECRET_KEY', 'test-jwt-key-for-demo-tests-0123456789abc')

import mongomock  # noqa: E402
import flask_pymongo  # noqa: E402


def _fake_init_app(self, app, *a, **kw):
    self.cx = mongomock.MongoClient()
    self.db = self.cx['fitness_db']


flask_pymongo.PyMongo.init_app = _fake_init_app

from app import create_app  # noqa: E402
from app.extensions import mongo  # noqa: E402

app = create_app()
c = app.test_client()
PW = 'Passw0rdX'
REG = {'password': PW, 'age': 30, 'gender': 'male', 'weight': 80, 'height': 180,
       'fitnessLevel': 'Beginner', 'fitnessGoals': ['Lose weight']}
DEMO_ADMIN = {'email': 'admin@gmail.com', 'password': 'Admin@123'}
DEMO_USER1 = {'email': 'user1@gmail.com', 'password': 'User@123'}


def H(token):
    return {'Authorization': f'Bearer {token}'}


def ok(resp, status=200):
    assert resp.status_code == status, f'{resp.request.method} {resp.request.path} -> {resp.status_code} {resp.get_data(as_text=True)[:300]}'
    return resp.get_json() if resp.is_json else resp


def real_snapshot():
    real = mongo.real_db
    return {n: sorted(str(d) for d in real[n].find({})) for n in real.list_collection_names() if not n.startswith('demo_')}


def run():
    real = mongo.real_db
    # ── a small real world ──
    ok(c.post('/api/auth/register', json={**REG, 'fullName': 'Real Admin', 'email': 'ra@x.com'}), 201)   # first user = admin
    bob = ok(c.post('/api/auth/register', json={**REG, 'fullName': 'Real Bob', 'email': 'bob@x.com'}), 201)
    bob_tok, bob_id = bob['token'], bob['user']['id']
    ra = ok(c.post('/api/admin/auth/login', json={'email': 'ra@x.com', 'password': PW}))['token']
    ok(c.post('/api/posts', json={'content': 'real post'}, headers=H(bob_tok)))
    ok(c.post('/api/admin/announcements', json={'title': 'REAL', 'body': 'x', 'type': 'info', 'active': True}, headers=H(ra)), 201)
    before = real_snapshot()

    # ── demo admin: sees only demo users, cannot reach real ones ──
    d = ok(c.post('/api/auth/login', json=DEMO_ADMIN))
    assert d['user']['is_demo'] and d.get('admin_token')
    da = d['admin_token']
    emails = {u['email'] for u in ok(c.get('/api/admin/users?limit=100', headers=H(da)))['users']}
    assert emails == {'admin@gmail.com', 'user1@gmail.com', 'user2@gmail.com'}, emails
    assert c.get(f'/api/admin/users/{bob_id}', headers=H(da)).status_code == 404
    assert c.post(f'/api/admin/users/{bob_id}/suspend', headers=H(da), json={}).status_code == 404
    assert c.delete(f'/api/admin/users/{bob_id}', headers=H(da)).status_code in (400, 404)
    assert c.post(f'/api/admin/users/{bob_id}/points', headers=H(da), json={'points': 999, 'reason': 'x'}).status_code == 404

    # ── demo admin's global switches stay inside the sandbox ──
    c.put('/api/admin/settings', headers=H(da), json={'maintenance_mode': True, 'registration_enabled': False,
                                                        'ai_enabled': False, 'banned_words': ['real']})
    c.post('/api/admin/announcements', headers=H(da), json={'title': 'DEMO-ANN', 'body': 'x', 'type': 'warning', 'active': True})
    c.post('/api/admin/leaderboard/reset', headers=H(da), json={'confirm': 'RESET'})
    assert c.get('/api/auth/profile', headers=H(bob_tok)).status_code == 200            # real member unaffected
    ok(c.post('/api/auth/register', json={**REG, 'fullName': 'Newbie', 'email': 'new@x.com'}), 201)   # real sign-ups still open
    titles = [a['title'] for a in ok(c.get('/api/announcements/active', headers=H(bob_tok)))['announcements']]
    assert titles == ['REAL'], titles
    ok(c.post('/api/auth/register', json={**REG, 'fullName': 'Newbie2', 'email': 'new2@x.com'}), 201)
    before = real_snapshot()   # re-baseline after the sign-ups made on purpose above

    # ── the demo can't lock itself out with maintenance mode ──
    assert ok(c.get('/api/admin/settings', headers=H(da)))['settings']['maintenance_mode'] is False
    u1 = ok(c.post('/api/auth/login', json=DEMO_USER1))['token']
    ok(c.post('/api/auth/login', json=DEMO_ADMIN))

    # ── demo users: no way to reach real members ──
    ok(c.post('/api/posts', json={'content': 'demo post'}, headers=H(u1)))
    assert c.post('/api/friends/request', json={'receiverId': bob_id}, headers=H(u1)).status_code == 404
    assert c.get(f'/api/messages/{bob_id}', headers=H(u1)).status_code in (403, 404)
    ok(c.delete('/api/auth/account', headers=H(u1)))                                     # only resets the demo world

    # ── demo admin sees no real server details ──
    da2 = ok(c.post('/api/admin/auth/login', json=DEMO_ADMIN))['token']
    h = ok(c.get('/api/admin/system/health', headers=H(da2)))['health']
    assert h['environment'] == 'demo' and h['python'] == '3.x'
    ok(c.post('/api/admin/auth/logout', headers=H(da2)))

    # ── after all of that the real database is byte-for-byte what it was ──
    assert real_snapshot() == before, 'REAL DATA CHANGED by demo activity'
    assert real.settings.find_one({'_id': 'global'}) is None
    assert real.users.find_one({'_id': __import__('bson').ObjectId(bob_id)})['is_active'] is True

    # ── real admin cannot create / rename a real account onto a reserved demo email ──
    r = c.post('/api/admin/users', headers=H(ra), json={'full_name': 'Stranger', 'email': 'user2@gmail.com', 'password': PW})
    assert r.status_code == 409, r.get_data(as_text=True)
    assert c.put(f'/api/admin/users/{bob_id}', headers=H(ra), json={'email': 'user1@gmail.com'}).status_code == 409
    assert real.users.find_one({'email': 'bob@x.com'}) is not None                       # Bob keeps his real email
    ok(c.post('/api/admin/users', headers=H(ra), json={'full_name': 'Okay', 'email': 'okay@x.com', 'password': PW}), 201)
    assert real.users.find_one({'email': 'okay@x.com'}) is not None

    # ── real admin's own health page still shows real info ──
    rh = ok(c.get('/api/admin/system/health', headers=H(ra)))['health']
    assert rh['environment'] != 'demo' and rh['python'] != '3.x'

    # ── real maintenance mode still works for real members ──
    ok(c.put('/api/admin/settings', headers=H(ra), json={'maintenance_mode': True}))
    assert c.get('/api/auth/profile', headers=H(bob_tok)).status_code == 503
    ok(c.put('/api/admin/settings', headers=H(ra), json={'maintenance_mode': False}))
    print('demo isolation: all checks passed')



SID = 'X-Demo-Session'


def demo_login(who, sid=None, admin_console=False):
    """Sign in to a demo account the way the browser does (re-sending its sandbox id if it has one)."""
    headers = {SID: sid} if sid else {}
    path = '/api/admin/auth/login' if admin_console else '/api/auth/login'
    d = ok(c.post(path, json=who, headers=headers))
    return d['token'], d['demo_session'], d


def run_sessions():
    """Per-visitor sandboxes: private, shared inside one browser, reset on sign-out and after 30 minutes."""
    from datetime import timedelta
    from app.demo import SANDBOXES, SESSION_TTL, cleanup_idle
    from app.utils import utcnow
    real = mongo.real_db
    before = real_snapshot()

    # ── two visitors (two browsers = two sandbox ids) ──
    a_tok, a_sid, _ = demo_login(DEMO_ADMIN)
    b_tok, b_sid, _ = demo_login(DEMO_ADMIN)
    assert a_sid != b_sid and len(a_sid) == 16
    users_a = ok(c.get('/api/admin/users?limit=100', headers=H(a_tok)))['users']
    uid1 = next(u['id'] for u in users_a if u['email'] == 'user1@gmail.com')

    # visitor A deletes demo user 1 -> gone for A only
    ok(c.delete(f'/api/admin/users/{uid1}', headers=H(a_tok)))
    emails_a = {u['email'] for u in ok(c.get('/api/admin/users?limit=100', headers=H(a_tok)))['users']}
    emails_b = {u['email'] for u in ok(c.get('/api/admin/users?limit=100', headers=H(b_tok)))['users']}
    assert 'user1@gmail.com' not in emails_a, emails_a
    # the deleted account can't sign in (for A), can't be re-created, and still works for B
    r = c.post('/api/auth/login', json=DEMO_USER1, headers={SID: a_sid})
    assert r.status_code == 401 and 'deleted' in r.get_json()['message'], r.get_data(as_text=True)
    r = c.post('/api/admin/users', headers=H(a_tok), json={'full_name': 'Demo User One', 'email': 'user1@gmail.com', 'password': PW})
    assert r.status_code == 409 and 'wait' in r.get_json()['message'].lower(), r.get_data(as_text=True)
    ok(c.post('/api/auth/login', json=DEMO_USER1, headers={SID: b_sid}))
    assert emails_b == {'admin@gmail.com', 'user1@gmail.com', 'user2@gmail.com'}, emails_b      # B untouched

    # visitor A also posts, and signs in as demo user 2 in the same browser (re-sends its sandbox id)
    u2_tok, same, _ = demo_login({'email': 'user2@gmail.com', 'password': 'User@234'}, sid=a_sid)
    assert same == a_sid
    ok(c.post('/api/posts', json={'content': 'only A sees this'}, headers=H(u2_tok)))
    feed_b = ok(c.get('/api/posts/feed', headers=H(b_tok)))
    assert 'only A sees this' not in str(feed_b)
    assert real.demo_users.count_documents({'_ds': a_sid}) == 2          # admin + user2 (user1 deleted)
    assert real.demo_users.count_documents({'_ds': b_sid}) == 3

    # A suspends user 2 and edits settings; B's settings / users stay as they were
    ok(c.put('/api/admin/settings', headers=H(a_tok), json={'registration_enabled': False, 'banned_words': ['zzz']}))
    assert ok(c.get('/api/admin/settings', headers=H(b_tok)))['settings']['banned_words'] == []
    assert ok(c.get('/api/admin/settings', headers=H(a_tok)))['settings']['banned_words'] == ['zzz']

    # ── signing out of a demo account puts that visitor's demo back to its original state ──
    ok(c.post('/api/auth/logout', headers=H(u2_tok)))
    emails_a = {u['email'] for u in ok(c.get('/api/admin/users?limit=100', headers=H(a_tok)))['users']}
    assert emails_a == {'admin@gmail.com', 'user2@gmail.com'}, emails_a        # everything else is back; deleted user 1 stays deleted
    assert ok(c.get('/api/admin/settings', headers=H(a_tok)))['settings']['banned_words'] == []
    assert 'only A sees this' not in str(ok(c.get('/api/posts/feed', headers=H(a_tok))))
    assert c.get('/api/auth/profile', headers=H(u2_tok)).status_code == 200    # same ids: the page keeps working
    # signing the admin out (and in again) doesn't bring the deleted account back either
    ok(c.post('/api/admin/auth/logout', headers=H(a_tok)))
    a_tok, _, _ = demo_login(DEMO_ADMIN, sid=a_sid)
    assert 'user1@gmail.com' not in {u['email'] for u in ok(c.get('/api/admin/users?limit=100', headers=H(a_tok)))['users']}
    assert c.post('/api/auth/login', json=DEMO_USER1, headers={SID: a_sid}).status_code == 401
    # ... until its own 30 minutes (counted from the deletion) are up
    from app.demo import SANDBOXES as _SB
    from datetime import timedelta as _td
    from app.utils import utcnow as _now
    real[_SB].update_one({'_id': a_sid}, {'$set': {'deleted.b1': _now() - _td(minutes=31)}})
    from app import demo as _dm
    _dm._known.clear()
    assert 'user1@gmail.com' in {u['email'] for u in ok(c.get('/api/admin/users?limit=100', headers=H(a_tok)))['users']}
    ok(c.post('/api/auth/login', json=DEMO_USER1, headers={SID: a_sid}))

    # ── automatic reset 30 minutes after the sandbox was built (no logout needed) ──
    uid1 = next(u['id'] for u in ok(c.get('/api/admin/users?limit=100', headers=H(b_tok)))['users'] if u['email'] == 'user1@gmail.com')
    ok(c.delete(f'/api/admin/users/{uid1}', headers=H(b_tok)))
    assert 'user1@gmail.com' not in {u['email'] for u in ok(c.get('/api/admin/users?limit=100', headers=H(b_tok)))['users']}
    real[SANDBOXES].update_one({'_id': b_sid}, {'$set': {'started_at': utcnow() - SESSION_TTL - timedelta(seconds=5)}})
    from app import demo as demo_mod
    demo_mod._known.clear()                                              # forget the 10-second "still fresh" shortcut
    assert 'user1@gmail.com' in {u['email'] for u in ok(c.get('/api/admin/users?limit=100', headers=H(b_tok)))['users']}   # back on its own
    assert real[SANDBOXES].find_one({'_id': b_sid})['started_at'] > utcnow() - timedelta(minutes=1)   # the 30 minutes start over

    # ── a visitor who just keeps working is not reset before the 30 minutes are up ──
    ok(c.post('/api/posts', json={'content': 'still here'}, headers=H(b_tok)))
    assert 'still here' in str(ok(c.get('/api/posts/feed', headers=H(b_tok))))

    # ── many visitors at once, each with their own world ──
    from app.utils import _hits
    _hits.clear()                                                        # the per-IP login rate limit is a separate, existing feature
    toks = [demo_login(DEMO_ADMIN)[:2] for _ in range(12)]
    assert len({sid for _, sid in toks}) == 12
    for i, (tok, sid) in enumerate(toks):
        ok(c.post('/api/admin/announcements', headers=H(tok), json={'title': f'ann-{i}', 'body': 'x', 'type': 'info', 'active': True}), 201)
    for i, (tok, sid) in enumerate(toks):
        titles = {a['title'] for a in ok(c.get('/api/admin/announcements', headers=H(tok)))['announcements']}
        assert f'ann-{i}' in titles and not any(t.startswith('ann-') and t != f'ann-{i}' for t in titles), titles

    # ── abandoned sandboxes are cleaned up; a returning visitor just gets a fresh one ──
    old = toks[0][1]
    real[SANDBOXES].update_one({'_id': old}, {'$set': {'last_seen': utcnow() - timedelta(hours=2)}})
    assert cleanup_idle(real) >= 1
    assert real.demo_users.count_documents({'_ds': old}) == 0 and real[SANDBOXES].find_one({'_id': old}) is None
    demo_mod._known.clear()
    assert len(ok(c.get('/api/admin/users?limit=100', headers=H(toks[0][0])))['users']) == 3

    # ── an old-style token (no sandbox id) is refused instead of reaching any data ──
    from flask_jwt_extended import create_access_token
    with app.app_context():
        legacy = create_access_token(identity='d3a0000000000000000000a1', additional_claims={'demo': True, 'tv': 0})
    assert c.get('/api/auth/profile', headers=H(legacy)).status_code == 401

    # ── none of it touched real data ──
    assert real_snapshot() == before, 'REAL DATA CHANGED by demo sessions'
    print('demo sessions: all checks passed')


def test_demo_sessions():
    run_sessions()


def test_demo_isolation():
    run()


if __name__ == '__main__':
    run()
    run_sessions()
