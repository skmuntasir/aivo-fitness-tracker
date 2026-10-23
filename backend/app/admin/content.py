"""Admin: workouts, community moderation (posts/comments/reports) and leaderboard."""
from datetime import timedelta

from flask import g, jsonify, request

from . import admin_bp
from .guards import (admin_required, staff_required, audit, csv_response, err, oid, page_args, page_meta, parse_day, rx, ser)
from .users import suspend_user
from ..extensions import mongo
from ..utils import effective_streak, iso_utc, streaks_for_users, utcnow, valid_tz

LONG_SECONDS, SHORT_SECONDS = 4 * 3600, 60


# ═════════════════════════════ workouts ═════════════════════════════
def _flag(duration):
    if duration > LONG_SECONDS:
        return 'Unusually long (over 4h)'
    if duration < SHORT_SECONDS:
        return 'Very short (under 1 min)'
    return None


def _workout_query():
    a, q = request.args, {}
    if a.get('user_id'):
        q['user_id'] = a['user_id']
    elif a.get('q'):
        r = rx(a['q'])
        ids = [str(u['_id']) for u in mongo.db.users.find({'$or': [{'full_name': r}, {'email': r}]}, {'_id': 1}).limit(50)]
        q['user_id'] = {'$in': ids}
    if a.get('activity'):
        q['activity_type'] = a['activity']
    start, end = parse_day(a.get('from')), parse_day(a.get('to'), end=True)
    if start or end:
        q['start_time'] = {k: v for k, v in (('$gte', start), ('$lt', end)) if v}
    if a.get('flagged') == '1':
        q['$or'] = [{'duration': {'$gt': LONG_SECONDS}}, {'duration': {'$lt': SHORT_SECONDS}}]
    return q


def _workout_rows(docs):
    ids = list({d.get('user_id') for d in docs if d.get('user_id')})
    users = {str(u['_id']): u for u in mongo.db.users.find(
        {'_id': {'$in': [o for o in map(oid, ids) if o]}}, {'full_name': 1, 'email': 1})}
    out = []
    for w in docs:
        u, dur = users.get(w.get('user_id'), {}), int(w.get('duration') or 0)
        out.append({'id': w['_id'], 'user_id': w.get('user_id'), 'user_name': u.get('full_name', '(deleted user)'),
                    'user_email': u.get('email', ''), 'activity_type': w.get('activity_type') or 'Unspecified',
                    'start_time': iso_utc(w.get('start_time')), 'end_time': iso_utc(w.get('end_time')),
                    'duration': dur, 'flag': _flag(dur)})
    return out


@admin_bp.route('/workouts', methods=['GET'])
@staff_required
def workouts_list():
    q, (page, limit) = _workout_query(), page_args(20, 100)
    total = mongo.db.workouts.count_documents(q)
    docs = list(mongo.db.workouts.find(q).sort('start_time', -1).skip((page - 1) * limit).limit(limit))
    return jsonify(success=True, workouts=_workout_rows(docs), **page_meta(total, page, limit))


@admin_bp.route('/workouts/stats', methods=['GET'])
@staff_required
def workouts_stats():
    w = mongo.db.workouts
    by_type = [{'activity': r['_id'] or 'Unspecified', 'count': r['n'], 'minutes': int(r['secs'] / 60),
                'avg_minutes': round(r['secs'] / r['n'] / 60, 1)} for r in w.aggregate([
        {'$group': {'_id': '$activity_type', 'n': {'$sum': 1}, 'secs': {'$sum': '$duration'}}},
        {'$sort': {'n': -1}}])]
    tot = list(w.aggregate([{'$group': {'_id': None, 'n': {'$sum': 1}, 'secs': {'$sum': '$duration'}}}]))
    n, secs = (tot[0]['n'], tot[0]['secs']) if tot else (0, 0)
    return jsonify(success=True, total=n, hours=round(secs / 3600, 1), avg_minutes=round(secs / n / 60, 1) if n else 0,
                   flagged=w.count_documents({'$or': [{'duration': {'$gt': LONG_SECONDS}},
                                                       {'duration': {'$lt': SHORT_SECONDS}}]}),
                   by_activity=by_type, activities=[r['activity'] for r in by_type])


@admin_bp.route('/workouts/export', methods=['GET'])
@admin_required
def workouts_export():
    docs = list(mongo.db.workouts.find(_workout_query()).sort('start_time', -1).limit(20000))
    rows = _workout_rows(docs)
    audit('workout.export', 'workout', None, {'rows': len(rows)})
    return csv_response('aivo_workouts.csv', ['ID', 'User', 'Email', 'Activity', 'Start (UTC)', 'End (UTC)',
                                              'Duration (s)', 'Flag'],
                        [[r['id'], r['user_name'], r['user_email'], r['activity_type'], r['start_time'],
                          r['end_time'], r['duration'], r['flag'] or ''] for r in rows])


