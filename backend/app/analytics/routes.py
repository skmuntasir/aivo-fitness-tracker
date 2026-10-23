"""Progress dashboard data. Rewritten to avoid loading every workout ever logged and the
30 sequential per-day queries; week boundaries are now computed in the user's timezone."""
from datetime import datetime, timedelta
from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson.objectid import ObjectId
from app import mongo
from app.utils import (request_tz, local_today, local_date, local_midnight_utc,
                       effective_streak)

analytics_bp = Blueprint('analytics', __name__, url_prefix='/api/analytics')

DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
KCAL_PER_MIN = 60  # rough estimate used across the app


def _kcal(seconds):
    return int((seconds / 60) * KCAL_PER_MIN)


@analytics_bp.route('/progress-summary', methods=['GET'])
@jwt_required()
def progress_summary():
    try:
        user_id = get_jwt_identity()
        tz = request_tz()
        user = mongo.db.users.find_one({'_id': ObjectId(user_id)}, {'password': 0, 'profile_picture': 0})
        if not user:
            return jsonify({'success': False, 'message': 'User not found'}), 404

        today = local_today(tz)
        week_start_d = today - timedelta(days=today.weekday())
        prev_week_start_d = week_start_d - timedelta(days=7)
        prev_week_start = local_midnight_utc(prev_week_start_d, tz)
        week_start = local_midnight_utc(week_start_d, tz)

        # Only the last two weeks are pulled into Python (projection keeps it tiny).
        recent = list(mongo.db.workouts.find(
            {'user_id': user_id, 'start_time': {'$gte': prev_week_start}},
            {'start_time': 1, 'duration': 1, '_id': 0}))

        def bucket(from_d):
            days = [{'day': DAY_LABELS[i], 'seconds': 0, 'sessions': 0} for i in range(7)]
            for w in recent:
                idx = (local_date(w['start_time'], tz) - from_d).days
                if 0 <= idx < 7:
                    days[idx]['seconds'] += w.get('duration', 0)
                    days[idx]['sessions'] += 1
            return days

        def fmt(days):
            return [{'day': d['day'], 'calories': _kcal(d['seconds']),
                     'duration': int(d['seconds'] / 60), 'sessions': d['sessions']} for d in days]

        this_days, prev_days = bucket(week_start_d), bucket(prev_week_start_d)
        daily_data, prev_daily_data = fmt(this_days), fmt(prev_days)
        this_secs = sum(d['seconds'] for d in this_days)
        prev_secs = sum(d['seconds'] for d in prev_days)
        weekly_workouts = sum(d['sessions'] for d in this_days)
        prev_workouts = sum(d['sessions'] for d in prev_days)

        # Lifetime totals in one aggregation (was: load all docs, sum in Python).
        agg = list(mongo.db.workouts.aggregate([
            {'$match': {'user_id': user_id}},
            {'$group': {'_id': None, 'n': {'$sum': 1}, 'secs': {'$sum': '$duration'}}}]))
        total_workouts = agg[0]['n'] if agg else 0
        total_secs = agg[0]['secs'] if agg else 0

        # Consecutive active days: ONE grouped query over the last 60 days (was up to 30 queries).
        since = local_midnight_utc(today - timedelta(days=60), tz)
        active_days = {local_date(w['start_time'], tz).isoformat() for w in mongo.db.workouts.find(
            {'user_id': user_id, 'start_time': {'$gte': since}}, {'start_time': 1, '_id': 0})}
        consecutive, d = 0, today
        # Today not yet trained doesn't break a running streak.
        if d.isoformat() not in active_days:
            d -= timedelta(days=1)
        while d.isoformat() in active_days:
            consecutive += 1
            d -= timedelta(days=1)

        consistency_pct = round(sum(1 for x in this_days if x['sessions']) / 7 * 100)
        prev_consistency = round(sum(1 for x in prev_days if x['sessions']) / 7 * 100)

        streak = effective_streak(user, tz)
        points = user.get('points', 0)

        current_weight = user.get('weight', 0) or 0
        target_weight = user.get('target_weight') or current_weight
        history = user.get('weight_history') or []
        if len(history) < 2 and current_weight and user.get('created_at'):
            # Only REAL points: the weight they registered with, and their current weight.
            first = history[0]['weight'] if history else user.get('start_weight', current_weight)
            history = [{'date': user['created_at'].strftime('%Y-%m-%d'), 'weight': first},
                       {'date': today.isoformat(), 'weight': current_weight}]
        weight_history = [{'week': datetime.strptime(h['date'], '%Y-%m-%d').strftime('%d %b'),
                           'date': h['date'], 'weight': h['weight']} for h in history[-12:]]
        start_weight = weight_history[0]['weight'] if weight_history else current_weight

        goal_type = 'fat_loss'
        goals = user.get('fitness_goals') or []
        if goals:
            g = str(goals[0]).lower()
            if any(k in g for k in ('muscle', 'strength', 'gain')):
                goal_type = 'muscle_gain'
            elif any(k in g for k in ('endurance', 'cardio')):
                goal_type = 'endurance'

        this_cal = _kcal(this_secs)
        weight_needed = max(start_weight - target_weight, 0.01)
        goal_progress = max(0, min(((start_weight - current_weight) / weight_needed) * 100, 100))
        health_score = int(min(consistency_pct, 100) * 0.30
                           + min((this_cal / 4500) * 100, 100) * 0.20
                           + min((streak / 21) * 100, 100) * 0.20
                           + 80 * 0.15 + goal_progress * 0.15)

        return jsonify({'success': True, 'summary': {
            'name': (user.get('full_name') or 'User').split()[0],
            'streak': streak, 'points': points, 'goal_type': goal_type,
            'total_workouts': total_workouts, 'weekly_workouts': weekly_workouts,
            'prev_week_workouts': prev_workouts, 'consecutive_days': consecutive,
            'week_calories': this_cal, 'prev_week_calories': _kcal(prev_secs),
            'total_calories': _kcal(total_secs),
            'consistency_pct': consistency_pct, 'prev_consistency_pct': prev_consistency,
            'weight': current_weight, 'target_weight': target_weight, 'start_weight': start_weight,
            'goal_weeks': 12,
            # Sleep/hydration are NOT tracked yet: defaults, flagged so the UI can label them.
            'avg_sleep': 7.0, 'hydration': 75, 'wellness_estimated': True,
            'daily_data': daily_data, 'prev_daily_data': prev_daily_data,
            'weight_history': weight_history, 'health_score': health_score}}), 200

    except Exception:
        import traceback
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': 'Could not build progress summary'}), 500
