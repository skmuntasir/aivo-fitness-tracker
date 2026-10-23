"""Admin auth decorator, audit logging and small helpers shared by all admin routes."""
import csv
import io
import re
from datetime import datetime, timezone
from functools import wraps

from bson import ObjectId
from flask import Response, g, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request

from ..extensions import mongo
from ..utils import iso_utc, utcnow


# ── serialisation ───────────────────────────────────────────────────────────
def ser(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return iso_utc(value)
    if isinstance(value, dict):
        return {k: ser(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [ser(v) for v in value]
    return value


def oid(value):
    try:
        return ObjectId(str(value))
    except Exception:
        return None


def rx(text):
    """Case-insensitive, regex-escaped contains-match (user input is never used as a raw regex)."""
    return {'$regex': re.escape(str(text).strip()[:80]), '$options': 'i'}


def parse_day(value, end=False):
    """'YYYY-MM-DD' -> naive UTC datetime (start of day, or start of the NEXT day when end=True)."""
    try:
        d = datetime.strptime(str(value)[:10], '%Y-%m-%d')
    except Exception:
        return None
    from datetime import timedelta
    return d + timedelta(days=1) if end else d


def err(message, status=400, **extra):
    return jsonify(success=False, message=message, **extra), status


# ── auth ────────────────────────────────────────────────────────────────────
def _make_guard(staff):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                verify_jwt_in_request()
            except Exception:
                return err('Authentication required', 401)
            user_id = oid(get_jwt_identity())
            user = mongo.db.users.find_one({'_id': user_id}, {'password': 0, 'profile_picture': 0}) if user_id else None
            if not user:
                return err('Account not found', 401)
            if int(get_jwt().get('tv', 0) or 0) != int(user.get('token_version', 0) or 0):
                return err('Session ended. Please sign in again.', 401)
            if user.get('is_active', True) is False:
                return err('Account suspended', 403)
            role = role_of(user)
            if role == 'user' or (not staff and role != 'admin'):
                return err('Admin access required' if not staff else 'Staff access required', 403)
            g.admin, g.role = user, role
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def role_of(user):
    return 'admin' if user.get('is_admin') else 'moderator' if user.get('is_moderator') else 'user'


admin_required = _make_guard(staff=False)   # DB re-checked on every call: demoted/suspended admins lose access at once
staff_required = _make_guard(staff=True)    # admins + moderators (moderation / read-only areas)


def admin_public(user):
    return {'id': str(user['_id']), 'email': user.get('email', ''), 'full_name': user.get('full_name', ''),
            'username': user.get('username', ''), 'role': role_of(user)}


# ── audit ───────────────────────────────────────────────────────────────────
def audit(action, target_type=None, target_id=None, details=None):
    """Record an admin action. Never raises: auditing must not break the action itself."""
    try:
        admin = g.get('admin') or {}
        mongo.db.audit_logs.insert_one({
            'actor_id': str(admin.get('_id', '')), 'actor_email': admin.get('email', ''),
            'actor_name': admin.get('full_name', ''), 'action': action,
            'target_type': target_type, 'target_id': str(target_id) if target_id is not None else None,
            'details': details or {},
            'ip': (request.headers.get('X-Forwarded-For') or request.remote_addr or '').split(',')[0].strip(),
            'ts': utcnow()})
    except Exception as exc:  # pragma: no cover
        print(f'[audit] failed: {exc}')


# ── pagination / export ─────────────────────────────────────────────────────
def page_args(default_limit=20, max_limit=100):
    try:
        page = max(1, int(request.args.get('page', 1)))
    except ValueError:
        page = 1
    try:
        limit = max(1, min(int(request.args.get('limit', default_limit)), max_limit))
    except ValueError:
        limit = default_limit
    return page, limit


def page_meta(total, page, limit):
    return {'total': total, 'page': page, 'limit': limit, 'pages': max(1, -(-total // limit))}


def _csv_safe(v):
    s = '' if v is None else str(v)
    return "'" + s if s[:1] in ('=', '+', '-', '@', '\t', '\r') else s   # spreadsheet formula injection


def csv_response(filename, header, rows):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow([_csv_safe(c) for c in r])
    return Response('\ufeff' + buf.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': f'attachment; filename={filename}'})
