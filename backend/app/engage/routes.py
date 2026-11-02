"""HTTP endpoints for: streak freeze, badges, friend challenges, saved coach plans."""
import re
import uuid
import hashlib
from datetime import timedelta, date as _date
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson.objectid import ObjectId

from app.extensions import mongo
from app.utils import (utcnow, iso_utc, request_tz, local_today, local_midnight_utc,
                       streak_from_days, compute_streak, _active_days, _frozen_days)
from . import badges as badge_svc
from . import challenges as challenge_svc

engage_bp = Blueprint('engage', __name__, url_prefix='/api')


# ───────────────────────── Streak freeze ─────────────────────────
# One freeze per calendar week (Mon-Sun, user's timezone) turns a rest day into a "kept" day:
# it does not add to the streak, it just stops the streak from breaking.

def _week_start(d):
    return d - timedelta(days=d.weekday())


def _freeze_state(user_id, tz):
    uid = str(user_id)
    today = local_today(tz)
    since = local_midnight_utc(today - timedelta(days=60), tz)
    days = _active_days(uid, tz, since)
    frozen = _frozen_days(uid)
    recent = sorted(d for d in frozen if d >= today - timedelta(days=60))
    used_weeks = {_week_start(d) for d in frozen}

    def check(target):
        if _week_start(target) in used_weeks:
            return False, 'used', "You've already used this week's streak freeze."
        if target in days:
            return False, 'trained', 'You already trained that day, so no freeze is needed.'
        with_freeze = streak_from_days(days, today, frozen | {target})
        if with_freeze < 1:
            return False, 'no_streak', 'Build a streak first. A freeze protects a streak you already have.'
        if target < today and with_freeze <= streak_from_days(days, today, frozen):
            return False, 'pointless', 'That day is already covered.'
        return True, None, None

    ok_today, why_today, msg_today = check(today)
    ok_yest, why_yest, msg_yest = check(today - timedelta(days=1))
    week = _week_start(today)
    return {
        'today': today.isoformat(), 'week_start': week.isoformat(),
        'used_this_week': week in used_weeks,
        'frozen_dates': [d.isoformat() for d in recent],
        'frozen_today': today in frozen,
        'can_freeze_today': ok_today, 'today_reason': why_today, 'today_message': msg_today,
        'can_freeze_yesterday': ok_yest and today not in frozen,
        'streak': compute_streak(uid, tz)[0],
    }


@engage_bp.route('/streak/freeze', methods=['GET'])
@jwt_required()
def freeze_status():
    return jsonify(success=True, **_freeze_state(get_jwt_identity(), request_tz()))


@engage_bp.route('/streak/freeze', methods=['POST'])
@jwt_required()
def use_freeze():
    uid = str(get_jwt_identity())
    tz = request_tz()
    which = ((request.get_json(silent=True) or {}).get('day') or 'today').lower()
    if which not in ('today', 'yesterday'):
        return jsonify(success=False, message='Choose today or yesterday.'), 400
    state = _freeze_state(uid, tz)
    today = local_today(tz)
    target = today if which == 'today' else today - timedelta(days=1)
    ok = state['can_freeze_today'] if which == 'today' else state['can_freeze_yesterday']
    if not ok:
        reason = state['today_message'] if which == 'today' else "That day can't be frozen."
        return jsonify(success=False, message=reason or "A freeze can't be used right now."), 409
    try:
        mongo.db.streak_freezes.insert_one({
            '_id': str(uuid.uuid4()), 'user_id': uid, 'date': target.isoformat(),
            'week_start': _week_start(target).isoformat(), 'created_at': utcnow()})
    except Exception:
        return jsonify(success=False, message="That day is already frozen."), 409
    streak, _ = compute_streak(uid, tz)
    try:
        mongo.db.users.update_one({'_id': ObjectId(uid)}, {'$set': {'streak': streak}})
    except Exception:
        pass
    return jsonify(success=True, message='Rest day frozen. Your streak is safe.', **_freeze_state(uid, tz))


