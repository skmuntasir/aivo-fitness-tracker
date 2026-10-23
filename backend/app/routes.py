from datetime import datetime, timedelta
import uuid
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson.objectid import ObjectId
from app import mongo
from app.utils import (parse_client_dt, valid_tz, request_tz, local_date,
                       local_today, effective_streak, compute_streak, streaks_for_users, utcnow)

workouts_bp = Blueprint('workouts', __name__, url_prefix="/api/workouts")
users_bp = Blueprint('users', __name__, url_prefix="/api/users")

MAX_WORKOUT_SECONDS = 12 * 3600


@workouts_bp.route('/complete', methods=['POST'])
@jwt_required()
def complete_workout():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    try:
        start = parse_client_dt(data['start_time'])
        end = parse_client_dt(data['end_time'])
        tz = valid_tz(data.get('tz'))

        # Never trust the client's duration blindly: cap by wall-clock time (+5s slack).
        claimed = int(data['duration'])
        wall = max(int((end - start).total_seconds()), 0)
        duration = max(0, min(claimed, wall + 5, MAX_WORKOUT_SECONDS))
        if duration < 1:
            return jsonify(success=False, message='Workout too short to log.'), 400

        mongo.db.workouts.insert_one({
            "_id": str(uuid.uuid4()), "user_id": user_id,
            "start_time": start, "end_time": end, "duration": duration,
            "activity_type": data.get('activity_type'), "tz": tz})

        # Streak is derived from the real workout records (the row above is already inserted), so the
        # popup, Home, heatmap, leaderboard and profile can never disagree.
        streak, last_day = compute_streak(user_id, tz)
        set_fields = {"streak": streak, "tz": tz}
        if last_day:
            set_fields["last_workout_date"] = last_day.isoformat()

        points = int((duration // 5) * min(1.0 + 0.1 * streak, 2.0))
        mongo.db.users.update_one({"_id": ObjectId(user_id)},
                                  {"$set": set_fields, "$inc": {"points": points}})
        return jsonify(success=True, message="Workout logged!",
                       points_earned=points, streak=streak, duration=duration)
    except (KeyError, ValueError, TypeError) as e:
        return jsonify(success=False, message=f"Invalid workout data: {e}"), 400
    except Exception as e:
        print(f"Error in complete_workout: {e}")
        return jsonify(success=False, message="Could not log workout"), 500


@workouts_bp.route('/leaderboard', methods=['GET'])
@jwt_required()
def leaderboard():
    top = list(mongo.db.users.find({"is_active": {"$ne": False}}, {"full_name": 1, "points": 1, "tz": 1}) \
        .sort("points", -1).limit(10))
    # Live streaks from the workout records (same rule as Home / heatmap), not the stored counter.
    streaks = streaks_for_users(top, request_tz())
    return jsonify(success=True, leaderboard=[
        {"rank": i, "name": u.get("full_name", "N/A"),
         "points": u.get("points", 0), "streak": streaks.get(str(u["_id"]), 0)}
        for i, u in enumerate(top, start=1)])


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
    return jsonify(success=True, tz=tz, streak=streak, streak_data=[
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
