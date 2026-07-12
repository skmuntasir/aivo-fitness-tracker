from flask import Flask
from .extensions import mongo, jwt
from flask_cors import CORS

def create_app():
    app = Flask(__name__)
    app.config.from_object("app.config.Config")

    # Build allowed origins list: always include localhost for local dev
    local_origins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5174",
    ]
    cors_env = app.config.get("CORS_ORIGIN", "")
    extra_origins = [o.strip() for o in cors_env.split(",") if o.strip()]
    allowed_origins = local_origins + extra_origins

    CORS(app, resources={r"/*": {"origins": allowed_origins}}, supports_credentials=True)

    mongo.init_app(app)
    jwt.init_app(app)
    from .extensions import socketio
    socketio.init_app(app, cors_allowed_origins=allowed_origins)

    # Register auth blueprint
    from .auth.routes import auth_bp
    app.register_blueprint(auth_bp)

    # Register calorie blueprint
    from .calorie.routes import calorie_bp
    app.register_blueprint(calorie_bp)

    # Register workouts blueprint
    from .routes import workouts_bp
    app.register_blueprint(workouts_bp)

    # Register users blueprint
    from .routes import users_bp
    app.register_blueprint(users_bp)

    # Register social blueprint
    from .social.routes import social_bp
    app.register_blueprint(social_bp)

    # Register analytics blueprint (AI Progress Dashboard)
    from .analytics.routes import analytics_bp
    app.register_blueprint(analytics_bp)

    # Register AI chat blueprint
    from .ai.routes import ai_bp
    app.register_blueprint(ai_bp)

    return app
