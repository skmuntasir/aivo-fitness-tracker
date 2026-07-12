import os

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'change-me-in-production')
    MONGO_URI = os.environ.get(
        'MONGO_URI',
        'mongodb://localhost:27017/fitness_db'  # safe local fallback
    )
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'change-me-in-production')
    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
    GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
    ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY', '')
    # Comma-separated list of allowed frontend origins for production
    # Example: https://your-app.vercel.app
    CORS_ORIGIN = os.environ.get('CORS_ORIGIN', '')
    MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10MB
