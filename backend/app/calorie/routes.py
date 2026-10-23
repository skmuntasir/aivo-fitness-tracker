from math import floor
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

calorie_bp = Blueprint('calorie', __name__)

ACTIVITY_FACTORS = {"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "active": 1.725, "very active": 1.9}


@calorie_bp.route('/api/calculate-calories', methods=['POST'])
@jwt_required()
def calculate_calories():
    data = request.get_json() or {}
    age, weight, height = data.get('age'), data.get('weight'), data.get('height')
    gender, activity, goal = data.get('gender'), data.get('activityLevel'), data.get('goal')

    if not all([age, weight, height, gender, activity, goal]):
        return jsonify({'success': False, 'message': 'All fields are required'}), 400
    try:
        age, weight, height = int(age), float(weight), float(height)
        if not (10 <= age <= 120 and 20 <= weight <= 400 and 80 <= height <= 260):
            return jsonify({'success': False, 'message': 'Values are out of a realistic range'}), 400
        # Mifflin-St Jeor
        bmr = 10 * weight + 6.25 * height - 5 * age + (5 if str(gender).lower() == 'male' else -161)
        calories = bmr * ACTIVITY_FACTORS.get(activity, 1.2)
        if goal == 'lose':
            calories -= 500
        elif goal == 'gain':
            calories += 500
        return jsonify({'success': True, 'calories': floor(calories)}), 200
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': 'Invalid numeric input'}), 400
