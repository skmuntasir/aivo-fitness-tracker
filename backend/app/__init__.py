import gzip

from flask import Flask, request
from flask_cors import CORS
from .extensions import mongo, jwt, socketio
from .config import Config


def ensure_indexes():
    """Indexes were missing entirely: every query was a full collection scan."""
    db = mongo.db
    specs = [
        (db.users, 'email', {'unique': True}),
        (db.users, 'username', {}),
        (db.users, [('points', -1)], {}),
        (db.workouts, [('user_id', 1), ('start_time', -1)], {}),
        (db.messages, [('sender', 1), ('receiver', 1), ('timestamp', -1)], {}),
        (db.messages, [('receiver', 1), ('read', 1)], {}),
        (db.posts, [('author', 1), ('createdAt', -1)], {}),
        (db.friend_requests, [('receiver', 1), ('status', 1)], {}),
        (db.friend_requests, [('sender', 1), ('status', 1)], {}),
        # admin portal
        (db.users, [('created_at', -1)], {}),
        (db.users, [('last_active', -1)], {}),
        (db.workouts, [('start_time', -1)], {}),
        (db.posts, [('createdAt', -1)], {}),
        (db.reports, [('status', 1), ('created_at', -1)], {}),
        (db.reports, [('post_id', 1), ('status', 1)], {}),
        (db.audit_logs, [('ts', -1)], {}),
        (db.ai_usage, [('ts', -1)], {}),
        # engagement features
        (db.streak_freezes, [('user_id', 1), ('date', 1)], {'unique': True}),
        (db.challenges, [('challenger', 1), ('status', 1)], {}),
        (db.challenges, [('opponent', 1), ('status', 1)], {}),
        (db.saved_plans, [('user_id', 1), ('created_at', -1)], {}),
    ]
    for coll, keys, opts in specs:  # one failure (e.g. duplicate emails) must not skip the rest
        try:
            coll.create_index(keys, **opts)
        except Exception as exc:
            print(f"[indexes] skipped {coll.name} {keys}: {str(exc)[:100]}")
            if 'ServerSelection' in type(exc).__name__ or 'AutoReconnect' in type(exc).__name__:
                break  # database unreachable: don't wait for a timeout on every index


_COMPRESSIBLE = ('application/json', 'text/')


def _gzip(resp):
    """Gzip JSON/text API responses > 1 KB (typically 5-10x smaller => much faster on mobile).
    Images, streams, socket.io traffic and already-encoded responses are left alone."""
    try:
        if (resp.status_code != 200 or resp.direct_passthrough or resp.is_streamed or 'Content-Encoding' in resp.headers
                or request.path.startswith('/socket.io')
                or 'gzip' not in request.headers.get('Accept-Encoding', '').lower()
                or not (resp.mimetype or '').startswith(_COMPRESSIBLE)):
            return
        data = resp.get_data()
        if len(data) < 1024:
            return
        resp.set_data(gzip.compress(data, compresslevel=5))
        resp.headers['Content-Encoding'] = 'gzip'
        resp.headers['Content-Length'] = str(len(resp.get_data()))
        resp.headers.add('Vary', 'Accept-Encoding')
    except Exception:
        pass  # never break a response because of compression


def create_app():
    Config.validate()
    app = Flask(__name__)
    app.config.from_object(Config)
    app.json.sort_keys = False   # skip sorting every JSON response (faster, same data)

    local_origins = ["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"]
    extra = [o.strip() for o in app.config.get("CORS_ORIGIN", "").split(",") if o.strip()]
    allowed_origins = local_origins + extra

    CORS(app, resources={r"/*": {"origins": allowed_origins}}, supports_credentials=True)

    mongo.init_app(app)
    jwt.init_app(app)
    socketio.init_app(app, cors_allowed_origins=allowed_origins)

    from .auth.routes import auth_bp
    from .calorie.routes import calorie_bp
    from .routes import workouts_bp, users_bp
    from .social.routes import social_bp
    from .analytics.routes import analytics_bp
    from .ai.routes import ai_bp
    from .engage import engage_bp
    from .admin import admin_bp, public_bp
    for bp in (auth_bp, calorie_bp, workouts_bp, users_bp, social_bp, analytics_bp, ai_bp, engage_bp, admin_bp, public_bp):
        app.register_blueprint(bp)

    # 1) pick the real or the demo sandbox data scope, 2) block suspended users / ended sessions / maintenance mode
    from .demo import detect_scope, seed_demo_if_missing, start_janitor
    from .runtime import enforce_request_guard
    app.before_request(detect_scope)
    app.before_request(enforce_request_guard)

    from .social import socket as _socket_handlers  # noqa: F401  (registers socket events)

    with app.app_context():
        ensure_indexes()
        seed_demo_if_missing()
    start_janitor()   # frees abandoned demo sandboxes in quiet periods (the 30-minute reset itself needs no background work)

    @app.after_request
    def _headers(resp):
        resp.headers.setdefault('X-Content-Type-Options', 'nosniff')
        _gzip(resp)
        return resp

    @app.route('/api/demo/accounts')
    def demo_accounts():
        from .demo import demo_public_accounts
        return {'success': True, 'accounts': demo_public_accounts()}

    @app.route('/api/health')
    def health():
        return {'ok': True}

    return app
