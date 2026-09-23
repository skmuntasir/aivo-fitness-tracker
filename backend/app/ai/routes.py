from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
import requests as http_requests
import os
 
ai_bp = Blueprint("ai", __name__, url_prefix="/api/ai")
 
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "openai/gpt-oss-20b"   # was "llama-3.1-8b-instant"
 
 
def get_api_key():
    return os.environ.get("GROQ_API_KEY", "")
 
 
def get_user_profile(mongo, user_id):
    try:
        user = mongo.db.users.find_one({"_id": ObjectId(user_id)})
        if not user:
            return {}
        profile = {
            "name":               user.get("full_name", ""),
            "age":                user.get("age"),
            "gender":             user.get("gender", ""),
            "weight":             user.get("weight"),
            "height":             user.get("height"),
            "fitness_level":      user.get("fitness_level", ""),
            "fitness_goals":      user.get("fitness_goals", []),
            "target_weight":      user.get("target_weight"),
            "preferred_units":    user.get("preferred_units", "metric"),
            "medical_conditions": user.get("medical_conditions", ""),
            "streak":             user.get("streak", 0),
            "points":             user.get("points", 0),
        }
        try:
            all_workouts = list(mongo.db.workouts.find({"user_id": str(user_id)}))
            profile["total_workouts"] = len(all_workouts)
            recent = sorted(all_workouts, key=lambda w: w.get("end_time", ""), reverse=True)[:10]
            profile["recent_workouts_count"] = len(recent)
            if recent:
                total_dur = sum(w.get("duration", 0) for w in recent)
                profile["avg_workout_min"] = round(total_dur / len(recent) / 60, 1)
                activity_types = [w.get("activity_type", "") for w in recent if w.get("activity_type")]
                if activity_types:
                    from collections import Counter
                    profile["favorite_activity"] = Counter(activity_types).most_common(1)[0][0]
        except Exception:
            profile["total_workouts"] = 0
        return profile
    except Exception:
        return {}
 
 
def build_system_prompt(profile):
    name       = profile.get("name", "there")
    first_name = name.split()[0] if name else "there"
    age        = profile.get("age", "unknown")
    gender     = profile.get("gender", "")
    weight     = profile.get("weight")
    height     = profile.get("height")
    level      = profile.get("fitness_level", "")
    goals      = profile.get("fitness_goals", [])
    target_wt  = profile.get("target_weight")
    units      = profile.get("preferred_units", "metric")
    medical    = profile.get("medical_conditions", "")
    streak     = profile.get("streak", 0)
    points     = profile.get("points", 0)
    total_wo   = profile.get("total_workouts", 0)
    recent_wo  = profile.get("recent_workouts_count", 0)
    avg_dur    = profile.get("avg_workout_min")
    fav_act    = profile.get("favorite_activity", "")
 
    wu = "kg" if units == "metric" else "lbs"
    hu = "cm" if units == "metric" else "inches"
    goals_str = ", ".join(goals) if goals else "general fitness"
 
    prompt = (
        "You are FitAI, a friendly personal fitness coach for " + name + ".\n\n"
        "USER PROFILE:\n"
        "Name: " + str(name) + "\n"
        "Age: " + str(age) + " years\n"
        "Gender: " + str(gender) + "\n"
        "Weight: " + str(weight) + " " + wu + "\n"
        "Height: " + str(height) + " " + hu + "\n"
        "Target Weight: " + str(target_wt) + " " + (wu if target_wt else "") + "\n"
        "Fitness Level: " + str(level) + "\n"
        "Goals: " + goals_str + "\n"
        "Streak: " + str(streak) + " days\n"
        "Points: " + str(points) + "\n"
        "Total Workouts: " + str(total_wo) + "\n"
        "Recent Sessions: " + str(recent_wo) + "\n"
    )
    if avg_dur:
        prompt += "Avg Duration: " + str(avg_dur) + " min\n"
    if fav_act:
        prompt += "Favorite Activity: " + fav_act + "\n"
    if medical:
        prompt += "Medical Notes: " + medical + "\n"
 
    prompt += (
        "\nRULES:\n"
        "- You have full access to " + first_name + "'s data. Answer directly from it.\n"
        "- Be warm and encouraging. Use " + first_name + "'s name naturally.\n"
        "- Give specific advice based on their level (" + str(level) + ") and goals (" + goals_str + ").\n"
        "- Use bullet points for lists. Keep answers concise.\n"
        "- You are FitAI, not Llama or any other AI.\n"
        "- Use light emojis occasionally (💪 🔥 ✅).\n"
    )
    return prompt
 
 
@ai_bp.route("/chat", methods=["POST"])
@jwt_required()
def ai_chat():
    api_key = get_api_key()
    if not api_key:
        return jsonify({
            "success": False,
            "message": "⚠️ AI not configured. Please add GROQ_API_KEY to backend/.env and restart the server."
        }), 200
 
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    messages = data.get("messages", [])
 
    if not messages:
        return jsonify({"success": False, "message": "No messages provided"}), 400
 
    from app import mongo
    profile = get_user_profile(mongo, user_id)
    system_prompt = build_system_prompt(profile)
 
    # Build message list with system prompt first
    groq_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        role = msg.get("role", "user")
        text = msg.get("content", "")
        groq_messages.append({
            "role": "assistant" if role == "assistant" else "user",
            "content": text
        })
 
    payload = {
        "model":       GROQ_MODEL,
        "messages":    groq_messages,
        "max_tokens":  1024,
        "temperature": 0.7,
    }
 
    try:
        resp = http_requests.post(
            GROQ_API_URL,
            headers={
                "Content-Type":  "application/json",
                "Authorization": "Bearer " + api_key,
            },
            json=payload,
            timeout=30,
        )
 
        result = resp.json()
 
        if resp.status_code != 200:
            err_msg = result.get("error", {}).get("message", "Groq API error (status {})".format(resp.status_code))
            print("[Groq ERROR] status={} body={}".format(resp.status_code, result))
            return jsonify({"success": False, "message": "AI error: " + err_msg}), 200
 
        ai_text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
 
        if not ai_text.strip():
            return jsonify({"success": False, "message": "Empty response from AI"}), 200
 
        return jsonify({"success": True, "reply": ai_text.strip(), "model": "groq"}), 200
 
    except http_requests.Timeout:
        return jsonify({"success": False, "message": "AI request timed out. Please try again."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": "AI error: " + str(e)}), 200
 
 
@ai_bp.route("/profile", methods=["GET"])
@jwt_required()
def get_profile_summary():
    user_id = get_jwt_identity()
    from app import mongo
    profile = get_user_profile(mongo, user_id)
    return jsonify({"success": True, "profile": profile}), 200