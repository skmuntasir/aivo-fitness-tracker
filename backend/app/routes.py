from datetime import datetime, timedelta
import uuid
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson.objectid import ObjectId
from app import mongo
from app.utils import (parse_client_dt, valid_tz, request_tz, local_date,
                       local_today, effective_streak, compute_streak, streaks_for_users, utcnow,
                       _frozen_days, iso_utc, local_midnight_utc)

workouts_bp = Blueprint('workouts', __name__, url_prefix="/api/workouts")
users_bp = Blueprint('users', __name__, url_prefix="/api/users")

# ── Fair-play limits for workouts / points ──────────────────────────────────
MAX_WORKOUT_SECONDS = 3 * 3600      # hard cap on one workout
MIN_WORKOUT_SECONDS = 60            # shorter sessions are not logged (no streak / heat-map credit)
POINT_SECONDS = 60                  # 1 minute of training = 1 point
DAILY_POINTS_CAP = 600              # most points one person can earn per (local) day
CHECKIN_EVERY_S = 30 * 60           # "Still working out?" is asked this long after the last confirmation
CHECKIN_GRACE_S = 2 * 60            # ... and the person has this long to answer
_SLACK_S = 15                       # network / clock slack when judging a check-in

LIMITS = {'max_seconds': MAX_WORKOUT_SECONDS, 'min_seconds': MIN_WORKOUT_SECONDS,
          'checkin_every': CHECKIN_EVERY_S, 'checkin_grace': CHECKIN_GRACE_S, 'daily_cap': DAILY_POINTS_CAP}


def _session_payload(sess, now):
    return {'session_id': sess['sid'], 'activity_type': sess.get('activity_type'),
            'start_time': iso_utc(sess['start_time']), 'last_confirmed': iso_utc(sess['last_confirmed']),
            'server_now': iso_utc(now), 'limits': LIMITS}


@workouts_bp.route('/start', methods=['POST'])
@jwt_required()
def start_workout():
    """Open a workout session. The SERVER records the start time, so the client can't claim any duration it likes.
    One open session per user: starting again replaces the old one (nothing is credited for it)."""
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    activity = str(data.get('activity_type') or '').strip()[:60]
    if not activity:
        return jsonify(success=False, message='Select an activity first.'), 400
    now = utcnow()
    sess = {'_id': user_id, 'sid': str(uuid.uuid4()), 'activity_type': activity, 'tz': valid_tz(data.get('tz')),
            'start_time': now, 'last_confirmed': now}
    mongo.db.workout_sessions.replace_one({'_id': user_id}, sess, upsert=True)
    return jsonify(success=True, **_session_payload(sess, now))


@workouts_bp.route('/active', methods=['GET'])
@jwt_required()
def active_workout():
    """The caller's open session, if any (lets the timer resume after a refresh)."""
    now = utcnow()
    sess = mongo.db.workout_sessions.find_one({'_id': get_jwt_identity()})
    if not sess:
        return jsonify(success=True, active=False, limits=LIMITS)
    return jsonify(success=True, active=True, **_session_payload(sess, now))


@workouts_bp.route('/checkin', methods=['POST'])
@jwt_required()
def checkin_workout():
    """"Yes, I'm still here". Must arrive within the grace window after the prompt, otherwise the session counts as
    abandoned and only the time up to the prompt is credited when it is saved."""
    user_id = get_jwt_identity()
    sid = str((request.get_json(silent=True) or {}).get('session_id') or '')
    sess = mongo.db.workout_sessions.find_one({'_id': user_id, 'sid': sid})
    if not sess:
        return jsonify(success=False, code='no_session', message='This workout is no longer active.'), 409
    now = utcnow()
    if now > sess['last_confirmed'] + timedelta(seconds=CHECKIN_EVERY_S + CHECKIN_GRACE_S + _SLACK_S):
        return jsonify(success=False, code='expired', message='Check-in came too late, the timer was stopped.'), 409
    mongo.db.workout_sessions.update_one({'_id': user_id, 'sid': sid}, {'$set': {'last_confirmed': now}})
    return jsonify(success=True, server_now=iso_utc(now))


