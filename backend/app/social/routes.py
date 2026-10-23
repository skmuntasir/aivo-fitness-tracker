import re
import hmac
import base64
import hashlib
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, current_app, Response
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson.objectid import ObjectId
from app import mongo
from app.extensions import socketio
from app.social.socket import online_users
from app.social.service import (
    clean_text, unescape_legacy, create_message, serialize_message)
from app.utils import utcnow, iso_utc
from app.runtime import find_banned_word

social_bp = Blueprint('social', __name__)

# Fields we never need when listing people (profile_picture is a large base64 blob)
LIGHT_USER_PROJECTION = {'password': 0, 'profile_picture': 0, 'medical_conditions': 0}
MAX_IMAGE_CHARS = 1_500_000  # ~1.1 MB of base64


def _object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def _mask_email(email):
    if not email or '@' not in email:
        return ''
    name, domain = email.split('@', 1)
    return f"{name[:1]}***@{domain}"


def _user_summary(user, current_id=None, reveal_email=False):
    """Slim public view of a user. No profile picture: it is a big base64 blob that
    used to be repeated for every friend, search hit and feed post."""
    if not user:
        return None
    user_id = str(user.get('_id'))
    is_me = current_id == user_id
    return {
        'id': user_id,
        'username': user.get('username') or user.get('full_name', '').lower().replace(' ', ''),
        'full_name': user.get('full_name', ''),
        'email': user.get('email', '') if (reveal_email or is_me) else _mask_email(user.get('email', '')),
        'online': user_id in online_users,
        'last_active': iso_utc(user.get('last_active')),
        'isMe': is_me,
    }


def _ensure_user_fields(user_doc):
    if not user_doc:
        return
    updates = {}
    if 'friends' not in user_doc:
        updates['friends'] = []
    if not user_doc.get('username'):
        updates['username'] = ''.join(c.lower() for c in user_doc.get('full_name', '') if c.isalnum())[:24] or 'user'
    if updates:
        mongo.db.users.update_one({'_id': user_doc['_id']}, {'$set': updates})


