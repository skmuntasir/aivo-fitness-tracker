"""Admin: auth, dashboard, charts, system health, audit log, settings, announcements."""
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta

from flask import g, jsonify, request
from flask_jwt_extended import create_access_token
from werkzeug.security import check_password_hash, generate_password_hash

from . import admin_bp
from .guards import (admin_public, admin_required, staff_required, audit, err, oid, page_args, page_meta, rx, ser,
                     parse_day, role_of)
from ..extensions import mongo
from ..runtime import DEFAULT_SETTINGS, get_settings, invalidate_user, save_settings
from ..social.socket import online_users
from ..utils import iso_utc, rate_limit, utcnow

_STARTED = time.time()


# ───────────────────────────── auth ─────────────────────────────
@admin_bp.route('/auth/login', methods=['POST'])
@rate_limit('admin_login', 8, 300)
def admin_login():
    data = request.get_json() or {}
    email = str(data.get('email', '')).strip().lower()
    password = str(data.get('password', ''))
    if not email or not password:
        return err('Email and password are required')
    user = mongo.db.users.find_one({'email': email})
    if not user or not check_password_hash(user.get('password', ''), password):
        return err('Invalid credentials', 401)
    if user.get('is_active', True) is False:
        return err('This account is suspended', 403)
    if role_of(user) == 'user':
        return err('This account does not have admin access', 403)

    token = create_access_token(identity=str(user['_id']), expires_delta=timedelta(hours=12),
                                additional_claims={'tv': int(user.get('token_version', 0) or 0)})
    g.admin = user
    mongo.db.users.update_one({'_id': user['_id']}, {'$set': {'last_active': utcnow()}})
    audit('admin.login', 'admin', user['_id'])
    return jsonify(success=True, token=token, admin=admin_public(user))


@admin_bp.route('/auth/me', methods=['GET'])
@staff_required
def admin_me():
    return jsonify(success=True, admin=admin_public(g.admin))


@admin_bp.route('/auth/change-password', methods=['POST'])
@staff_required
def change_password():
    from ..auth.routes import validate_password
    data = request.get_json() or {}
    if not check_password_hash(g.admin.get('password') or mongo.db.users.find_one(
            {'_id': g.admin['_id']}, {'password': 1})['password'], str(data.get('current_password', ''))):
        return err('Current password is incorrect', 400)
    ok, msg = validate_password(str(data.get('new_password', '')))
    if not ok:
        return err(msg)
    tv = int(g.admin.get('token_version', 0) or 0) + 1   # ends every other session of this admin
    mongo.db.users.update_one({'_id': g.admin['_id']}, {
        '$set': {'password': generate_password_hash(data['new_password']), 'token_version': tv}})
    invalidate_user(g.admin['_id'])
    audit('admin.change_password', 'admin', g.admin['_id'])
    token = create_access_token(identity=str(g.admin['_id']), expires_delta=timedelta(hours=12),
                                additional_claims={'tv': tv})
    return jsonify(success=True, message='Password updated', token=token)


# ───────────────────────────── dashboard ─────────────────────────────
@admin_bp.route('/dashboard/overview', methods=['GET'])
@staff_required
def overview():
    db, now = mongo.db, utcnow()
    d1, d7, d14, d30 = (now - timedelta(days=n) for n in (1, 7, 14, 30))
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    secs = list(db.workouts.aggregate([{'$group': {'_id': None, 's': {'$sum': '$duration'}}}]))
    kpi = {
        'total_users': db.users.count_documents({}),
        'admins': db.users.count_documents({'is_admin': True}),
        'moderators': db.users.count_documents({'is_moderator': True}),
        'suspended_users': db.users.count_documents({'is_active': False}),
        'new_today': db.users.count_documents({'created_at': {'$gte': day_start}}),
        'new_7d': db.users.count_documents({'created_at': {'$gte': d7}}),
        'new_prev_7d': db.users.count_documents({'created_at': {'$gte': d14, '$lt': d7}}),
        'new_30d': db.users.count_documents({'created_at': {'$gte': d30}}),
        'active_24h': db.users.count_documents({'last_active': {'$gte': d1}}),
        'active_7d': db.users.count_documents({'last_active': {'$gte': d7}}),
        'active_30d': db.users.count_documents({'last_active': {'$gte': d30}}),
        'total_workouts': db.workouts.count_documents({}),
        'workouts_7d': db.workouts.count_documents({'start_time': {'$gte': d7}}),
        'workouts_prev_7d': db.workouts.count_documents({'start_time': {'$gte': d14, '$lt': d7}}),
        'training_hours': round((secs[0]['s'] if secs else 0) / 3600, 1),
        'total_posts': db.posts.count_documents({}),
        'posts_7d': db.posts.count_documents({'createdAt': {'$gte': d7}}),
        'hidden_posts': db.posts.count_documents({'hidden': True}),
        'total_messages': db.messages.count_documents({}),
        'messages_7d': db.messages.count_documents({'timestamp': {'$gte': d7}}),
        'open_reports': db.reports.count_documents({'status': 'open'}),
        'ai_requests_7d': db.ai_usage.count_documents({'ts': {'$gte': d7}}),
        'online_now': len(online_users),
    }
    proj = {'full_name': 1, 'email': 1, 'created_at': 1, 'points': 1, 'is_active': 1}
    recent = list(db.users.find({}, proj).sort('created_at', -1).limit(8))
    top = list(db.users.find({}, proj).sort('points', -1).limit(5))
    row = lambda u: {'id': str(u['_id']), 'full_name': u.get('full_name', ''), 'email': u.get('email', ''),
                     'created_at': iso_utc(u.get('created_at')), 'points': u.get('points', 0),
                     'is_active': u.get('is_active', True) is not False}
    return jsonify(success=True, kpi=kpi, recent_signups=[row(u) for u in recent], top_users=[row(u) for u in top])


