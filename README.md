# Fitness Tracker

A full-stack fitness management app with AI coaching, real-time social features, and workout analytics.

## Features

- 🔐 User authentication with JWT
- 🏋️ Workout logging — create and track exercises with sets, reps, and weight
- 🔥 Streak calendar — daily activity heatmap to maintain momentum
- 🤖 AI Chat (GROQ) — personalized coaching that knows your profile, goals, and history
- 🍎 Calorie calculator — estimate intake based on height, weight, age, and goals
- 📊 Progress analytics — charts of strength gains and workout frequency
- 👥 Social — follow friends, activity feed, and real-time chat via Socket.IO
- 🏆 Leaderboard — compete on streaks and workout volume
- 🐳 Docker support — spin up the full stack with one command

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, React Router, Recharts, Socket.IO Client |
| Backend | Python, Flask, Flask-SocketIO, Flask-JWT-Extended |
| Database | MongoDB Atlas |
| AI | GROQ API (free) |
| DevOps | Docker Compose |

## Project Structure

```
fitness-tracker/
├── frontend/          # React + Vite app
├── backend/           # Flask API + Socket.IO server
│   └── app/
│       ├── auth/      # Registration, login, JWT
│       ├── ai/        # Gemini AI chat
│       ├── analytics/ # Progress dashboard
│       ├── calorie/   # Calorie calculations
│       └── social/    # Friends, feed, chat
└── docker-compose.yml
```

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.10+
- MongoDB Atlas account (free tier works)
- Google Gemini API key (free — see below)

### Option A — Docker (easiest)

```bash
# Copy and fill in your env file first
cp backend/.env.example backend/.env
# Edit backend/.env with your credentials

docker compose up
# Frontend → http://localhost:3000
# Backend  → http://localhost:5000
```

### Option B — Manual

**Backend:**
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env — add your MONGO_URI and GEMINI_API_KEY
python app.py
# Runs on http://localhost:5000
```

**Frontend:**
```bash
cd frontend
npm install
cp .env.example .env
# .env already points to localhost:5000 for local dev
npm run dev
# Runs on http://localhost:3000
```

### Getting a free Gemini API key (2 min)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with any Google account → **Create API Key**
3. Paste the key into `backend/.env` as `GEMINI_API_KEY=...`

## Deployment

### Backend → Render (free)
1. Create a **Web Service** on [render.com](https://render.com)
2. Connect repo, set root directory to `backend/`
3. Build command: `pip install -r requirements.txt`
4. Start command: `python app.py`
5. Add all env vars from `.env.example` in Render's dashboard
6. Set `CORS_ORIGIN=https://your-app.vercel.app`

### Frontend → Vercel (free)
1. Import repo on [vercel.com](https://vercel.com), set root to `frontend/`
2. Add `VITE_BACKEND_URL=https://your-backend.onrender.com`

## Screenshots

> Add screenshots here after deploying.

## License

MIT
