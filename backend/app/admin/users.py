"""Admin: user management."""
import secrets
import string
from datetime import timedelta

from flask import g, jsonify, request
from werkzeug.security import generate_password_hash

from . import admin_bp
from .guards import (admin_required, staff_required, audit, csv_response, err, oid, page_args, page_meta, rx, ser)
from ..extensions import mongo
from ..runtime import invalidate_user
from ..utils import effective_streak, iso_utc, utcnow, valid_tz
from datetime import timedelta as _td

SORTABLE = {'created_at', 'last_active', 'points', 'full_name', 'email'}
LIST_PROJECTION = {'password': 0, 'profile_picture': 0, 'weight_history': 0, 'medical_conditions': 0, 'friends': 0}
EDITABLE_TEXT = ('full_name', 'username', 'gender', 'fitness_level', 'preferred_units', 'medical_conditions')


# ── shared helpers (also used by content.py) ────────────────────────────────
def _bump_tv(user_id):
    mongo.db.users.update_one({'_id': user_id}, {'$inc': {'token_version': 1}})
    invalidate_user(user_id)


def _other_admin_exists(user_id):
    return mongo.db.users.count_documents({'is_admin': True, 'is_active': {'$ne': False},
                                           '_id': {'$ne': user_id}}, limit=1) > 0


def suspend_user(user_id, reason=''):
    """Returns (ok, error)."""
    if user_id == g.admin['_id']:
        return False, 'You cannot suspend your own account'
    user = mongo.db.users.find_one({'_id': user_id}, {'is_admin': 1, 'is_active': 1})
    if not user:
        return False, 'User not found'
    if user.get('is_admin') and not _other_admin_exists(user_id):
        return False, 'Cannot suspend the last active admin'
    mongo.db.users.update_one({'_id': user_id}, {
        '$set': {'is_active': False, 'suspended_reason': str(reason)[:300], 'suspended_at': utcnow(),
                 'suspended_by': g.admin.get('email')}, '$inc': {'token_version': 1}})
    invalidate_user(user_id)
    audit('user.suspend', 'user', user_id, {'reason': str(reason)[:300]})
    return True, None


def reactivate_user(user_id):
    res = mongo.db.users.update_one({'_id': user_id}, {
        '$set': {'is_active': True}, '$unset': {'suspended_reason': '', 'suspended_at': '', 'suspended_by': ''}})
    if not res.matched_count:
        return False, 'User not found'
    invalidate_user(user_id)
    audit('user.reactivate', 'user', user_id)
    return True, None


def purge_user(user_id):
    """Delete a user and everything that references them. Returns (ok, error)."""
    if user_id == g.admin['_id']:
        return False, 'You cannot delete your own account here'
    user = mongo.db.users.find_one({'_id': user_id}, {'is_admin': 1, 'email': 1, 'full_name': 1})
    if not user:
        return False, 'User not found'
    if user.get('is_admin') and not _other_admin_exists(user_id):
        return False, 'Cannot delete the last active admin'
    db, uid = mongo.db, str(user_id)
    post_ids = [p['_id'] for p in db.posts.find({'author': user_id}, {'_id': 1})]
    db.workouts.delete_many({'user_id': uid})
    db.posts.delete_many({'author': user_id})
    db.posts.update_many({}, {'$pull': {'likes': user_id, 'comments': {'user': uid}}})
    db.messages.delete_many({'$or': [{'sender': user_id}, {'receiver': user_id}]})
    db.friend_requests.delete_many({'$or': [{'sender': user_id}, {'receiver': user_id}]})
    db.reports.delete_many({'$or': [{'reporter_id': user_id}, {'post_id': {'$in': post_ids}}]})
    db.ai_usage.delete_many({'user_id': uid})
    db.users.update_many({'friends': user_id}, {'$pull': {'friends': user_id}})
    db.users.delete_one({'_id': user_id})
    invalidate_user(user_id)
    audit('user.delete', 'user', user_id, {'email': user.get('email'), 'name': user.get('full_name')})
    return True, None


def _temp_password():
    # Always satisfies the app's policy (upper + lower + digit, >= 8)
    body = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(10))
    return f'Aa1{body}'


