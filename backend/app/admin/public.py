"""Small non-admin endpoints that the admin portal feeds (announcements, status, post reports)."""
from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..extensions import mongo
from ..runtime import get_settings
from ..utils import rate_limit, utcnow

public_bp = Blueprint('public_admin_feed', __name__)

REPORT_REASONS = ('spam', 'harassment', 'inappropriate', 'misinformation', 'other')


@public_bp.route('/api/app/status', methods=['GET'])
def app_status():
    s = get_settings()
    return jsonify(success=True, registration_enabled=s['registration_enabled'], ai_enabled=s['ai_enabled'],
                   maintenance_mode=s['maintenance_mode'],
                   maintenance_message=s['maintenance_message'] if s['maintenance_mode'] else '')


@public_bp.route('/api/announcements/active', methods=['GET'])
@jwt_required()
def active_announcements():
    now = utcnow()
    rows = mongo.db.announcements.find({
        'active': True,
        '$and': [{'$or': [{'starts_at': None}, {'starts_at': {'$lte': now}}]},
                 {'$or': [{'ends_at': None}, {'ends_at': {'$gte': now}}]}]}).sort('created_at', -1).limit(3)
    return jsonify(success=True, announcements=[
        {'id': str(a['_id']), 'title': a['title'], 'body': a.get('body', ''), 'type': a.get('type', 'info')}
        for a in rows])


@public_bp.route('/api/posts/<post_id>/report', methods=['POST'])
@jwt_required()
@rate_limit('post_report', 10, 600)
def report_post(post_id):
    try:
        pid, me = ObjectId(post_id), ObjectId(get_jwt_identity())
    except Exception:
        return jsonify(success=False, message='Invalid post'), 400
    data = request.get_json() or {}
    reason = data.get('reason')
    if reason not in REPORT_REASONS:
        return jsonify(success=False, message='Choose a reason for the report'), 400
    post = mongo.db.posts.find_one({'_id': pid}, {'author': 1, 'content': 1})
    if not post:
        return jsonify(success=False, message='Post not found'), 404
    if post['author'] == me:
        return jsonify(success=False, message="You can't report your own post"), 400
    if mongo.db.reports.find_one({'post_id': pid, 'reporter_id': me, 'status': 'open'}):
        return jsonify(success=False, message='You already reported this post'), 409
    mongo.db.reports.insert_one({
        'post_id': pid, 'post_author': post['author'], 'reporter_id': me, 'reason': reason,
        'details': str(data.get('details', '')).strip()[:300], 'post_snippet': (post.get('content') or '')[:240],
        'status': 'open', 'created_at': utcnow()})
    return jsonify(success=True, message='Thanks — our team will review this post.')