@engage_bp.route('/streak/freeze', methods=['DELETE'])
@jwt_required()
def undo_freeze():
    """Take back today's freeze (e.g. you decided to train after all)."""
    uid = str(get_jwt_identity())
    tz = request_tz()
    res = mongo.db.streak_freezes.delete_one({'user_id': uid, 'date': local_today(tz).isoformat()})
    if not res.deleted_count:
        return jsonify(success=False, message='There is no freeze to undo today.'), 404
    streak, _ = compute_streak(uid, tz)
    try:
        mongo.db.users.update_one({'_id': ObjectId(uid)}, {'$set': {'streak': streak}})
    except Exception:
        pass
    return jsonify(success=True, **_freeze_state(uid, tz))


# ───────────────────────── Badges ─────────────────────────

@engage_bp.route('/badges', methods=['GET'])
@jwt_required()
def my_badges():
    items = badge_svc.evaluate(badge_svc.gather_stats(get_jwt_identity(), request_tz()))
    return jsonify(success=True, badges=items, earned_count=sum(1 for b in items if b['earned']), total=len(items))


@engage_bp.route('/badges/user/<user_id>', methods=['GET'])
@jwt_required()
def user_badges(user_id):
    """Earned badges of another member (shown in the leaderboard player sheet)."""
    try:
        oid = ObjectId(user_id)
    except Exception:
        return jsonify(success=False, message='Invalid user.'), 400
    u = mongo.db.users.find_one({'_id': oid, 'is_active': {'$ne': False}}, {'tz': 1})
    if not u:
        return jsonify(success=False, message='User not found.'), 404
    items = badge_svc.evaluate(badge_svc.gather_stats(str(oid), u.get('tz') or request_tz()))
    earned = [b for b in items if b['earned']]
    return jsonify(success=True, badges=earned, earned_count=len(earned), total=len(items))


# ───────────────────────── Friend challenges ─────────────────────────

@engage_bp.route('/challenges', methods=['GET'])
@jwt_required()
def list_challenges():
    items = challenge_svc.list_for(get_jwt_identity())
    incoming = sum(1 for c in items if c['status'] == 'pending' and c['role'] == 'opponent')
    return jsonify(success=True, challenges=items, incoming_count=incoming)


@engage_bp.route('/challenges', methods=['POST'])
@jwt_required()
def create_challenge():
    friend_id = str((request.get_json(silent=True) or {}).get('friend_id') or '')
    doc, err, status = challenge_svc.create(get_jwt_identity(), friend_id, request_tz())
    if err:
        return jsonify(success=False, message=err), status
    return jsonify(success=True, message='Challenge sent!', id=doc['_id']), 201


def _own_challenge(cid, role):
    uid = str(get_jwt_identity())
    c = mongo.db.challenges.find_one({'_id': cid, role: uid})
    return uid, c


@engage_bp.route('/challenges/<cid>/accept', methods=['PUT'])
@jwt_required()
def accept_challenge(cid):
    uid, c = _own_challenge(cid, 'opponent')
    if not c:
        return jsonify(success=False, message='Challenge not found.'), 404
    if c['status'] != 'pending' or c['week_end'] <= utcnow():
        return jsonify(success=False, message='This challenge is no longer open.'), 409
    mongo.db.challenges.update_one({'_id': cid, 'status': 'pending'}, {'$set': {'status': 'active', 'accepted_at': utcnow()}})
    return jsonify(success=True, message="Challenge accepted. Game on!")


@engage_bp.route('/challenges/<cid>/decline', methods=['PUT'])
@jwt_required()
def decline_challenge(cid):
    uid, c = _own_challenge(cid, 'opponent')
    if not c:
        return jsonify(success=False, message='Challenge not found.'), 404
    if c['status'] != 'pending':
        return jsonify(success=False, message='This challenge is no longer open.'), 409
    mongo.db.challenges.update_one({'_id': cid, 'status': 'pending'}, {'$set': {'status': 'declined'}})
    return jsonify(success=True, message='Challenge declined.')