@admin_bp.route('/workouts/<workout_id>', methods=['DELETE'])
@admin_required
def workout_delete(workout_id):
    w = mongo.db.workouts.find_one({'_id': workout_id})
    if not w:
        return err('Workout not found', 404)
    deduct = (request.get_json(silent=True) or {}).get('deduct_points', True)
    mongo.db.workouts.delete_one({'_id': workout_id})
    removed = 0
    user_id = oid(w.get('user_id'))
    user = mongo.db.users.find_one({'_id': user_id}) if user_id else None
    if user:
        if deduct:   # base rate only (the streak multiplier at log time isn't stored)
            removed = min(int(user.get('points', 0) or 0), int((w.get('duration') or 0) // 5))
            mongo.db.users.update_one({'_id': user_id}, {'$inc': {'points': -removed}})
        effective_streak(user, valid_tz(user.get('tz')), persist=True)   # self-repairs the cached streak
    audit('workout.delete', 'workout', workout_id, {'user_id': w.get('user_id'), 'duration': w.get('duration'),
                                                    'points_removed': removed})
    return jsonify(success=True, points_removed=removed)


# ═════════════════════════════ posts / moderation ═════════════════════════════
def _post_rows(posts):
    from ..social.routes import _image_sig
    authors = {a['_id']: a for a in mongo.db.users.find(
        {'_id': {'$in': list({p['author'] for p in posts})}}, {'full_name': 1, 'username': 1, 'email': 1})}
    open_reports = {r['_id']: r['n'] for r in mongo.db.reports.aggregate([
        {'$match': {'status': 'open', 'post_id': {'$in': [p['_id'] for p in posts]}}},
        {'$group': {'_id': '$post_id', 'n': {'$sum': 1}}}])} if posts else {}
    out = []
    for p in posts:
        a, pid = authors.get(p['author'], {}), str(p['_id'])
        out.append({'id': pid, 'author': {'id': str(p['author']), 'full_name': a.get('full_name', '(deleted user)'),
                                          'email': a.get('email', '')},
                    'content': p.get('content', ''), 'has_image': bool(p.get('has_image')),
                    'imageUrl': f"/api/posts/{pid}/image?sig={_image_sig(pid)}" if p.get('has_image') else None,
                    'likes': len(p.get('likes') or []), 'comments_count': len(p.get('comments') or []),
                    'hidden': bool(p.get('hidden')), 'hidden_reason': p.get('hidden_reason', ''),
                    'open_reports': open_reports.get(p['_id'], 0), 'created_at': iso_utc(p.get('createdAt'))})
    return out


@admin_bp.route('/posts', methods=['GET'])
@staff_required
def posts_list():
    a, q = request.args, {}
    if a.get('q'):
        q['content'] = rx(a['q'])
    if a.get('author') and oid(a['author']):
        q['author'] = oid(a['author'])
    if a.get('hidden') == '1':
        q['hidden'] = True
    elif a.get('hidden') == '0':
        q['hidden'] = {'$ne': True}
    if a.get('reported') == '1':
        q['_id'] = {'$in': mongo.db.reports.distinct('post_id', {'status': 'open'})}
    page, limit = page_args(15, 50)
    total = mongo.db.posts.count_documents(q)
    posts = list(mongo.db.posts.aggregate([
        {'$match': q}, {'$sort': {'createdAt': -1}}, {'$skip': (page - 1) * limit}, {'$limit': limit},
        {'$addFields': {'has_image': {'$cond': [{'$ifNull': ['$image', False]}, True, False]}}},
        {'$project': {'image': 0}}]))
    return jsonify(success=True, posts=_post_rows(posts), **page_meta(total, page, limit))


@admin_bp.route('/posts/export', methods=['GET'])
@staff_required
def posts_export():
    q = {}
    if request.args.get('q'):
        q['content'] = rx(request.args['q'])
    if request.args.get('hidden') == '1':
        q['hidden'] = True
    posts = list(mongo.db.posts.find(q, {'image': 0}).sort('createdAt', -1).limit(10000))
    authors = {a['_id']: a for a in mongo.db.users.find({'_id': {'$in': list({p['author'] for p in posts})}}, {'full_name': 1, 'email': 1})}
    audit('post.export', 'post', None, {'rows': len(posts)})
    return csv_response('aivo_posts.csv', ['ID', 'Author', 'Email', 'Posted (UTC)', 'Text', 'Likes', 'Comments', 'Hidden'],
                        [[str(p['_id']), authors.get(p['author'], {}).get('full_name', ''), authors.get(p['author'], {}).get('email', ''),
                          iso_utc(p.get('createdAt')), p.get('content', ''), len(p.get('likes') or []),
                          len(p.get('comments') or []), bool(p.get('hidden'))] for p in posts])


@admin_bp.route('/posts/<post_id>', methods=['GET'])
@staff_required
def post_detail(post_id):
    _id = oid(post_id)
    posts = list(mongo.db.posts.aggregate([
        {'$match': {'_id': _id}},
        {'$addFields': {'has_image': {'$cond': [{'$ifNull': ['$image', False]}, True, False]}}},
        {'$project': {'image': 0}}])) if _id else []
    if not posts:
        return err('Post not found', 404)
    post = _post_rows(posts)[0]
    post['comments'] = [{'id': str(c.get('id')), 'user': c.get('user'), 'username': c.get('username'),
                         'text': c.get('text'), 'created_at': iso_utc(c.get('createdAt'))}
                        for c in posts[0].get('comments') or []]
    return jsonify(success=True, post=post)


@admin_bp.route('/posts/<post_id>/hide', methods=['POST'])
@staff_required
def post_hide(post_id):
    _id, data = oid(post_id), request.get_json() or {}
    hidden = bool(data.get('hidden', True))
    update = ({'$set': {'hidden': True, 'hidden_reason': str(data.get('reason', ''))[:200],
                        'hidden_by': g.admin.get('email'), 'hidden_at': utcnow()}} if hidden
              else {'$unset': {'hidden': '', 'hidden_reason': '', 'hidden_by': '', 'hidden_at': ''}})
    if not _id or not mongo.db.posts.update_one({'_id': _id}, update).matched_count:
        return err('Post not found', 404)
    audit('post.hide' if hidden else 'post.unhide', 'post', _id, {'reason': str(data.get('reason', ''))[:200]})
    return jsonify(success=True)


def _delete_post(_id, note='post_deleted'):
    post = mongo.db.posts.find_one({'_id': _id}, {'author': 1, 'content': 1})
    if not post:
        return False
    mongo.db.posts.delete_one({'_id': _id})
    mongo.db.reports.update_many({'post_id': _id, 'status': 'open'}, {'$set': {
        'status': 'resolved', 'resolution': note, 'resolved_by': g.admin.get('email'), 'resolved_at': utcnow()}})
    audit('post.delete', 'post', _id, {'author': str(post['author']), 'snippet': (post.get('content') or '')[:80]})
    return True


@admin_bp.route('/posts/<post_id>', methods=['DELETE'])
@staff_required
def post_delete(post_id):
    _id = oid(post_id)
    return jsonify(success=True) if _id and _delete_post(_id) else err('Post not found', 404)


@admin_bp.route('/posts/<post_id>/comments/<comment_id>', methods=['DELETE'])
@staff_required
def comment_delete(post_id, comment_id):
    pid, cid = oid(post_id), oid(comment_id)
    if not pid or not cid:
        return err('Not found', 404)
    res = mongo.db.posts.update_one({'_id': pid, 'comments.id': cid}, {'$pull': {'comments': {'id': cid}}})
    if not res.modified_count:
        return err('Comment not found', 404)
    audit('comment.delete', 'post', pid, {'comment_id': comment_id})
    return jsonify(success=True)


# ═════════════════════════════ reports ═════════════════════════════
@admin_bp.route('/reports', methods=['GET'])
@staff_required
def reports_list():
    status = request.args.get('status', 'open')
    q = {} if status == 'all' else {'status': status} if status in ('open', 'resolved', 'dismissed') else {'status': 'open'}
    page, limit = page_args(15, 50)
    total = mongo.db.reports.count_documents(q)
    docs = list(mongo.db.reports.find(q).sort('created_at', -1).skip((page - 1) * limit).limit(limit))
    user_ids = list({d[k] for d in docs for k in ('reporter_id', 'post_author') if d.get(k)})
    users = {u['_id']: u for u in mongo.db.users.find({'_id': {'$in': user_ids}}, {'full_name': 1, 'email': 1})}
    posts = {p['_id']: p for p in mongo.db.posts.find({'_id': {'$in': [d['post_id'] for d in docs]}},
                                                      {'hidden': 1, 'content': 1})}
    name = lambda i: 'Auto-filter' if i is None else users.get(i, {}).get('full_name', '(deleted user)')
    return jsonify(success=True, reports=[{
        'id': str(d['_id']), 'post_id': str(d['post_id']), 'reason': d.get('reason'), 'details': d.get('details', ''),
        'status': d.get('status'), 'resolution': d.get('resolution'), 'note': d.get('note', ''),
        'reporter': {'id': str(d.get('reporter_id') or ''), 'name': name(d.get('reporter_id'))},
        'author': {'id': str(d.get('post_author')), 'name': name(d.get('post_author'))},
        'post_exists': d['post_id'] in posts, 'post_hidden': bool(posts.get(d['post_id'], {}).get('hidden')),
        'snippet': (posts.get(d['post_id'], {}).get('content') or d.get('post_snippet', ''))[:240],
        'created_at': iso_utc(d.get('created_at')), 'resolved_by': d.get('resolved_by'),
        'resolved_at': iso_utc(d.get('resolved_at'))} for d in docs], **page_meta(total, page, limit))


@admin_bp.route('/reports/<report_id>/resolve', methods=['POST'])
@staff_required
def report_resolve(report_id):
    _id, data = oid(report_id), request.get_json() or {}
    action, note = data.get('action'), str(data.get('note', ''))[:300]
    report = mongo.db.reports.find_one({'_id': _id}) if _id else None
    if not report:
        return err('Report not found', 404)
    if action not in ('dismiss', 'hide_post', 'delete_post', 'suspend_author'):
        return err('Unknown action')
    if action == 'suspend_author' and g.role != 'admin':
        return err('Only admins can suspend members', 403)
    post_id = report['post_id']
    if action in ('hide_post', 'suspend_author'):
        mongo.db.posts.update_one({'_id': post_id}, {'$set': {'hidden': True, 'hidden_reason': f"Report: {report.get('reason')}",
                                                              'hidden_by': g.admin.get('email'), 'hidden_at': utcnow()}})
    if action == 'delete_post':
        _delete_post(post_id, 'delete_post')
    if action == 'suspend_author':
        ok, error = suspend_user(report['post_author'], f"Reported content: {report.get('reason')}")
        if not ok:
            return err(error)
    # one decision closes every open report about the same post
    mongo.db.reports.update_many({'post_id': post_id, 'status': 'open'}, {'$set': {
        'status': 'dismissed' if action == 'dismiss' else 'resolved', 'resolution': action, 'note': note,
        'resolved_by': g.admin.get('email'), 'resolved_at': utcnow()}})
    audit(f'report.{action}', 'report', _id, {'post_id': str(post_id), 'note': note})
    return jsonify(success=True)


# ═════════════════════════════ leaderboard ═════════════════════════════
@admin_bp.route('/leaderboard', methods=['GET'])
@admin_required
def leaderboard_admin():
    try:
        limit = max(5, min(int(request.args.get('limit', 50)), 200))
    except ValueError:
        limit = 50
    top = list(mongo.db.users.find({}, {'full_name': 1, 'email': 1, 'points': 1, 'tz': 1, 'is_active': 1})
               .sort('points', -1).limit(limit))
    streaks = streaks_for_users(top, 'UTC')
    seasons = list(mongo.db.leaderboard_seasons.find({}).sort('ended_at', -1).limit(5))
    return jsonify(success=True, leaderboard=[{
        'rank': i, 'id': str(u['_id']), 'name': u.get('full_name', ''), 'email': u.get('email', ''),
        'points': u.get('points', 0), 'streak': streaks.get(str(u['_id']), 0),
        'is_active': u.get('is_active', True) is not False} for i, u in enumerate(top, 1)],
        seasons=[ser(s) for s in seasons])


@admin_bp.route('/leaderboard/reset', methods=['POST'])
@admin_required
def leaderboard_reset():
    """Season reset: archive the current top 10, then zero everyone's points."""
    if (request.get_json() or {}).get('confirm') != 'RESET':
        return err('Type RESET to confirm')
    top = list(mongo.db.users.find({'points': {'$gt': 0}}, {'full_name': 1, 'points': 1}).sort('points', -1).limit(10))
    affected = mongo.db.users.count_documents({'points': {'$gt': 0}})
    mongo.db.leaderboard_seasons.insert_one({
        'ended_at': utcnow(), 'ended_by': g.admin.get('email'), 'participants': affected,
        'top': [{'name': u.get('full_name', ''), 'points': u.get('points', 0)} for u in top]})
    mongo.db.users.update_many({}, {'$set': {'points': 0}})
    audit('leaderboard.reset', 'leaderboard', None, {'participants': affected})
    return jsonify(success=True, affected=affected)
