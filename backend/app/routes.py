from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import uuid
from bson.objectid import ObjectId
from pymongo.errors import PyMongoError
from app import mongo


# Calorie Calculator Blueprint
calorie_bp = Blueprint('calorie', __name__)


@calorie_bp.route('/api/calculate-calories', methods=['POST'])
@jwt_required()
def calculate_calories():
    data = request.get_json()
    age = data.get('age')
    weight = data.get('weight')
    height = data.get('height')
    gender = data.get('gender')
    activity = data.get('activityLevel')
    goal = data.get('goal')

    if not all([age, weight, height, gender, activity, goal]):
        return jsonify({'success': False, 'message': 'All fields are required'}), 400

    # BMR Calculation (Mifflin-St Jeor Equation)
    try:
        if gender.lower() == 'male':
            bmr = 10 * float(weight) + 6.25 * float(height) - 5 * int(age) + 5
        else:
            bmr = 10 * float(weight) + 6.25 * float(height) - 5 * int(age) - 161

        activity_factors = {
            "sedentary": 1.2,
            "light": 1.375,
            "moderate": 1.55,
            "active": 1.725,
            "very active": 1.9
        }
        calories = bmr * activity_factors.get(activity, 1.2)

        if goal == 'lose':
            calories -= 500
        elif goal == 'gain':
            calories += 500

        return jsonify({'success': True, 'calories': int(calories)}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error calculating: {str(e)}'}), 500


# Workouts Blueprint
workouts_bp = Blueprint('workouts', __name__, url_prefix="/api/workouts")


@workouts_bp.route('/complete', methods=['POST'])
@jwt_required()
def complete_workout():
    user_id = get_jwt_identity()
    data = request.json
    try:
        workout_document = {
            "_id": str(uuid.uuid4()),
            "user_id": user_id,
            "start_time": datetime.fromisoformat(data['start_time']),
            "end_time": datetime.fromisoformat(data['end_time']),
            "duration": data['duration'],  # duration in seconds
            "activity_type": data.get('activity_type')
        }

        mongo.db.workouts.insert_one(workout_document)

        
        user = mongo.db.users.find_one({"_id": ObjectId(user_id)})
        current_streak = user.get("streak", 0)
        total_points = user.get("points", 0)

       
        last_workout = mongo.db.workouts.find_one(
            {"user_id": user_id, "start_time": {"$lt": workout_document["start_time"]}},
            sort=[("start_time", -1)]
        )

        new_date = workout_document["start_time"].date()
        if last_workout:
            last_date = last_workout["start_time"].date()
            if (new_date - last_date) == timedelta(days=1):
                updated_streak = current_streak + 1
            elif new_date == last_date:
                updated_streak = current_streak
            else:
                updated_streak = 1
        else:
            updated_streak = 1

        
        duration_seconds = int(workout_document['duration'])
        base_points = duration_seconds // 5

        streak_multiplier = min(1.0 + 0.1 * updated_streak, 2.0)  
        points_earned = int(base_points * streak_multiplier)

        
        print(f"Updating user {user_id}: setting streak = {updated_streak}, adding points = {points_earned}")

        result = mongo.db.users.update_one(
            {"_id": ObjectId(user_id)},
            {"$set": {"streak": updated_streak},
             "$inc": {"points": points_earned}}
        )

        print(f"Update result: acknowledged={result.acknowledged}, matched_count={result.matched_count}, modified_count={result.modified_count}")

        return jsonify(
            success=True,
            message="Workout logged!",
            workout_id=workout_document["_id"],
            points_earned=points_earned,
            streak=updated_streak
        )
    except Exception as e:
        print(f"Error in complete_workout: {str(e)}")
        return jsonify(success=False, message=str(e)), 400


@workouts_bp.route('/leaderboard', methods=['GET'])
@jwt_required()
def leaderboard():
    
    top_users = mongo.db.users.find({}, {"full_name": 1, "points": 1, "streak": 1}).sort("points", -1).limit(10)

    leaderboard_list = []
    for idx, user in enumerate(top_users, start=1):
        leaderboard_list.append({
            "rank": idx,
            "name": user.get("full_name", "N/A"),  
            "points": user.get("points", 0),
            "streak": user.get("streak", 0)
        })

    return jsonify(success=True, leaderboard=leaderboard_list)



@workouts_bp.route('/daily-summary', methods=['GET'])
@jwt_required()
def daily_summary():
    user_id = get_jwt_identity()

    pipeline = [
        {"$match": {"user_id": user_id}},
        {"$group": {
            "_id": {
                "year": {"$year": "$start_time"},
                "month": {"$month": "$start_time"},
                "day": {"$dayOfMonth": "$start_time"}
            },
            "total_duration": {"$sum": "$duration"}
        }},
        {"$sort": {"_id": 1}}
    ]
    results = list(mongo.db.workouts.aggregate(pipeline))

    daily_data = []
    for entry in results:
        y, m, d = entry['_id']['year'], entry['_id']['month'], entry['_id']['day']
        date_str = f"{y:04d}-{m:02d}-{d:02d}"
        daily_data.append({
            "date": date_str,
            "total_duration": int(entry["total_duration"])
        })
    return jsonify(success=True, streak_data=daily_data)



users_bp = Blueprint('users', __name__, url_prefix="/api/users")


@users_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({"success": False, "message": "Missing user identity"}), 401

        try:
            user_object_id = ObjectId(user_id)
        except Exception:
            return jsonify({"success": False, "message": "Invalid user ID format"}), 400

        user = mongo.db.users.find_one({"_id": user_object_id}, {"password": 0})
        if user:
            return jsonify({
                "success": True,
                "email": user.get("email", ""),
                "points": user.get("points", 0),
                "streak": user.get("streak", 0)
            })
        else:
            return jsonify({"success": False, "message": "User not found"}), 404
    except Exception as e:
        return jsonify({"success": False, "message": f"Unexpected error: {str(e)}"}), 500









@workouts_bp.route('/stats', methods=['GET'])
@jwt_required()
def workout_stats():
    user_id = get_jwt_identity()
    try:
        total = mongo.db.workouts.count_documents({'user_id': user_id})
        user = mongo.db.users.find_one({'_id': ObjectId(user_id)})
        return jsonify({
            'success': True,
            'total_workouts': total,
            'streak': user.get('streak', 0) if user else 0,
            'points': user.get('points', 0) if user else 0,
        }), 200
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
