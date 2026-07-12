import os

# Load .env file FIRST before any other imports read env vars
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    load_dotenv(env_path)
    print(f"[.env] Loaded from {env_path}")
    if os.environ.get("GROQ_API_KEY"):
        print("[.env] GROQ_API_KEY found ✓")
    else:
        print("[.env] WARNING: GROQ_API_KEY not set — AI chat will not work")
except ImportError:
    print("[.env] python-dotenv not installed.")

from app import create_app
from app.extensions import socketio

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV") == "development"
    socketio.run(
        app,
        host="0.0.0.0",
        port=port,
        debug=debug,
        allow_unsafe_werkzeug=True
    )