# ── list / export ───────────────────────────────────────────────────────────
def _user_query():
    a, q = request.args, {}
    if a.get('q'):
        r = rx(a['q'])
        q['$or'] = [{'full_name': r}, {'email': r}, {'username': r}]
    if a.get('status') == 'active':
        q['is_active'] = {'$ne': False}
    elif a.get('status') == 'suspended':
        q['is_active'] = False
    role = a.get('role')
    if role == 'admin':
        q['is_admin'] = True
    elif role == 'moderator':
        q['is_moderator'] = True
    elif role == 'staff':
        q.setdefault('$and', []).append({'$or': [{'is_admin': True}, {'is_moderator': True}]})
    elif role == 'user':
        q['is_admin'] = {'$ne': True}
        q['is_moderator'] = {'$ne': True}
    # quick filters
    try:
        if a.get('joined_within'):
            q['created_at'] = {'$gte': utcnow() - _td(days=int(a['joined_within']))}
        if a.get('inactive_days'):
            cutoff = utcnow() - _td(days=int(a['inactive_days']))
            q.setdefault('$and', []).append({'$or': [{'last_active': {'$lt': cutoff}}, {'last_active': None}]})
    except ValueError:
        pass
    if a.get('level'):
        q['fitness_level'] = a['level']
    return q


def _sort():
    field = request.args.get('sort', 'created_at')
    field = field if field in SORTABLE else 'created_at'
    return field, (1 if request.args.get('order') == 'asc' else -1)


def _row(u, stats=None):
    s = (stats or {}).get(str(u['_id']), {})
    return {
        'id': str(u['_id']), 'full_name': u.get('full_name', ''), 'username': u.get('username', ''),
        'email': u.get('email', ''), 'age': u.get('age'), 'gender': u.get('gender', ''),
        'fitness_level': u.get('fitness_level', ''), 'points': u.get('points', 0),
        'is_admin': bool(u.get('is_admin')), 'is_moderator': bool(u.get('is_moderator')),
        'role': 'admin' if u.get('is_admin') else 'moderator' if u.get('is_moderator') else 'user',
        'is_active': u.get('is_active', True) is not False,
        'suspended_reason': u.get('suspended_reason', ''),
        'created_at': iso_utc(u.get('created_at')), 'last_active': iso_utc(u.get('last_active')),
        'workouts': s.get('n', 0), 'minutes': int(s.get('secs', 0) / 60)}


@admin_bp.route('/users', methods=['GET'])
@staff_required
def users_list():
    q, (field, direction) = _user_query(), _sort()
    page, limit = page_args(20, 100)
    total = mongo.db.users.count_documents(q)
    docs = list(mongo.db.users.find(q, LIST_PROJECTION).sort([(field, direction), ('_id', 1)])
                .skip((page - 1) * limit).limit(limit))
    ids = [str(u['_id']) for u in docs]
    stats = {r['_id']: r for r in mongo.db.workouts.aggregate([
        {'$match': {'user_id': {'$in': ids}}},
        {'$group': {'_id': '$user_id', 'n': {'$sum': 1}, 'secs': {'$sum': '$duration'}}}])} if ids else {}
    return jsonify(success=True, users=[_row(u, stats) for u in docs], **page_meta(total, page, limit))


@admin_bp.route('/users/export', methods=['GET'])
@admin_required
def users_export():
    field, direction = _sort()
    rows = [_row(u) for u in mongo.db.users.find(_user_query(), LIST_PROJECTION).sort(field, direction).limit(10000)]
    audit('user.export', 'user', None, {'rows': len(rows)})
    return csv_response('aivo_users.csv',
                        ['ID', 'Name', 'Username', 'Email', 'Age', 'Gender', 'Level', 'Points', 'Admin', 'Active',
                         'Joined', 'Last active'],
                        [[r['id'], r['full_name'], r['username'], r['email'], r['age'], r['gender'],
                          r['fitness_level'], r['points'], r['is_admin'], r['is_active'], r['created_at'],
                          r['last_active']] for r in rows])


