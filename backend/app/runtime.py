"""Platform runtime state shared by the whole app.

Deliberately imports nothing from `app.admin` / `app.auth` so any module can use it without
circular imports. Contains:
  * platform settings (registration / AI coach / maintenance) with a short in-memory cache
  * a per-user status cache (is_active, token_version, is_admin) used to
      - block suspended users on EVERY api call (before: only at login, tokens lived 7 days)
      - support admin "force logout" (token_version claim `tv`)
  * the global `before_request` guard that enforces the above
"""
import threading
import time
from bson import ObjectId
from flask import request, jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt, get_jwt_identity

from .extensions import mongo

DEFAULT_SETTINGS = {
    'registration_enabled': True,
    'ai_enabled': True,
    'maintenance_mode': False,
    'maintenance_message': 'Aivo is undergoing scheduled maintenance. Please check back shortly.',
    'banned_words': [],   # posts containing these are auto-hidden + reported; comments are rejected
}

_SETTINGS_TTL = 10
_STATUS_TTL = 15
_lock = threading.Lock()
_settings = {'t': 0.0, 'v': None}
_status = {}   # uid -> (timestamp, info|None)


# ── settings ────────────────────────────────────────────────────────────────
def get_settings(force=False):
    now = time.time()
    with _lock:
        if not force and _settings['v'] is not None and now - _settings['t'] < _SETTINGS_TTL:
            return dict(_settings['v'])
    merged = dict(DEFAULT_SETTINGS)
    try:
        doc = mongo.db.settings.find_one({'_id': 'global'}) or {}
        merged.update({k: doc[k] for k in DEFAULT_SETTINGS if k in doc})
    except Exception:
        pass   # DB hiccup: fall back to defaults rather than taking the site down
    with _lock:
        _settings['v'], _settings['t'] = merged, now
    return dict(merged)


def save_settings(patch):
    mongo.db.settings.update_one({'_id': 'global'}, {'$set': patch}, upsert=True)
    with _lock:
        _settings['v'] = None
    return get_settings(force=True)


def find_banned_word(text):
    """First banned word found in `text` (whole-word, case-insensitive) or None."""
    import re
    words = get_settings().get('banned_words') or []
    if not text or not words:
        return None
    for w in words:
        if w and re.search(r'(?<!\w)' + re.escape(w) + r'(?!\w)', str(text), re.IGNORECASE):
            return w
    return None


# ── per-user status ─────────────────────────────────────────────────────────
def user_status(uid):
    """{'is_active', 'tv', 'is_admin'} or None when the user no longer exists."""
    if not uid:
        return None
    uid = str(uid)
    now = time.time()
    with _lock:
        hit = _status.get(uid)
        if hit and now - hit[0] < _STATUS_TTL:
            return hit[1]
    try:
        doc = mongo.db.users.find_one({'_id': ObjectId(uid)},
                                      {'is_active': 1, 'token_version': 1, 'is_admin': 1})
    except Exception:
        return {'is_active': True, 'tv': None, 'is_admin': False}   # invalid id / DB down: let routes decide
    info = None if not doc else {
        'is_active': doc.get('is_active', True) is not False,
        'tv': int(doc.get('token_version', 0) or 0),
        'is_admin': bool(doc.get('is_admin')),
    }
    with _lock:
        _status[uid] = (now, info)
    return info


def invalidate_user(uid=None):
    with _lock:
        if uid is None:
            _status.clear()
        else:
            _status.pop(str(uid), None)


# ── global guard ────────────────────────────────────────────────────────────
_ALWAYS_OPEN = {'/api/health', '/api/app/status'}
_OPEN_AUTH = {'/api/auth/login', '/api/auth/register'}


def _maintenance(settings):
    return jsonify(success=False, code='maintenance', message=settings['maintenance_message']), 503


def enforce_request_guard():
    path = request.path
    if (request.method == 'OPTIONS' or not path.startswith('/api/')
            or path in _ALWAYS_OPEN or path.startswith('/api/admin')):
        return None   # admin routes do their own (stricter, uncached) checks in `admin_required`

    uid, claims = None, {}
    if request.headers.get('Authorization'):
        try:   # a stale/invalid token must not break public routes such as login
            verify_jwt_in_request(optional=True)
            uid, claims = get_jwt_identity(), (get_jwt() or {})
        except Exception:
            uid, claims = None, {}

    settings = get_settings()
    if path in _OPEN_AUTH:
        return _maintenance(settings) if settings['maintenance_mode'] else None

    st = user_status(uid) if uid else None
    if uid:
        if st is None:
            return jsonify(success=False, message='Account not found. Please sign in again.'), 401
        if st['tv'] is not None and int(claims.get('tv', 0) or 0) != st['tv']:
            return jsonify(success=False, message='Your session has ended. Please sign in again.'), 401
        if not st['is_active']:
            return jsonify(success=False, code='suspended',
                           message='Your account has been suspended. Contact support.'), 403

    if settings['maintenance_mode'] and not (st and st['is_admin']):
        return _maintenance(settings)
    return None
