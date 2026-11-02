import json
from flask import Blueprint, request, jsonify, Response, stream_with_context
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
import requests as http_requests
import os
from app.utils import rate_limit, utcnow
from app.runtime import get_settings
 
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
            profile["total_workouts"] = mongo.db.workouts.count_documents({"user_id": str(user_id)})
            recent = list(mongo.db.workouts.find(
                {"user_id": str(user_id)}, {"duration": 1, "activity_type": 1}
            ).sort("start_time", -1).limit(10))
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
        "- Keep answers concise and well organised.\n"
        "- FORMAT (the app renders Markdown): short intro line, then '## ' headings for sections, "
        "'- ' bullets for lists, '1. ' for ordered steps, **bold** for key terms. Never wrap everything in one paragraph.\n"
        "- For a weekly workout or meal plan use one '## Day' heading per day (for example '## Monday: Upper body') "
        "with a bullet per exercise or meal (for example '- Bench Press: 3 x 12'). Do NOT use tables or '---' lines.\n"
        "- End plans with one short tip line.\n"
        "- You are FitAI, not Llama or any other AI.\n"
        "- Use light emojis occasionally (💪 🔥 ✅).\n"
    )
    return prompt
 
 
@ai_bp.route("/chat", methods=["POST"])
@jwt_required()
@rate_limit("ai_chat", 20, 60)
def ai_chat():
    if not get_settings()['ai_enabled']:
        return jsonify({"success": False, "message": "The AI coach is temporarily unavailable. Please try again later."}), 200
    api_key = get_api_key()
    if not api_key:
        return jsonify({
            "success": False,
            "message": "⚠️ AI not configured. Please add GROQ_API_KEY to backend/.env and restart the server."
        }), 200
 
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    messages = data.get("messages", [])
    if not isinstance(messages, list):
        return jsonify({"success": False, "message": "Invalid messages"}), 400
    messages = messages[-20:]  # cap history sent to the model
 
    if not messages:
        return jsonify({"success": False, "message": "No messages provided"}), 400
 
    from app import mongo
    profile = get_user_profile(mongo, user_id)
    system_prompt = build_system_prompt(profile)
 
    # Build message list with system prompt first
    groq_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        role = msg.get("role", "user")
        text = str(msg.get("content", ""))[:2000]
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
 
        try:   # usage tracking for the admin dashboard
            mongo.db.ai_usage.insert_one({"user_id": str(user_id), "ts": utcnow()})
        except Exception:
            pass
        return jsonify({"success": True, "reply": ai_text.strip(), "model": "groq"}), 200
 
    except http_requests.Timeout:
        return jsonify({"success": False, "message": "AI request timed out. Please try again."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": "AI error: " + str(e)}), 200
 
 
def _sse(obj):
    return "data: " + json.dumps(obj, ensure_ascii=False) + "\n\n"


@ai_bp.route("/chat/stream", methods=["POST"])
@jwt_required()
@rate_limit("ai_chat", 20, 60)
def ai_chat_stream():
    """Same conversation as /chat, but the reply is sent token-by-token (Server-Sent Events) so the
    app can show it as it is being written. Problems found *before* streaming starts (AI off, no key,
    bad input) come back as ordinary JSON so the client can show them or fall back to /chat."""
    if not get_settings()['ai_enabled']:
        return jsonify({"success": False, "message": "The AI coach is temporarily unavailable. Please try again later."}), 200
    api_key = get_api_key()
    if not api_key:
        return jsonify({"success": False,
                        "message": "⚠️ AI not configured. Please add GROQ_API_KEY to backend/.env and restart the server."}), 200

    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}
    messages = data.get("messages", [])
    if not isinstance(messages, list) or not messages:
        return jsonify({"success": False, "message": "No messages provided"}), 400
    messages = messages[-20:]

    from app import mongo
    system_prompt = build_system_prompt(get_user_profile(mongo, user_id))
    groq_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        role = msg.get("role", "user")
        groq_messages.append({"role": "assistant" if role == "assistant" else "user",
                              "content": str(msg.get("content", ""))[:2000]})

    payload = {"model": GROQ_MODEL, "messages": groq_messages, "max_tokens": 1024,
               "temperature": 0.7, "stream": True}

    def generate():
        got_text = False
        yield ": stream-open\n\n"   # flush the headers right away so proxies start relaying
        try:
            with http_requests.post(
                GROQ_API_URL,
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + api_key},
                json=payload, timeout=(10, 60), stream=True,
            ) as resp:
                if resp.status_code != 200:
                    try:
                        err = resp.json().get("error", {}).get("message", "")
                    except Exception:
                        err = ""
                    print("[Groq STREAM ERROR] status={} {}".format(resp.status_code, err))
                    yield _sse({"error": "AI error: " + (err or "Groq API error (status {})".format(resp.status_code))})
                    return
                resp.encoding = "utf-8"   # SSE is UTF-8; without this iter_lines would yield bytes
                for line in resp.iter_lines(decode_unicode=True):
                    if not line or not line.startswith("data:"):
                        continue
                    chunk = line[5:].strip()
                    if chunk == "[DONE]":
                        break
                    try:
                        delta = (json.loads(chunk).get("choices") or [{}])[0].get("delta") or {}
                    except ValueError:
                        continue
                    piece = delta.get("content")
                    if piece:
                        got_text = True
                        yield _sse({"t": piece})
        except http_requests.Timeout:
            yield _sse({"error": "AI request timed out. Please try again."})
            return
        except GeneratorExit:      # the browser stopped / navigated away
            return
        except Exception as e:
            yield _sse({"error": "AI error: " + str(e)})
            return
        if not got_text:
            yield _sse({"error": "Empty response from AI"})
            return
        try:   # usage tracking for the admin dashboard
            mongo.db.ai_usage.insert_one({"user_id": str(user_id), "ts": utcnow()})
        except Exception:
            pass
        yield _sse({"done": True})

    return Response(stream_with_context(generate()), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})


@ai_bp.route("/profile", methods=["GET"])
@jwt_required()
def get_profile_summary():
    user_id = get_jwt_identity()
    from app import mongo
    profile = get_user_profile(mongo, user_id)
    return jsonify({"success": True, "profile": profile}), 200