# ── detail ──────────────────────────────────────────────────────────────────
@admin_bp.route('/users/<user_id>', methods=['GET'])
@staff_required
def user_detail(user_id):
    _id = oid(user_id)
    user = mongo.db.users.find_one({'_id': _id}, {'password': 0}) if _id else None
    if not user:
        return err('User not found', 404)
    db, uid = mongo.db, str(_id)
    agg = list(db.workouts.aggregate([{'$match': {'user_id': uid}},
                                      {'$group': {'_id': None, 'n': {'$sum': 1}, 'secs': {'$sum': '$duration'}}}]))
    recent_workouts = list(db.workouts.find({'user_id': uid}).sort('start_time', -1).limit(10))
    recent_posts = list(db.posts.find({'author': _id}, {'image': 0}).sort('createdAt', -1).limit(5))
    user['streak'] = effective_streak(user, valid_tz(user.get('tz')), persist=False)
    picture = user.pop('profile_picture', None)
    history = user.pop('weight_history', [])
    friends = user.pop('friends', []) or []
    detail = ser(user)
    detail.update({'id': str(_id), 'is_active': user.get('is_active', True) is not False,
                   'is_admin': bool(user.get('is_admin')), 'is_moderator': bool(user.get('is_moderator')),
                   'role': 'admin' if user.get('is_admin') else 'moderator' if user.get('is_moderator') else 'user',
                   'profile_picture': picture})
    detail.pop('_id', None)
    return jsonify(
        success=True, user=detail, weight_history=history[-20:],
        stats={'workouts': agg[0]['n'] if agg else 0, 'minutes': int((agg[0]['secs'] if agg else 0) / 60),
               'friends': len(friends), 'posts': db.posts.count_documents({'author': _id}),
               'messages_sent': db.messages.count_documents({'sender': _id}),
               'reports_against': db.reports.count_documents({'post_author': _id}),
               'ai_requests_30d': db.ai_usage.count_documents({'user_id': uid, 'ts': {'$gte': utcnow() - timedelta(days=30)}})},
        recent_workouts=[{'id': w['_id'], 'activity_type': w.get('activity_type'), 'duration': w.get('duration', 0),
                          'start_time': iso_utc(w.get('start_time'))} for w in recent_workouts],
        recent_posts=[{'id': str(p['_id']), 'content': (p.get('content') or '')[:160], 'hidden': bool(p.get('hidden')),
                       'likes': len(p.get('likes') or []), 'comments': len(p.get('comments') or []),
                       'created_at': iso_utc(p.get('createdAt'))} for p in recent_posts],
        activity=[ser(a) for a in db.audit_logs.find({'target_id': uid}).sort('ts', -1).limit(10)])


# ── create / edit ───────────────────────────────────────────────────────────
@admin_bp.route('/users', methods=['POST'])
@admin_required
def user_create():
    from ..auth.routes import _generate_username, validate_email, validate_password
    data = request.get_json() or {}
    email, name = str(data.get('email', '')).strip().lower(), str(data.get('full_name', '')).strip()
    password = str(data.get('password', ''))
    if not name:
        return err('Full name is required')
    if not validate_email(email):
        return err('Enter a valid email address')
    ok, msg = validate_password(password)
    if not ok:
        return err(msg)
    if mongo.db.users.find_one({'email': email}):
        return err('Email already registered', 409)
    doc = {'email': email, 'password': generate_password_hash(password), 'full_name': name,
           'username': _generate_username(name), 'age': None, 'gender': '', 'weight': None, 'height': None,
           'fitness_level': str(data.get('fitness_level', '')), 'fitness_goals': [], 'medical_conditions': '',
           'preferred_units': 'metric', 'target_weight': None, 'profile_picture': None, 'friends': [],
           'last_active': None, 'created_at': utcnow(), 'is_admin': bool(data.get('is_admin')),
           'is_active': True, 'profile_complete': False, 'points': 0, 'created_by_admin': g.admin.get('email')}
    res = mongo.db.users.insert_one(doc)
    audit('user.create', 'user', res.inserted_id, {'email': email, 'is_admin': doc['is_admin']})
    return jsonify(success=True, id=str(res.inserted_id)), 201