@workouts_bp.route('/cancel', methods=['POST'])
@jwt_required()
def cancel_workout():
    """Discard the open session without saving anything."""
    mongo.db.workout_sessions.delete_one({'_id': get_jwt_identity()})
    return jsonify(success=True)


def _points_for(duration, streak):
    """1 minute = 1 point (whole minutes). No multipliers. `streak` is kept only so callers don't change."""
    return max(int(duration) // POINT_SECONDS, 0)


@workouts_bp.route('/complete', methods=['POST'])
@jwt_required()
def complete_workout():
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    try:
        # The session is consumed atomically: it can be saved once, and only by the session that owns it.
        sess = mongo.db.workout_sessions.find_one_and_delete(
            {'_id': user_id, 'sid': str(data.get('session_id') or '')})
        if not sess:
            return jsonify(success=False, message='This workout is no longer active (it may already be saved, '
                                                  'or was restarted in another tab).'), 409

        # Everything is judged on SERVER time; times and durations sent by the browser are ignored.
        tz, start, confirmed, now = sess.get('tz') or 'UTC', sess['start_time'], sess['last_confirmed'], utcnow()
        auto_stopped = now > confirmed + timedelta(seconds=CHECKIN_EVERY_S + CHECKIN_GRACE_S)
        end = confirmed + timedelta(seconds=CHECKIN_EVERY_S) if auto_stopped else now   # abandoned: credit up to the prompt
        duration = min(int((end - start).total_seconds()), MAX_WORKOUT_SECONDS)
        if duration < MIN_WORKOUT_SECONDS:
            return jsonify(success=False, message='Workout too short to log. Keep going for at least 1 minute.'), 400
        end = start + timedelta(seconds=duration)

        # Badges: remember what was already earned so we can tell the user what just unlocked.
        badges_before = None
        try:
            from app.engage import badges as badge_svc
            badges_before = badge_svc.earned_ids(badge_svc.evaluate(badge_svc.gather_stats(user_id, tz)))
        except Exception as exc:
            print(f"[badges] before-check skipped: {exc}")

        workout_id = str(uuid.uuid4())
        mongo.db.workouts.insert_one({
            "_id": workout_id, "user_id": user_id, "start_time": start, "end_time": end, "duration": duration,
            "activity_type": sess.get('activity_type') or data.get('activity_type'), "tz": tz, "points": 0})

        # Trained on a day that had a streak freeze: the freeze is not needed, give it back.
        try:
            mongo.db.streak_freezes.delete_one({"user_id": user_id, "date": local_date(start, tz).isoformat()})
        except Exception:
            pass

        # Streak is derived from the real workout records (the row above is already inserted), so the
        # popup, Home, heatmap, leaderboard and profile can never disagree.
        streak, last_day = compute_streak(user_id, tz)
        set_fields = {"streak": streak, "tz": tz}
        if last_day:
            set_fields["last_workout_date"] = last_day.isoformat()

        # Points: diminishing returns inside one workout + a daily ceiling across workouts.
        raw = _points_for(duration, streak)
        day = local_date(start, tz)
        day_start, day_end = local_midnight_utc(day, tz), local_midnight_utc(day + timedelta(days=1), tz)
        earned_today = sum(int(w.get('points') or 0) for w in mongo.db.workouts.find(
            {"user_id": user_id, "start_time": {"$gte": day_start, "$lt": day_end}, "_id": {"$ne": workout_id}},
            {"points": 1}))
        points = max(0, min(raw, DAILY_POINTS_CAP - earned_today))
        mongo.db.workouts.update_one({"_id": workout_id}, {"$set": {"points": points}})
        mongo.db.users.update_one({"_id": ObjectId(user_id)}, {"$set": set_fields, "$inc": {"points": points}})

        new_badges = []
        if badges_before is not None:
            try:
                after = badge_svc.evaluate(badge_svc.gather_stats(user_id, tz))
                new_badges = [{k: b[k] for k in ('id', 'name', 'desc', 'icon', 'tier')}
                              for b in after if b['earned'] and b['id'] not in badges_before]
            except Exception as exc:
                print(f"[badges] after-check skipped: {exc}")
        return jsonify(success=True, message="Workout logged!", points_earned=points, points_raw=raw,
                       daily_cap_hit=points < raw and earned_today + points >= DAILY_POINTS_CAP,
                       daily_points_left=max(0, DAILY_POINTS_CAP - earned_today - points),
                       auto_stopped=auto_stopped, length_capped=duration >= MAX_WORKOUT_SECONDS,
                       streak=streak, duration=duration, new_badges=new_badges)
    except (KeyError, ValueError, TypeError) as e:
        return jsonify(success=False, message=f"Invalid workout data: {e}"), 400
    except Exception as e:
        print(f"Error in complete_workout: {e}")
        return jsonify(success=False, message="Could not log workout"), 500


GLOBAL_LEADERBOARD_SIZE = 15
FRIENDS_LEADERBOARD_CAP = 200
_LB_FIELDS = {"full_name": 1, "points": 1, "tz": 1}


def _relations(me_id, user_ids, friend_ids=None):
    """Relationship of `me_id` to each of `user_ids`: me | friends | request_sent |
    request_received | none (+ the request id when one is waiting for me to accept)."""
    if friend_ids is None:
        doc = mongo.db.users.find_one({"_id": me_id}, {"friends": 1}) or {}
        friend_ids = doc.get("friends") or []
    friends = set(friend_ids)
    others = [u for u in user_ids if u != me_id]
    sent, received = {}, {}
    if others:
        sent = {r["receiver"]: r for r in mongo.db.friend_requests.find(
            {"sender": me_id, "receiver": {"$in": others}, "status": "pending"}, {"receiver": 1})}
        received = {r["sender"]: r for r in mongo.db.friend_requests.find(
            {"receiver": me_id, "sender": {"$in": others}, "status": "pending"}, {"sender": 1})}
    out = {}
    for u in user_ids:
        if u == me_id:
            out[u] = ("me", None)
        elif u in friends:
            out[u] = ("friends", None)
        elif u in sent:
            out[u] = ("request_sent", None)
        elif u in received:
            out[u] = ("request_received", str(received[u]["_id"]))
        else:
            out[u] = ("none", None)
    return out


def _lb_rows(users, me_id, default_tz, friend_ids=None):
    """Rank `users` (already sorted by points desc). Equal points share a rank, which keeps
    these rows consistent with the 'my global rank' count below."""
    streaks = streaks_for_users(users, default_tz)   # live streaks, same rule as Home / heatmap
    rels = _relations(me_id, [u["_id"] for u in users], friend_ids)
    rows, prev_points, prev_rank = [], None, 0
    for i, u in enumerate(users, start=1):
        pts = int(u.get("points", 0) or 0)
        rank = prev_rank if pts == prev_points else i
        prev_points, prev_rank = pts, rank
        rel, req_id = rels.get(u["_id"], ("none", None))
        rows.append({"rank": rank, "id": str(u["_id"]), "name": u.get("full_name") or "N/A", "points": pts,
                     "streak": streaks.get(str(u["_id"]), 0), "is_me": u["_id"] == me_id,
                     "relation": rel, "request_id": req_id})
    return rows


@workouts_bp.route('/leaderboard', methods=['GET'])
@jwt_required()
def leaderboard():
    """GET /api/workouts/leaderboard?scope=global|friends  (default: global)

    global  -> top 15 players + the caller's own global rank (`me`, always present).
    friends -> the caller and their friends, ranked among themselves.
    """
    scope = (request.args.get('scope') or 'global').lower()
    try:
        me_id = ObjectId(get_jwt_identity())
    except Exception:
        return jsonify(success=False, message="Invalid user ID format"), 400
    tz = request_tz()
    active = {"is_active": {"$ne": False}}

    if scope == 'friends':
        me_doc = mongo.db.users.find_one({"_id": me_id}, {**_LB_FIELDS, "friends": 1})
        if not me_doc:
            return jsonify(success=False, message="User not found"), 404
        ids = list({me_id, *(me_doc.get("friends") or [])})[:FRIENDS_LEADERBOARD_CAP + 1]
        users = list(mongo.db.users.find({"_id": {"$in": ids}, **active}, _LB_FIELDS)
                     .sort([("points", -1), ("_id", 1)]))
        rows = _lb_rows(users, me_id, tz, me_doc.get("friends") or [])
        me = next((r for r in rows if r["is_me"]), None)
        return jsonify(success=True, scope='friends', leaderboard=rows, me=me,
                       friend_count=max(len(rows) - 1, 0))

    if scope != 'global':
        return jsonify(success=False, message="Unknown leaderboard scope"), 400

    top = list(mongo.db.users.find(active, _LB_FIELDS)
               .sort([("points", -1), ("_id", 1)]).limit(GLOBAL_LEADERBOARD_SIZE))
    rows = _lb_rows(top, me_id, tz)
    me = next((r for r in rows if r["is_me"]), None)
    if me is None:   # caller is outside the top 15 -> compute their real global position
        me_doc = mongo.db.users.find_one({"_id": me_id}, _LB_FIELDS)
        if me_doc:
            pts = int(me_doc.get("points", 0) or 0)
            ahead = mongo.db.users.count_documents({**active, "points": {"$gt": pts}})
            me = {"rank": ahead + 1, "id": str(me_id), "name": me_doc.get("full_name") or "N/A", "points": pts,
                  "streak": streaks_for_users([me_doc], tz).get(str(me_id), 0), "is_me": True,
                  "relation": "me", "request_id": None}
    return jsonify(success=True, scope='global', leaderboard=rows, me=me,
                   total_players=mongo.db.users.count_documents(active))


@workouts_bp.route('/daily-summary', methods=['GET'])
@jwt_required()
def daily_summary():
    """Per-day totals, grouped in the *user's* timezone (was UTC => off-by-one days).
    Optional ?year=YYYY limits the scan (served by the user_id+start_time index)."""
    user_id = get_jwt_identity()
    tz = request_tz()
    match = {"user_id": user_id}
    try:
        year = int(request.args.get('year', 0))
    except ValueError:
        year = 0
    if year:
        match["start_time"] = {"$gte": datetime(year - 1, 12, 30), "$lt": datetime(year + 1, 1, 2)}

    # Group by LOCAL day in Python: tiny projected rows served by the (user_id, start_time) index,
    # and independent of Mongo's timezone-aware date operators.
    totals = {}
    for w in mongo.db.workouts.find(match, {"start_time": 1, "duration": 1, "_id": 0}):
        key = local_date(w["start_time"], tz).isoformat()
        totals[key] = totals.get(key, 0) + int(w.get("duration", 0) or 0)
    streak, _ = compute_streak(user_id, tz)
    frozen = sorted(d.isoformat() for d in _frozen_days(user_id) if not year or d.year == year)
    return jsonify(success=True, tz=tz, streak=streak, frozen_dates=frozen, streak_data=[
        {"date": d, "total_duration": totals[d]} for d in sorted(totals)])


@workouts_bp.route('/stats', methods=['GET'])
@jwt_required()
def workout_stats():
    """Cheap endpoint for the Home header (replaces calling the heavy progress-summary)."""
    user_id = get_jwt_identity()
    tz = request_tz()
    user = mongo.db.users.find_one({'_id': ObjectId(user_id)},
                                   {'streak': 1, 'points': 1, 'last_workout_date': 1, 'tz': 1})
    total = mongo.db.workouts.count_documents({'user_id': user_id})
    return jsonify(success=True, total_workouts=total,
                   streak=effective_streak(user or {}, tz), points=(user or {}).get('points', 0))


@users_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    try:
        user_obj = ObjectId(get_jwt_identity())
    except Exception:
        return jsonify(success=False, message="Invalid user ID format"), 400
    user = mongo.db.users.find_one({"_id": user_obj}, {"password": 0, "profile_picture": 0})
    if not user:
        return jsonify(success=False, message="User not found"), 404
    return jsonify(success=True, email=user.get("email", ""), points=user.get("points", 0),
                   streak=effective_streak(user, request_tz()))
