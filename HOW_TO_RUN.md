# Aivo — How to Run

**Prerequisites:** Node.js 18+, Python 3.10+, a MongoDB (Atlas free tier or local).

## Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # then fill in MONGO_URI, SECRET_KEY, JWT_SECRET_KEY, GROQ_API_KEY
python app.py               # http://localhost:5000  (health check: /api/health)
```
`simple-websocket` is in requirements so Socket.IO uses real WebSockets (not slow long-polling).
Database indexes are created automatically on startup.

## Frontend
```bash
cd frontend
npm install
cp .env.example .env        # VITE_BACKEND_URL=http://localhost:5000
npm run dev                 # http://localhost:3000
```

## Docker
```bash
cp backend/.env.example backend/.env   # fill in secrets
docker compose up --build
```

## AI coach
Uses **Groq** (`GROQ_API_KEY`). Get a free key at https://console.groq.com/keys.

## Deploying
Set `FLASK_ENV=production`, real `SECRET_KEY`/`JWT_SECRET_KEY`, and `CORS_ORIGIN=<your frontend URL>`.
Never commit `backend/.env` (it is git-ignored).

## Troubleshooting
- **AI says "not configured"** → set `GROQ_API_KEY` in `backend/.env`, restart.
- **Times look wrong on old data** → handled automatically (client treats legacy timestamps as UTC).
- **Chat shows "Offline" for everyone** → check the browser console: the socket must connect to `VITE_BACKEND_URL`.

## Admin console
See `ADMIN_GUIDE.md`. Open `/admin/login`; the first registered user is an admin, or run `python backend/create_admin.py you@example.com`.
