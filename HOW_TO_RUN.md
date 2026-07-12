# Fitness App — How to Run

## Prerequisites
- Node.js 18+
- Python 3.10+

---

## ⚡ Quick Start

### Step 1 — Backend
```bash
cd backend
pip install -r requirements.txt

# Edit the .env file (already created for you):
# Open backend/.env and replace YOUR_GEMINI_KEY_HERE with your real key
# (See "Getting your FREE Gemini API key" below)

python app.py
# Backend runs on http://localhost:5000
```

### Step 2 — Frontend
```bash
cd frontend
npm install
npm start
# Frontend runs on http://localhost:3000
```

---

## 🤖 Getting your FREE Gemini API Key (2 minutes)

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with any Google account
3. Click **"Create API Key"** → Copy the key
4. Open **`backend/.env`** and replace `YOUR_GEMINI_KEY_HERE` with your key:

```
GEMINI_API_KEY=AIzaSy...your-actual-key-here...
```

5. Save the file and run `python app.py`

That's it! The AI will now know your name, age, weight, goals, streak, and everything from your profile.

---

## What the AI can do

The FitAI chatbot has full access to your database profile and can answer:
- "What is my name?" → Tells you your real name from the DB
- "What are my goals?" → Lists your actual fitness goals
- "How is my streak?" → Shows your current streak
- "Create a workout plan for me" → Personalized plan for your level & goals
- "How many calories should I eat?" → Calculated from your weight, age, height & goals
- "What should I focus on this week?" → Advice based on your recent workouts
- Any general fitness, nutrition, or health question

---

## Troubleshooting

**"GEMINI_API_KEY not set"** → Make sure `backend/.env` has your key and you ran `python app.py` (not `flask run`)

**Backend not starting** → Run `pip install -r requirements.txt` first

**AI gives wrong info** → Make sure your Profile page has your age, weight, height, and goals filled in
