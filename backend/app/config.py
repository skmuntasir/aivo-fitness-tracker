import os

_DEFAULT_SECRET = 'change-me-in-production'


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', _DEFAULT_SECRET)
    MONGO_URI = os.environ.get('MONGO_URI', 'mongodb://localhost:27017/fitness_db')
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', _DEFAULT_SECRET)
    GROQ_API_KEY = os.environ.get('GROQ_API_KEY', '')
    # Comma-separated list of allowed frontend origins for production
    CORS_ORIGIN = os.environ.get('CORS_ORIGIN', '')
    # Optional: lets admins email members from the admin portal
    SMTP_HOST = os.environ.get('SMTP_HOST', '')
    SMTP_PORT = int(os.environ.get('SMTP_PORT', '587') or 587)
    SMTP_USER = os.environ.get('SMTP_USER', '')
    SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
    SMTP_FROM = os.environ.get('SMTP_FROM', '')
    MAX_CONTENT_LENGTH = 4 * 1024 * 1024  # 4MB request cap (images are compressed client-side)
    JSON_SORT_KEYS = False

    @staticmethod
    def validate():
        env = os.environ.get('FLASK_ENV', '').lower()
        if env == 'production' and _DEFAULT_SECRET in (Config.SECRET_KEY, Config.JWT_SECRET_KEY):
            raise RuntimeError('Set SECRET_KEY and JWT_SECRET_KEY before running in production.')
