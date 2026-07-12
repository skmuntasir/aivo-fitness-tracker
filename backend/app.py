import os
# Load .env file FIRST before any other imports read env vars
try:
    from dotenv import load_dotenv
    # Look for .env in the backend directory
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    load_dotenv(env_path)
    print(f"[.env] Loaded from {env_path}")
    if os.environ.get("GEMINI_API_KEY"):
        print("[.env] GEMINI_API_KEY found ✓")
    else:
        print("[.env] WARNING: GEMINI_API_KEY not set — AI chat will not work")
except ImportError:
    print("[.env] python-dotenv not installed. Install with: pip install python-dotenv")

from app import create_app
from app.extensions import socketio

app = create_app()

if __name__ == "__main__":
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)