@admin_bp.route('/users/<user_id>', methods=['PUT'])
@admin_required
def user_update(user_id):
    from ..auth.routes import validate_email
    _id, data = oid(user_id), request.get_json() or {}
    user = mongo.db.users.find_one({'_id': _id}) if _id else None
    if not user:
        return err('User not found', 404)
    patch = {k: str(data[k]).strip() for k in EDITABLE_TEXT if k in data}
    if 'full_name' in patch and not patch['full_name']:
        return err('Full name cannot be empty')
    if 'email' in data:
        email = str(data['email']).strip().lower()
        if not validate_email(email):
            return err('Enter a valid email address')
        if email != user.get('email') and mongo.db.users.find_one({'email': email}):
            return err('Email already registered', 409)
        patch['email'] = email
    if 'username' in patch and patch['username'] != user.get('username') \
            and mongo.db.users.find_one({'username': patch['username'], '_id': {'$ne': _id}}):
        return err('Username already taken', 409)
    try:
        for f, lo, hi, cast in (('age', 10, 120, int), ('weight', 20, 400, lambda v: int(round(float(v)))),
                                ('target_weight', 20, 400, lambda v: int(round(float(v)))),
                                ('height', 80, 260, lambda v: round(float(v), 1)), ('points', 0, 10 ** 9, int)):
            if f in data and data[f] not in (None, ''):
                v = cast(data[f])
                if not lo <= v <= hi:
                    return err(f'{f} must be between {lo} and {hi}')
                patch[f] = v
    except (TypeError, ValueError):
        return err('Numeric fields contain an invalid value')
    if 'fitness_goals' in data:
        goals = data['fitness_goals']
        if not isinstance(goals, list):
            return err('fitness_goals must be a list')
        patch['fitness_goals'] = [str(g_)[:60] for g_ in goals][:10]
    if not patch:
        return err('Nothing to update')
    mongo.db.users.update_one({'_id': _id}, {'$set': patch})
    changes = {k: {'from': user.get(k), 'to': v} for k, v in patch.items()
               if user.get(k) != v and k != 'medical_conditions'}
    audit('user.update', 'user', _id, ser(changes))
    return jsonify(success=True, message='User updated')


# ── actions ─────────────────────────────────────────────────────────────────
def _target(user_id):
    _id = oid(user_id)
    return _id if _id and mongo.db.users.count_documents({'_id': _id}, limit=1) else None


@admin_bp.route('/users/<user_id>/suspend', methods=['POST'])
@admin_required
def user_suspend(user_id):
    _id = _target(user_id)
    if not _id:
        return err('User not found', 404)
    ok, error = suspend_user(_id, (request.get_json() or {}).get('reason', ''))
    return jsonify(success=True) if ok else err(error)


@admin_bp.route('/users/<user_id>/reactivate', methods=['POST'])
@admin_required
def user_reactivate(user_id):
    ok, error = reactivate_user(oid(user_id))
    return jsonify(success=True) if ok else err(error, 404)


@admin_bp.route('/users/<user_id>/role', methods=['POST'])
@admin_required
def user_role(user_id):
    """Body: {role: 'user'|'moderator'|'admin'}  (legacy {is_admin: bool} still accepted)."""
    _id, data = _target(user_id), request.get_json() or {}
    if not _id:
        return err('User not found', 404)
    role = data.get('role') or ('admin' if data.get('is_admin') is True else 'user' if data.get('is_admin') is False else None)
    if role not in ('user', 'moderator', 'admin'):
        return err('role must be user, moderator or admin')
    if _id == g.admin['_id']:
        return err('You cannot change your own role')
    if role != 'admin' and not _other_admin_exists(_id):
        return err('There must always be at least one active admin')
    mongo.db.users.update_one({'_id': _id}, {'$set': {'is_admin': role == 'admin', 'is_moderator': role == 'moderator'}})
    invalidate_user(_id)
    audit('user.role', 'user', _id, {'role': role})
    return jsonify(success=True, role=role)