def _parse_before(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return dt if dt.tzinfo is None else dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


# ───────────────────────── Friends ─────────────────────────

@social_bp.route('/api/friends/request/<user_id>', methods=['POST'])
@jwt_required()
def send_friend_request(user_id):
    sender_id = get_jwt_identity()
    if sender_id == user_id:
        return jsonify(success=False, message='Cannot send request to yourself'), 400

    sender_obj, receiver_obj = _object_id(sender_id), _object_id(user_id)
    if not receiver_obj:
        return jsonify(success=False, message='Invalid user ID'), 400

    receiver = mongo.db.users.find_one({'_id': receiver_obj}, LIGHT_USER_PROJECTION)
    sender = mongo.db.users.find_one({'_id': sender_obj}, LIGHT_USER_PROJECTION)
    if not receiver:
        return jsonify(success=False, message='User not found'), 404

    _ensure_user_fields(sender)
    _ensure_user_fields(receiver)

    if sender_obj in receiver.get('friends', []) or receiver_obj in sender.get('friends', []):
        return jsonify(success=False, message='Already friends'), 400

    # Only *pending* requests block a new one (an old 'accepted' row used to block
    # re-adding someone after unfriending them).
    existing = mongo.db.friend_requests.find_one({
        '$or': [{'sender': sender_obj, 'receiver': receiver_obj},
                {'sender': receiver_obj, 'receiver': sender_obj}],
        'status': 'pending'})
    if existing:
        return jsonify(success=False, message='Friend request already pending'), 400

    result = mongo.db.friend_requests.insert_one({
        'sender': sender_obj, 'receiver': receiver_obj,
        'status': 'pending', 'createdAt': utcnow()})

    socketio.emit('friend_request_received', {
        'requestId': str(result.inserted_id),
        'sender': _user_summary(sender, sender_id),
        'receiverId': str(receiver_obj)
    }, room=str(receiver_obj))
    return jsonify(success=True, message='Friend request sent', requestId=str(result.inserted_id))


@social_bp.route('/api/friends/accept/<request_id>', methods=['PUT'])
@jwt_required()
def accept_friend_request(request_id):
    user_id = get_jwt_identity()
    request_obj = _object_id(request_id)
    if not request_obj:
        return jsonify(success=False, message='Invalid request ID'), 400

    fr = mongo.db.friend_requests.find_one(
        {'_id': request_obj, 'receiver': ObjectId(user_id), 'status': 'pending'})
    if not fr:
        return jsonify(success=False, message='Request not found or already handled'), 404

    sender_id, receiver_id = fr['sender'], fr['receiver']
    mongo.db.friend_requests.update_one(
        {'_id': request_obj}, {'$set': {'status': 'accepted', 'updatedAt': utcnow()}})
    mongo.db.users.update_one({'_id': sender_id}, {'$addToSet': {'friends': receiver_id}})
    mongo.db.users.update_one({'_id': receiver_id}, {'$addToSet': {'friends': sender_id}})

    receiver = mongo.db.users.find_one({'_id': receiver_id}, LIGHT_USER_PROJECTION)
    socketio.emit('friend_request_accepted', {
        'requestId': request_id,
        'friend': _user_summary(receiver, str(sender_id))
    }, room=str(sender_id))
    return jsonify(success=True, message='Friend request accepted')


@social_bp.route('/api/friends/reject/<request_id>', methods=['PUT'])
@jwt_required()
def reject_friend_request(request_id):
    user_id = get_jwt_identity()
    request_obj = _object_id(request_id)
    if not request_obj:
        return jsonify(success=False, message='Invalid request ID'), 400
    res = mongo.db.friend_requests.update_one(
        {'_id': request_obj, 'receiver': ObjectId(user_id), 'status': 'pending'},
        {'$set': {'status': 'rejected', 'updatedAt': utcnow()}})
    if not res.matched_count:
        return jsonify(success=False, message='Request not found or already handled'), 404
    return jsonify(success=True, message='Friend request rejected')


@social_bp.route('/api/friends/remove/<friend_id>', methods=['DELETE'])
@jwt_required()
def remove_friend(friend_id):
    user_obj = _object_id(get_jwt_identity())
    friend_obj = _object_id(friend_id)
    if not friend_obj:
        return jsonify(success=False, message='Invalid friend ID'), 400
    mongo.db.users.update_one({'_id': user_obj}, {'$pull': {'friends': friend_obj}})
    mongo.db.users.update_one({'_id': friend_obj}, {'$pull': {'friends': user_obj}})
    mongo.db.friend_requests.delete_many({'$or': [
        {'sender': user_obj, 'receiver': friend_obj},
        {'sender': friend_obj, 'receiver': user_obj}]})
    return jsonify(success=True, message='Friend removed')


@social_bp.route('/api/friends/list', methods=['GET'])
@jwt_required()
def friend_list():
    """One round-trip for the whole friends list incl. unread counts + last message
    (the Chat UI expected `unread_count`/`last_message` but the API never sent them)."""
    user_id = get_jwt_identity()
    me = ObjectId(user_id)
    user_doc = mongo.db.users.find_one({'_id': me}, {'friends': 1, 'full_name': 1, 'username': 1})
    if not user_doc:
        return jsonify(success=False, message='User not found'), 404
    _ensure_user_fields(user_doc)

    friend_ids = user_doc.get('friends', []) or []
    if not friend_ids:
        return jsonify(success=True, friends=[], total_unread=0)

    friends_docs = list(mongo.db.users.find({'_id': {'$in': friend_ids}}, LIGHT_USER_PROJECTION))

    unread = {str(r['_id']): r['n'] for r in mongo.db.messages.aggregate([
        {'$match': {'receiver': me, 'sender': {'$in': friend_ids}, 'read': False}},
        {'$group': {'_id': '$sender', 'n': {'$sum': 1}}}])}

    last = {str(r['_id']): r for r in mongo.db.messages.aggregate([
        {'$match': {'$or': [{'sender': me, 'receiver': {'$in': friend_ids}},
                            {'receiver': me, 'sender': {'$in': friend_ids}}]}},
        {'$sort': {'timestamp': -1, '_id': -1}},
        {'$group': {'_id': {'$cond': [{'$eq': ['$sender', me]}, '$receiver', '$sender']},
                    'message': {'$first': '$message'}, 'timestamp': {'$first': '$timestamp'}}}])}

    friends = []
    for f in friends_docs:
        s = _user_summary(f, user_id, reveal_email=True)
        fid = s['id']
        s['unread_count'] = unread.get(fid, 0)
        if fid in last:
            s['last_message'] = unescape_legacy(last[fid]['message'])[:80]
            s['last_message_at'] = iso_utc(last[fid]['timestamp'])
        friends.append(s)

    friends.sort(key=lambda x: x.get('last_message_at') or '', reverse=True)
    return jsonify(success=True, friends=friends, total_unread=sum(unread.values()))


@social_bp.route('/api/friends/requests', methods=['GET'])
@jwt_required()
def incoming_requests():
    user_id = get_jwt_identity()
    pending = list(mongo.db.friend_requests.find(
        {'receiver': ObjectId(user_id), 'status': 'pending'}).sort('createdAt', -1))
    senders = {u['_id']: u for u in mongo.db.users.find(
        {'_id': {'$in': [r['sender'] for r in pending]}}, LIGHT_USER_PROJECTION)}  # 1 query, was N
    response = []
    for req in pending:
        sender = senders.get(req['sender'])
        if not sender:
            continue
        response.append({
            'requestId': str(req['_id']),
            'sender': _user_summary(sender, user_id),
            'createdAt': iso_utc(req['createdAt'])})
    return jsonify(success=True, requests=response, count=len(response))


@social_bp.route('/api/users/search', methods=['GET'])
@jwt_required()
def search_users():
    user_id = get_jwt_identity()
    me = ObjectId(user_id)
    query = request.args.get('query', '').strip()[:60]
    if len(query) < 2:
        return jsonify(success=True, users=[])

    current_user = mongo.db.users.find_one({'_id': me}, {'friends': 1, 'full_name': 1, 'username': 1})
    if not current_user:
        return jsonify(success=False, message='User not found'), 404
    friends = set(current_user.get('friends', []) or [])

    regex = {'$regex': re.escape(query), '$options': 'i'}  # escaped: user input was used as a raw regex
    found = list(mongo.db.users.find(
        {'_id': {'$ne': me}, '$or': [{'username': regex}, {'email': regex}, {'full_name': regex}]},
        LIGHT_USER_PROJECTION).limit(20))
    ids = [u['_id'] for u in found]

    sent = {r['receiver']: r for r in mongo.db.friend_requests.find(
        {'sender': me, 'receiver': {'$in': ids}, 'status': 'pending'}, {'receiver': 1})}
    received = {r['sender']: r for r in mongo.db.friend_requests.find(
        {'receiver': me, 'sender': {'$in': ids}, 'status': 'pending'}, {'sender': 1})}  # 2 queries total, was up to 2 per user

    results = []
    for u in found:
        profile = _user_summary(u, user_id, reveal_email=u['_id'] in friends)
        profile['request_id'] = None
        if u['_id'] in friends:
            profile['relation'] = 'friends'
        elif u['_id'] in sent:
            profile['relation'] = 'request_sent'
        elif u['_id'] in received:
            profile['relation'] = 'request_received'
            profile['request_id'] = str(received[u['_id']]['_id'])
        else:
            profile['relation'] = 'none'
        results.append(profile)
    return jsonify(success=True, users=results)


@social_bp.route('/api/users/<user_id>', methods=['GET'])
@jwt_required()
def get_user_profile(user_id):
    user_obj = _object_id(user_id)
    if not user_obj:
        return jsonify(success=False, message='Invalid user ID'), 400
    user = mongo.db.users.find_one({'_id': user_obj}, LIGHT_USER_PROJECTION)
    if not user:
        return jsonify(success=False, message='User not found'), 404
    me = get_jwt_identity()
    return jsonify(success=True, user=_user_summary(user, me, reveal_email=is_friend_of(me, user_obj)))


def is_friend_of(me, other_obj):
    return bool(mongo.db.users.count_documents({'_id': ObjectId(me), 'friends': other_obj}, limit=1))


# ───────────────────────── Messages ─────────────────────────

@social_bp.route('/api/messages/<friend_id>', methods=['GET'])
@jwt_required()
def get_messages(friend_id):
    """Paginated: newest `limit` messages (default 50), older ones via ?before=<message id>."""
    user_id = get_jwt_identity()
    friend_obj = _object_id(friend_id)
    if not friend_obj:
        return jsonify(success=False, message='Invalid friend ID'), 400
    if not is_friend_of(user_id, friend_obj):
        return jsonify(success=False, message='Can only chat with friends'), 403

    try:
        limit = max(1, min(int(request.args.get('limit', 50)), 100))
    except ValueError:
        limit = 50
    me = ObjectId(user_id)
    query = {'$or': [{'sender': me, 'receiver': friend_obj}, {'sender': friend_obj, 'receiver': me}]}
    before = request.args.get('before')  # id of the oldest message the client already has
    if before and ObjectId.is_valid(before):
        query['_id'] = {'$lt': ObjectId(before)}  # id cursor: stable even when timestamps tie

    docs = list(mongo.db.messages.find(query).sort('_id', -1).limit(limit + 1))
    has_more = len(docs) > limit
    docs = list(reversed(docs[:limit]))
    return jsonify(success=True, messages=[serialize_message(d) for d in docs], hasMore=has_more)


@social_bp.route('/api/messages', methods=['POST'])
@jwt_required()
def post_message():
    """REST fallback (used if the socket is down). Same code path as the socket."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    receiver_id = data.get('receiverId')
    payload, error = create_message(user_id, receiver_id, data.get('message'), data.get('clientId'))
    if error:
        return jsonify(success=False, message=error), (403 if 'friends' in error else 400)
    socketio.emit('new_message', payload, room=receiver_id)
    socketio.emit('new_message', payload, room=user_id)
    return jsonify(success=True, message='Message sent', data=payload)


@social_bp.route('/api/messages/unread-count', methods=['GET'])
@jwt_required()
def unread_message_count():
    # Previously queried string ids against ObjectId fields and a `read` field that was never
    # written, so the badge was always 0.
    user_id = get_jwt_identity()
    count = mongo.db.messages.count_documents({'receiver': ObjectId(user_id), 'read': False})
    return jsonify(success=True, unread_count=count)


@social_bp.route('/api/messages/<friend_id>/read', methods=['PUT'])
@jwt_required()
def mark_messages_read(friend_id):
    user_id = get_jwt_identity()
    friend_obj = _object_id(friend_id)
    if not friend_obj:
        return jsonify(success=False, message='Invalid friend ID'), 400
    mongo.db.messages.update_many(
        {'sender': friend_obj, 'receiver': ObjectId(user_id), 'read': False}, {'$set': {'read': True}})
    return jsonify(success=True)


# ───────────────────────── Posts ─────────────────────────

def _image_sig(post_id):
    """Unguessable per-post signature so <img src> (which cannot send an Authorization header)
    can load a post photo from its own cacheable URL. Only viewers who were allowed to see the
    post ever receive this URL."""
    key = str(current_app.config.get('JWT_SECRET_KEY') or current_app.config.get('SECRET_KEY'))
    return hmac.new(key.encode(), str(post_id).encode(), hashlib.sha256).hexdigest()[:32]


def _serialize_post(post, authors, user_id):
    """Feed payload. The photo itself is NOT embedded (up to ~1 MB of base64 per post made the
    feed take seconds); the client gets a small `imageUrl` that the browser loads in parallel
    and caches."""
    likes = post.get('likes', []) or []
    comments = post.get('comments', []) or []
    author = authors.get(post['author'])
    pid = str(post['_id'])
    has_image = bool(post.get('has_image', post.get('image')))
    return {
        'id': pid,
        'user_id': str(post['author']),
        'author': {'id': str(post['author']), 'full_name': author.get('full_name', ''),
                   'username': author.get('username', '')},
        'content': unescape_legacy(post.get('content', '')),
        'image': None,
        'imageUrl': f"/api/posts/{pid}/image?sig={_image_sig(pid)}" if has_image else None,
        'likes': len(likes),
        'likedByUser': ObjectId(user_id) in likes,
        'commentsCount': len(comments),
        'comments': [_serialize_comment(c) for c in comments[-30:]],
        'createdAt': iso_utc(post['createdAt']),
    }


def _serialize_comment(c):
    return {
        'id': str(c.get('id')),
        'user': c.get('user'),
        'username': c.get('username'),
        'text': unescape_legacy(c.get('text')),
        'createdAt': iso_utc(c.get('createdAt')),
    }


@social_bp.route('/api/posts', methods=['POST'])
@jwt_required()
def create_post():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    content = clean_text(data.get('content', ''), 2000)
    image = data.get('image')

    if image and (not isinstance(image, str) or not image.startswith('data:image/') or len(image) > MAX_IMAGE_CHARS):
        return jsonify(success=False, message='Image is invalid or too large (max ~1MB).'), 400
    if not content and not image:
        return jsonify(success=False, message='Post content or image is required'), 400

    post = {'author': ObjectId(user_id), 'content': content, 'image': image or None,
            'likes': [], 'comments': [], 'createdAt': utcnow()}
    bad = find_banned_word(content)
    if bad:   # auto-hide + send to the admin reports queue
        post.update(hidden=True, hidden_reason=f'Auto-flagged: {bad}', hidden_by='auto-filter', hidden_at=utcnow())
    post['_id'] = mongo.db.posts.insert_one(post).inserted_id
    if bad:
        mongo.db.reports.insert_one({'post_id': post['_id'], 'post_author': post['author'], 'reporter_id': None,
                                     'reason': 'other', 'details': f'Auto-flagged: contains "{bad}"',
                                     'post_snippet': content[:240], 'status': 'open', 'created_at': utcnow()})
    author = mongo.db.users.find_one({'_id': post['author']}, {'full_name': 1, 'username': 1})
    return jsonify(success=True, message='Post created', postId=str(post['_id']),
                   post=_serialize_post(post, {post['author']: author or {}}, user_id))


@social_bp.route('/api/posts/feed', methods=['GET'])
@jwt_required()
def get_feed():
    """Paginated feed (default 10 posts) - was 50 posts with full base64 images and avatars every time."""
    user_id = get_jwt_identity()
    me = ObjectId(user_id)
    user_doc = mongo.db.users.find_one({'_id': me}, {'friends': 1})
    if not user_doc:
        return jsonify(success=False, message='User not found'), 404

    try:
        limit = max(1, min(int(request.args.get('limit', 10)), 30))
    except ValueError:
        limit = 10
    query = {'author': {'$in': [me] + (user_doc.get('friends', []) or [])}, 'hidden': {'$ne': True}}  # hidden = moderated by an admin
    before = _parse_before(request.args.get('before'))
    if before:
        query['createdAt'] = {'$lt': before}

    # The aggregation drops the base64 `image` inside MongoDB (so it never travels to the API
    # process or the browser) and only reports whether a photo exists.
    posts = list(mongo.db.posts.aggregate([
        {'$match': query},
        {'$sort': {'createdAt': -1}},
        {'$limit': limit + 1},
        {'$addFields': {'has_image': {'$cond': [{'$ifNull': ['$image', False]}, True, False]}}},
        {'$project': {'image': 0}},
    ]))
    has_more = len(posts) > limit
    posts = posts[:limit]
    authors = {u['_id']: u for u in mongo.db.users.find(
        {'_id': {'$in': list({p['author'] for p in posts})}}, {'full_name': 1, 'username': 1})}

    feed = [_serialize_post(p, authors, user_id) for p in posts if p['author'] in authors]
    next_before = iso_utc(posts[-1]['createdAt']) if posts else None
    return jsonify(success=True, posts=feed, hasMore=has_more, nextBefore=next_before)


@social_bp.route('/api/posts/<post_id>/image', methods=['GET'])
def post_image(post_id):
    """Serves a post photo as a real image file with long-lived caching (first view downloads it,
    every later view is instant). Access is controlled by the signed URL from the feed."""
    post_obj = _object_id(post_id)
    sig = request.args.get('sig', '')
    if not post_obj or not hmac.compare_digest(sig, _image_sig(post_id)):
        return Response(status=404)
    post = mongo.db.posts.find_one({'_id': post_obj}, {'image': 1})
    data_url = (post or {}).get('image')
    if not data_url or not isinstance(data_url, str) or ',' not in data_url:
        return Response(status=404)
    header, b64 = data_url.split(',', 1)
    mime = header[5:].split(';', 1)[0] or 'image/jpeg'
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return Response(status=404)
    etag = hashlib.md5(raw).hexdigest()
    if request.headers.get('If-None-Match') == f'"{etag}"':
        return Response(status=304)
    resp = Response(raw, mimetype=mime)
    resp.headers['Cache-Control'] = 'private, max-age=31536000, immutable'
    resp.headers['ETag'] = f'"{etag}"'
    resp.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
    return resp


@social_bp.route('/api/posts/<post_id>/like', methods=['POST'])
@jwt_required()
def like_post(post_id):
    user_obj = ObjectId(get_jwt_identity())
    post_obj = _object_id(post_id)
    if not post_obj:
        return jsonify(success=False, message='Invalid post ID'), 400

    # Atomic toggle: try to un-like first; if nothing changed, like.
    res = mongo.db.posts.update_one({'_id': post_obj, 'likes': user_obj}, {'$pull': {'likes': user_obj}})
    if res.modified_count:
        liked = False
    else:
        res = mongo.db.posts.update_one({'_id': post_obj}, {'$addToSet': {'likes': user_obj}})
        if not res.matched_count:
            return jsonify(success=False, message='Post not found'), 404
        liked = True
    post = mongo.db.posts.find_one({'_id': post_obj}, {'likes': 1})
    return jsonify(success=True, liked=liked, likes=len(post.get('likes', [])))


@social_bp.route('/api/posts/<post_id>/comment', methods=['POST'])
@jwt_required()
def comment_post(post_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    text = clean_text(data.get('comment', ''), 500)
    if not text:
        return jsonify(success=False, message='Comment cannot be empty'), 400
    post_obj = _object_id(post_id)
    if not post_obj:
        return jsonify(success=False, message='Invalid post ID'), 400
    if find_banned_word(text):
        return jsonify(success=False, message='Your comment contains words that are not allowed.'), 400

    user = mongo.db.users.find_one({'_id': ObjectId(user_id)}, {'full_name': 1, 'username': 1})
    if not user:
        return jsonify(success=False, message='User not found'), 404

    comment = {'id': ObjectId(), 'user': user_id,
               'username': user.get('username') or user.get('full_name', ''),
               'text': text, 'createdAt': utcnow()}
    res = mongo.db.posts.update_one({'_id': post_obj}, {'$push': {'comments': comment}})
    if not res.matched_count:
        return jsonify(success=False, message='Post not found'), 404
    return jsonify(success=True, commentId=str(comment['id']), comment=_serialize_comment(comment))


@social_bp.route('/api/posts/<post_id>', methods=['DELETE'])
@jwt_required()
def delete_post(post_id):
    post_obj = _object_id(post_id)
    if not post_obj:
        return jsonify(success=False, message='Invalid post ID'), 400
    res = mongo.db.posts.delete_one({'_id': post_obj, 'author': ObjectId(get_jwt_identity())})
    if not res.deleted_count:
        return jsonify(success=False, message='Post not found or not yours'), 404
    return jsonify(success=True, message='Post deleted')


@social_bp.route('/api/posts/<post_id>', methods=['PUT'])
@jwt_required()
def edit_post(post_id):
    post_obj = _object_id(post_id)
    if not post_obj:
        return jsonify(success=False, message='Invalid post ID'), 400
    content = clean_text((request.get_json() or {}).get('content', ''), 2000)
    if not content:
        return jsonify(success=False, message='Content cannot be empty'), 400
    if find_banned_word(content):
        return jsonify(success=False, message='Your post contains words that are not allowed.'), 400
    res = mongo.db.posts.update_one(
        {'_id': post_obj, 'author': ObjectId(get_jwt_identity())}, {'$set': {'content': content}})
    if not res.matched_count:
        return jsonify(success=False, message='Post not found or not yours'), 404
    return jsonify(success=True, message='Post updated')
