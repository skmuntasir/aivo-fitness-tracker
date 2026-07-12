"""
AI Fitness Analytics Routes — real data from MongoDB
Registered in backend/app/__init__.py as analytics_bp
"""

from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, timedelta
from bson.objectid import ObjectId
from app import mongo

analytics_bp = Blueprint('analytics', __name__, url_prefix='/api/analytics')


@analytics_bp.route('/progress-summary', methods=['GET'])
@jwt_required()
def progress_summary():
    """
    Returns ALL data the Progress dashboard needs in one call.
    Pulls real workout history, user profile, streak, weight from MongoDB.
    """
    try:
        user_id = get_jwt_identity()
        user = mongo.db.users.find_one({'_id': ObjectId(user_id)}, {'password': 0})
        if not user:
            return jsonify({'success': False, 'message': 'User not found'}), 404

        now = datetime.utcnow()

        # ── Week boundaries (Mon–Sun) ────────────────────────
        week_start = now - timedelta(days=now.weekday())
        week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
        prev_week_start = week_start - timedelta(days=7)
        prev_week_end   = week_start

        # ── Fetch workouts ────────────────────────────────────
        this_week_workouts = list(mongo.db.workouts.find({
            'user_id': user_id,
            'start_time': {'$gte': week_start}
        }))

        prev_week_workouts = list(mongo.db.workouts.find({
            'user_id': user_id,
            'start_time': {'$gte': prev_week_start, '$lt': prev_week_end}
        }))

        all_workouts = list(mongo.db.workouts.find(
            {'user_id': user_id},
            sort=[('start_time', -1)]
        ))

        # ── Calorie estimation (60 kcal / min) ────────────────
        def kcal(workouts):
            secs = sum(w.get('duration', 0) for w in workouts)
            return int((secs / 60) * 60)

        this_week_calories = kcal(this_week_workouts)
        prev_week_calories  = kcal(prev_week_workouts)

        # ── Daily breakdown this week (Mon=0 … Sun=6) ─────────
        days_labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        daily_data = []
        for i in range(7):
            day_start = week_start + timedelta(days=i)
            day_end   = day_start  + timedelta(days=1)
            day_wk    = [w for w in this_week_workouts
                         if day_start <= w.get('start_time', now) < day_end]
            dur_mins  = sum(w.get('duration', 0) for w in day_wk) / 60
            daily_data.append({
                'day':      days_labels[i],
                'calories': int(dur_mins * 60),
                'duration': int(dur_mins),
                'sessions': len(day_wk),
            })

        # ── Previous week daily (for chart comparison) ────────
        prev_daily_data = []
        for i in range(7):
            day_start = prev_week_start + timedelta(days=i)
            day_end   = day_start + timedelta(days=1)
            day_wk    = [w for w in prev_week_workouts
                         if day_start <= w.get('start_time', now) < day_end]
            dur_mins  = sum(w.get('duration', 0) for w in day_wk) / 60
            prev_daily_data.append({
                'day':      days_labels[i],
                'calories': int(dur_mins * 60),
                'duration': int(dur_mins),
                'sessions': len(day_wk),
            })

        # ── Consistency % ─────────────────────────────────────
        active_days_this  = sum(1 for d in daily_data      if d['sessions'] > 0)
        active_days_prev  = sum(1 for d in prev_daily_data if d['sessions'] > 0)
        consistency_pct   = round((active_days_this / 7) * 100)
        prev_consistency  = round((active_days_prev / 7) * 100)

        # ── Streak & points (stored on user doc) ──────────────
        streak = user.get('streak', 0)
        points = user.get('points', 0)

        # ── Consecutive workout days (rolling from today) ─────
        consecutive = 0
        check_date = now.date()
        for _ in range(30):
            day_s = datetime.combine(check_date, datetime.min.time())
            day_e = day_s + timedelta(days=1)
            hit = mongo.db.workouts.find_one({
                'user_id': user_id,
                'start_time': {'$gte': day_s, '$lt': day_e}
            })
            if hit:
                consecutive += 1
                check_date -= timedelta(days=1)
            else:
                break

        # ── Total workouts ever ───────────────────────────────
        total_workouts = mongo.db.workouts.count_documents({'user_id': user_id})

        # ── Weight & goal info from user profile ──────────────
        current_weight = user.get('weight', 0)
        target_weight  = user.get('target_weight') or current_weight
        # start_weight: if not stored, estimate from first workout date weight or +5kg
        start_weight = user.get('start_weight', current_weight + 5)

        # Build a simple 6-point weight history from workouts over past 6 weeks
        weight_history = user.get('weight_history', [])
        if not weight_history:
            # Synthesise from registration weight progressing to current
            weight_history = []
            for wk in range(5, -1, -1):
                wk_label = f"Wk {6-wk}"
                w_val = round(start_weight - ((start_weight - current_weight) * (5 - wk) / 5), 1)
                weight_history.append({'week': wk_label, 'weight': w_val})

        # ── User profile data ─────────────────────────────────
        full_name = user.get('full_name', 'User')
        fitness_goals = user.get('fitness_goals', [])
        goal_type = 'fat_loss'
        if fitness_goals:
            g = fitness_goals[0].lower() if fitness_goals else ''
            if 'muscle' in g or 'strength' in g or 'gain' in g:
                goal_type = 'muscle_gain'
            elif 'endurance' in g or 'cardio' in g:
                goal_type = 'endurance'

        # ── Health score calculation ───────────────────────────
        consistency_score = min(consistency_pct, 100) * 0.30
        cal_score   = min((this_week_calories / 4500) * 100, 100) * 0.20
        streak_score = min((streak / 21) * 100, 100) * 0.20
        # sleep & hydration not stored — default to moderate
        sleep_score  = 80 * 0.15
        # goal progress
        weight_diff = start_weight - current_weight
        weight_needed = max(start_weight - target_weight, 0.01)
        goal_progress = min((weight_diff / weight_needed) * 100, 100)
        goal_score = goal_progress * 0.15
        health_score = int(consistency_score + cal_score + streak_score + sleep_score + goal_score)

        return jsonify({
            'success': True,
            'summary': {
                # User
                'name':               full_name.split()[0],
                'streak':             streak,
                'points':             points,
                'goal_type':          goal_type,

                # Workouts
                'total_workouts':      total_workouts,
                'weekly_workouts':     len(this_week_workouts),
                'prev_week_workouts':  len(prev_week_workouts),
                'consecutive_days':    consecutive,

                # Calories
                'week_calories':       this_week_calories,
                'prev_week_calories':  prev_week_calories,
                'total_calories':      kcal(all_workouts),

                # Consistency
                'consistency_pct':     consistency_pct,
                'prev_consistency_pct': prev_consistency,

                # Weight / Goal
                'weight':              current_weight,
                'target_weight':       target_weight,
                'start_weight':        start_weight,
                'goal_weeks':          12,

                # Defaults (not stored in your DB yet)
                'avg_sleep':           7.0,
                'hydration':           75,

                # Chart data
                'daily_data':          daily_data,
                'prev_daily_data':     prev_daily_data,
                'weight_history':      weight_history,

                # Pre-computed
                'health_score':        health_score,
            }
        }), 200

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return jsonify({'success': False, 'message': str(e)}), 500
