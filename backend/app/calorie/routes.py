from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from math import floor

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

        return jsonify({'success': True, 'calories': floor(calories)}), 200
    except Exception as e:
        return jsonify({'success': False, 'message': f'Error calculating: {str(e)}'}), 500