@admin_bp.route('/users/<user_id>/email', methods=['POST'])
@admin_required
def user_email(user_id):
    """Send an email to one member through the server's SMTP settings."""
    import smtplib
    from email.message import EmailMessage
    from flask import current_app
    cfg = current_app.config
    if not cfg.get('SMTP_HOST'):
        return err('Email is not configured on the server. Set SMTP_HOST / SMTP_USER / SMTP_PASSWORD / SMTP_FROM in backend/.env.', 400)
    _id, data = oid(user_id), request.get_json() or {}
    user = mongo.db.users.find_one({'_id': _id}, {'email': 1, 'full_name': 1}) if _id else None
    if not user:
        return err('User not found', 404)
    subject, body = str(data.get('subject', '')).strip()[:150], str(data.get('message', '')).strip()[:5000]
    if not subject or not body:
        return err('Subject and message are required')
    msg = EmailMessage()
    msg['Subject'], msg['To'] = subject, user['email']
    msg['From'] = cfg.get('SMTP_FROM') or cfg.get('SMTP_USER')
    msg.set_content(f"Hi {user.get('full_name', '')},\n\n{body}\n\n— The Aivo team")
    try:
        with smtplib.SMTP(cfg['SMTP_HOST'], cfg['SMTP_PORT'], timeout=15) as smtp:
            smtp.starttls()
            if cfg.get('SMTP_USER'):
                smtp.login(cfg['SMTP_USER'], cfg['SMTP_PASSWORD'])
            smtp.send_message(msg)
    except Exception as exc:
        return err(f'Could not send email: {str(exc)[:120]}', 502)
    audit('user.email', 'user', _id, {'subject': subject})
    return jsonify(success=True, message=f"Email sent to {user['email']}")


@admin_bp.route('/users/<user_id>/reset-password', methods=['POST'])
@admin_required
def user_reset_password(user_id):
    from ..auth.routes import validate_password
    _id = _target(user_id)
    if not _id:
        return err('User not found', 404)
    password = str((request.get_json() or {}).get('password') or '')
    if password:
        ok, msg = validate_password(password)
        if not ok:
            return err(msg)
    else:
        password = _temp_password()
    mongo.db.users.update_one({'_id': _id}, {'$set': {'password': generate_password_hash(password)},
                                             '$inc': {'token_version': 1}})
    invalidate_user(_id)
    audit('user.reset_password', 'user', _id)
    return jsonify(success=True, temp_password=password)   # shown once; never stored in plain text


@admin_bp.route('/users/<user_id>/force-logout', methods=['POST'])
@admin_required
def user_force_logout(user_id):
    _id = _target(user_id)
    if not _id:
        return err('User not found', 404)
    _bump_tv(_id)
    audit('user.force_logout', 'user', _id)
    return jsonify(success=True)


@admin_bp.route('/users/<user_id>/adjust-points', methods=['POST'])
@admin_required
def user_adjust_points(user_id):
    _id, data = oid(user_id), request.get_json() or {}
    user = mongo.db.users.find_one({'_id': _id}, {'points': 1}) if _id else None
    if not user:
        return err('User not found', 404)
    try:
        value = int(data.get('value'))
    except (TypeError, ValueError):
        return err('value must be a whole number')
    old = int(user.get('points', 0) or 0)
    new = max(0, value if data.get('mode') == 'set' else old + value)
    mongo.db.users.update_one({'_id': _id}, {'$set': {'points': new}})
    audit('user.adjust_points', 'user', _id, {'from': old, 'to': new, 'reason': str(data.get('reason', ''))[:200]})
    return jsonify(success=True, points=new)


@admin_bp.route('/users/<user_id>', methods=['DELETE'])
@admin_required
def user_delete(user_id):
    _id = oid(user_id)
    if not _id:
        return err('User not found', 404)
    ok, error = purge_user(_id)
    return jsonify(success=True, message='User deleted') if ok else err(error)


@admin_bp.route('/users/bulk', methods=['POST'])
@admin_required
def users_bulk():
    data = request.get_json() or {}
    ids, action = data.get('ids') or [], data.get('action')
    if not isinstance(ids, list) or not ids or len(ids) > 100:
        return err('Select between 1 and 100 users')
    if action not in ('suspend', 'reactivate', 'delete'):
        return err('Unknown action')
    done, skipped = 0, []
    for raw in ids:
        _id = oid(raw)
        if not _id:
            skipped.append({'id': str(raw), 'reason': 'Invalid id'})
            continue
        if action == 'suspend':
            ok, error = suspend_user(_id, data.get('reason', ''))
        elif action == 'reactivate':
            ok, error = reactivate_user(_id)
        else:
            ok, error = purge_user(_id)
        if ok:
            done += 1
        else:
            skipped.append({'id': str(raw), 'reason': error})
    return jsonify(success=True, done=done, skipped=skipped)