@engage_bp.route('/challenges/<cid>', methods=['DELETE'])
@jwt_required()
def cancel_challenge(cid):
    uid, c = _own_challenge(cid, 'challenger')
    if not c:
        return jsonify(success=False, message='Challenge not found.'), 404
    if c['status'] != 'pending':
        return jsonify(success=False, message='Only a challenge that has not been accepted yet can be cancelled.'), 409
    mongo.db.challenges.update_one({'_id': cid, 'status': 'pending'}, {'$set': {'status': 'cancelled'}})
    return jsonify(success=True, message='Challenge cancelled.')


# ───────────────────────── Saved plans ─────────────────────────

MAX_PLANS = 50
MAX_PLAN_CHARS = 8000
_MEAL = re.compile(r'\b(meal|breakfast|lunch|dinner|snacks?|calories|kcal|protein|carbs?|macros?|oatmeal|eggs?|rice|chicken)\b', re.I)
_WORK = re.compile(r'\b(workout|exercises?|sets?|reps?|warm-?up|cool-?down|squats?|push-?ups?|lunges?|planks?|cardio|rest|training|day \d)\b', re.I)


def detect_kind(text):
    m, w = len(_MEAL.findall(text)), len(_WORK.findall(text))
    if m >= 3 and m > w:
        return 'meal'
    if w >= 3:
        return 'workout'
    return 'meal' if m >= 3 else 'other'


def _title_for(text):
    """First meaningful line, with markdown markers (#, **, bullets) removed but inner hyphens kept."""
    for line in text.splitlines():
        t = re.sub(r'^[\s#>*•\-–]+', '', line)
        t = t.replace('**', '').replace('__', '').replace('`', '')
        t = re.sub(r'\s+', ' ', t).strip(' *_:.')
        if len(t) >= 4:
            return t[:60]
    return 'Coach plan'


def _plan_json(p):
    return {'id': p['_id'], 'kind': p.get('kind', 'other'), 'title': p.get('title', 'Coach plan'),
            'content': p.get('content', ''), 'created_at': iso_utc(p.get('created_at'))}


@engage_bp.route('/plans', methods=['GET'])
@jwt_required()
def list_plans():
    uid = str(get_jwt_identity())
    rows = mongo.db.saved_plans.find({'user_id': uid}).sort('created_at', -1).limit(MAX_PLANS)
    return jsonify(success=True, plans=[_plan_json(p) for p in rows])


@engage_bp.route('/plans', methods=['POST'])
@jwt_required()
def save_plan():
    uid = str(get_jwt_identity())
    data = request.get_json(silent=True) or {}
    content = str(data.get('content') or '').strip()
    if len(content) < 20:
        return jsonify(success=False, message='There is nothing to save yet.'), 400
    content = content[:MAX_PLAN_CHARS]
    digest = hashlib.sha1(content.encode('utf-8')).hexdigest()
    existing = mongo.db.saved_plans.find_one({'user_id': uid, 'digest': digest})
    if existing:
        return jsonify(success=True, duplicate=True, message='This plan is already saved.', plan=_plan_json(existing))
    if mongo.db.saved_plans.count_documents({'user_id': uid}) >= MAX_PLANS:
        return jsonify(success=False, message=f"You've reached {MAX_PLANS} saved plans. Delete one to save another."), 400
    kind = data.get('kind') if data.get('kind') in ('workout', 'meal', 'other') else detect_kind(content)
    title = str(data.get('title') or '').strip()[:80] or _title_for(content)
    doc = {'_id': str(uuid.uuid4()), 'user_id': uid, 'kind': kind, 'title': title,
           'content': content, 'digest': digest, 'created_at': utcnow()}
    mongo.db.saved_plans.insert_one(doc)
    return jsonify(success=True, message='Plan saved to your profile.', plan=_plan_json(doc)), 201


@engage_bp.route('/plans/<pid>', methods=['DELETE'])
@jwt_required()
def delete_plan(pid):
    res = mongo.db.saved_plans.delete_one({'_id': pid, 'user_id': str(get_jwt_identity())})
    if not res.deleted_count:
        return jsonify(success=False, message='Plan not found.'), 404
    return jsonify(success=True, message='Plan removed.')