@admin_bp.route('/dashboard/charts', methods=['GET'])
@staff_required
def charts():
    try:
        days = max(7, min(int(request.args.get('days', 30)), 90))
    except ValueError:
        days = 30
    db = mongo.db
    today = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    since = today - timedelta(days=days - 1)
    keys = [(since + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(days)]
    day = lambda dt: dt.strftime('%Y-%m-%d')

    signups, posts = Counter(), Counter()
    for u in db.users.find({'created_at': {'$gte': since}}, {'created_at': 1}):
        signups[day(u['created_at'])] += 1
    for p in db.posts.find({'createdAt': {'$gte': since}}, {'createdAt': 1}):
        posts[day(p['createdAt'])] += 1

    wk, minutes, dau, activity = Counter(), Counter(), defaultdict(set), Counter()
    for w in db.workouts.find({'start_time': {'$gte': since}},
                              {'start_time': 1, 'duration': 1, 'user_id': 1, 'activity_type': 1}):
        k = day(w['start_time'])
        wk[k] += 1
        minutes[k] += int((w.get('duration') or 0) / 60)
        dau[k].add(w.get('user_id'))
        activity[w.get('activity_type') or 'Unspecified'] += 1

    def dist(field):
        return [{'name': str(r['_id'] or 'Unknown'), 'value': r['n']} for r in db.users.aggregate(
            [{'$group': {'_id': f'${field}', 'n': {'$sum': 1}}}, {'$sort': {'n': -1}}])]

    goals = [{'name': str(r['_id'] or 'Unknown'), 'value': r['n']} for r in db.users.aggregate(
        [{'$unwind': '$fitness_goals'}, {'$group': {'_id': '$fitness_goals', 'n': {'$sum': 1}}},
         {'$sort': {'n': -1}}, {'$limit': 8}])]

    return jsonify(success=True, days=days, series=[
        {'date': k, 'signups': signups[k], 'workouts': wk[k], 'minutes': minutes[k],
         'active_users': len(dau[k]), 'posts': posts[k]} for k in keys],
        goals=goals, levels=dist('fitness_level'), genders=dist('gender'),
        activities=[{'name': n, 'value': v} for n, v in activity.most_common(8)])


# ───────────────────────────── system ─────────────────────────────
@admin_bp.route('/system/health', methods=['GET'])
@admin_required
def system_health():
    t0, db_ok = time.time(), True
    try:
        mongo.db.command('ping')
    except Exception:
        db_ok = False
    latency = round((time.time() - t0) * 1000, 1)
    counts = {}
    for name in ('users', 'workouts', 'posts', 'messages', 'friend_requests', 'reports', 'announcements', 'audit_logs'):
        try:
            counts[name] = mongo.db[name].count_documents({})
        except Exception:
            counts[name] = None
    return jsonify(success=True, health={
        'database': {'ok': db_ok, 'latency_ms': latency}, 'collections': counts,
        'online_users': len(online_users), 'ai_configured': bool(os.environ.get('GROQ_API_KEY')),
        'email_configured': bool(os.environ.get('SMTP_HOST')),
        'environment': os.environ.get('FLASK_ENV', 'development') or 'development',
        'python': sys.version.split()[0], 'uptime_seconds': int(time.time() - _STARTED),
        'server_time': iso_utc(utcnow()), 'settings': get_settings()})


# ───────────────────────────── audit log ─────────────────────────────
@admin_bp.route('/audit', methods=['GET'])
@admin_required
def audit_list():
    q = {}
    if request.args.get('actor'):
        q['actor_email'] = rx(request.args['actor'])
    if request.args.get('action'):
        q['action'] = rx(request.args['action'])
    if request.args.get('target_type'):
        q['target_type'] = request.args['target_type']
    start, end = parse_day(request.args.get('from')), parse_day(request.args.get('to'), end=True)
    if start or end:
        q['ts'] = {k: v for k, v in (('$gte', start), ('$lt', end)) if v}
    page, limit = page_args(30, 100)
    total = mongo.db.audit_logs.count_documents(q)
    rows = mongo.db.audit_logs.find(q).sort('ts', -1).skip((page - 1) * limit).limit(limit)
    return jsonify(success=True, logs=[ser(r) for r in rows], **page_meta(total, page, limit))


# ───────────────────────────── settings ─────────────────────────────
@admin_bp.route('/settings', methods=['GET'])
@admin_required
def settings_get():
    return jsonify(success=True, settings=get_settings(force=True))


@admin_bp.route('/settings', methods=['PUT'])
@admin_required
def settings_put():
    data, patch = request.get_json() or {}, {}
    for key in ('registration_enabled', 'ai_enabled', 'maintenance_mode'):
        if key in data:
            if not isinstance(data[key], bool):
                return err(f'{key} must be true or false')
            patch[key] = data[key]
    if 'maintenance_message' in data:
        msg = str(data['maintenance_message']).strip()[:240]
        patch['maintenance_message'] = msg or DEFAULT_SETTINGS['maintenance_message']
    if 'banned_words' in data:
        words = data['banned_words']
        if not isinstance(words, list):
            return err('banned_words must be a list')
        clean = []
        for w in words:
            w = str(w).strip().lower()[:40]
            if w and w not in clean:
                clean.append(w)
        patch['banned_words'] = clean[:200]
    if not patch:
        return err('Nothing to update')
    before = get_settings(force=True)
    new = save_settings(patch)
    audit('settings.update', 'settings', 'global',
          {k: {'from': before.get(k), 'to': new.get(k)} for k in patch if before.get(k) != new.get(k)})
    return jsonify(success=True, settings=new)


# ───────────────────────────── announcements ─────────────────────────────
ANN_TYPES = ('info', 'success', 'warning', 'critical')


def _ann_fields(data, partial=False):
    out = {}
    if 'title' in data or not partial:
        title = str(data.get('title', '')).strip()[:120]
        if not title:
            return None, 'Title is required'
        out['title'] = title
    if 'body' in data or not partial:
        out['body'] = str(data.get('body', '')).strip()[:1000]
    if 'type' in data or not partial:
        t = data.get('type', 'info')
        if t not in ANN_TYPES:
            return None, 'Invalid type'
        out['type'] = t
    if 'active' in data or not partial:
        out['active'] = bool(data.get('active', True))
    for key in ('starts_at', 'ends_at'):
        if key in data or not partial:
            v = data.get(key)
            if v in (None, ''):
                out[key] = None
            else:
                try:
                    from ..utils import parse_client_dt
                    out[key] = parse_client_dt(v)
                except Exception:
                    return None, f'Invalid {key}'
    if out.get('starts_at') and out.get('ends_at') and out['ends_at'] <= out['starts_at']:
        return None, 'End must be after start'
    return out, None


@admin_bp.route('/announcements', methods=['GET'])
@admin_required
def ann_list():
    rows = list(mongo.db.announcements.find({}).sort('created_at', -1).limit(100))
    now = utcnow()

    def state(a):
        if not a.get('active'):
            return 'inactive'
        if a.get('starts_at') and a['starts_at'] > now:
            return 'scheduled'
        if a.get('ends_at') and a['ends_at'] < now:
            return 'expired'
        return 'live'
    return jsonify(success=True, announcements=[{**ser(a), 'state': state(a)} for a in rows])


@admin_bp.route('/announcements', methods=['POST'])
@admin_required
def ann_create():
    fields, error = _ann_fields(request.get_json() or {})
    if error:
        return err(error)
    fields.update(created_by=g.admin.get('email'), created_at=utcnow(), updated_at=utcnow())
    res = mongo.db.announcements.insert_one(fields)
    audit('announcement.create', 'announcement', res.inserted_id, {'title': fields['title']})
    return jsonify(success=True, id=str(res.inserted_id)), 201


@admin_bp.route('/announcements/<ann_id>', methods=['PUT'])
@admin_required
def ann_update(ann_id):
    _id = oid(ann_id)
    fields, error = _ann_fields(request.get_json() or {}, partial=True)
    if error:
        return err(error)
    if not _id or not fields:
        return err('Nothing to update')
    fields['updated_at'] = utcnow()
    if not mongo.db.announcements.update_one({'_id': _id}, {'$set': fields}).matched_count:
        return err('Announcement not found', 404)
    audit('announcement.update', 'announcement', _id, {k: v for k, v in ser(fields).items() if k != 'updated_at'})
    return jsonify(success=True)


@admin_bp.route('/announcements/<ann_id>', methods=['DELETE'])
@admin_required
def ann_delete(ann_id):
    _id = oid(ann_id)
    if not _id or not mongo.db.announcements.delete_one({'_id': _id}).deleted_count:
        return err('Announcement not found', 404)
    audit('announcement.delete', 'announcement', _id)
    return jsonify(success=True)
