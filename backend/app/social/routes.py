from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson.objectid import ObjectId
from datetime import datetime
from app import mongo
from app.extensions import socketio
from app.social.socket import online_users
import html

social_bp = Blueprint('social', __name__)


def _sanitize_text(value):
    if not value:
        return ''
    return html.escape(str(value)).strip()


def _object_id(value):
    try:
        return ObjectId(value)
    except Exception:
        return None


def _user_summary(user, current_id=None):
    if not user:
        return None
    user_id = str(user.get('_id'))
    online = user_id in online_users
    return {
        'id': user_id,
        'username': user.get('username') or user.get('full_name', '').lower().replace(' ', ''),
        'full_name': user.get('full_name', ''),
        'email': user.get('email', ''),
        'online': online,
        'last_active': user.get('last_active').isoformat() if user.get('last_active') else None,
        'profile_picture': user.get('profile_picture', None),
        'isMe': current_id == user_id
    }


def _deleted_user_summary():
    return {
        'id': None,
        'username': 'deleted_user',
        'full_name': 'Deleted User',
        'email': '',
        'online': False,
        'last_active': None,
        'profile_picture': None,
        'isMe': False
    }


def _ensure_user_fields(user_doc):
    if not user_doc:
        return
    updates = {}
    if 'friends' not in user_doc:
        updates['friends'] = []
    if 'username' not in user_doc or not user_doc['username']:
        username = ''.join([c.lower() for c in user_doc.get('full_name', '') if c.isalnum()])[:24] or 'user'
        updates['username'] = username
    if updates:
        mongo.db.users.update_one({'_id': user_doc['_id']}, {'$set': updates})


@social_bp.route('/api/friends/request/<user_id>', methods=['POST'])
@jwt_required()
def send_friend_request(user_id):
    sender_id = get_jwt_identity()
    if sender_id == user_id:
        return jsonify(success=False, message='Cannot send request to yourself'), 400

    sender_obj = _object_id(sender_id)
    receiver_obj = _object_id(user_id)
    if not receiver_obj:
        return jsonify(success=False, message='Invalid user ID'), 400

    receiver = mongo.db.users.find_one({'_id': receiver_obj})
    sender = mongo.db.users.find_one({'_id': sender_obj})
    if not receiver:
        return jsonify(success=False, message='User not found'), 404

    _ensure_user_fields(sender)
    _ensure_user_fields(receiver)

    if sender_obj in receiver.get('friends', []) or receiver_obj in sender.get('friends', []):
        return jsonify(success=False, message='Already friends'), 400

    existing_request = mongo.db.friend_requests.find_one({
        '$or': [
            {'sender': sender_obj, 'receiver': receiver_obj},
            {'sender': receiver_obj, 'receiver': sender_obj}
        ],
        'status': {'$in': ['pending', 'accepted']}
    })
    if existing_request:
        return jsonify(success=False, message='Friend request already exists or you are already friends'), 400

    request_doc = {
        'sender': sender_obj,
        'receiver': receiver_obj,
        'status': 'pending',
        'createdAt': datetime.utcnow()
    }
    result = mongo.db.friend_requests.insert_one(request_doc)

    if receiver_id := str(receiver_obj):
        socketio.emit('friend_request_received', {
            'requestId': str(result.inserted_id),
            'sender': _user_summary(sender, sender_id),
            'receiverId': receiver_id
        }, room=receiver_id)

    return jsonify(success=True, message='Friend request sent')


@social_bp.route('/api/friends/accept/<request_id>', methods=['PUT'])
@jwt_required()
def accept_friend_request(request_id):
    user_id = get_jwt_identity()
    request_obj = _object_id(request_id)
    if not request_obj:
        return jsonify(success=False, message='Invalid request ID'), 400

    friend_request = mongo.db.friend_requests.find_one({'_id': request_obj, 'receiver': ObjectId(user_id), 'status': 'pending'})
    if not friend_request:
        return jsonify(success=False, message='Request not found or already handled'), 404

    sender_id = friend_request['sender']
    receiver_id = friend_request['receiver']
    mongo.db.friend_requests.update_one({'_id': request_obj}, {'$set': {'status': 'accepted', 'updatedAt': datetime.utcnow()}})
    mongo.db.users.update_one({'_id': sender_id}, {'$addToSet': {'friends': receiver_id}})
    mongo.db.users.update_one({'_id': receiver_id}, {'$addToSet': {'friends': sender_id}})

    sender = mongo.db.users.find_one({'_id': sender_id})
    receiver = mongo.db.users.find_one({'_id': receiver_id})
    _ensure_user_fields(sender)
    _ensure_user_fields(receiver)

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

    friend_request = mongo.db.friend_requests.find_one({'_id': request_obj, 'receiver': ObjectId(user_id), 'status': 'pending'})
    if not friend_request:
        return jsonify(success=False, message='Request not found or already handled'), 404

    mongo.db.friend_requests.update_one({'_id': request_obj}, {'$set': {'status': 'rejected', 'updatedAt': datetime.utcnow()}})
    return jsonify(success=True, message='Friend request rejected')


@social_bp.route('/api/friends/remove/<friend_id>', methods=['DELETE'])
@jwt_required()
def remove_friend(friend_id):
    user_id = get_jwt_identity()
    user_obj = _object_id(user_id)
    friend_obj = _object_id(friend_id)
    if not friend_obj:
        return jsonify(success=False, message='Invalid friend ID'), 400

    mongo.db.users.update_one({'_id': user_obj}, {'$pull': {'friends': friend_obj}})
    mongo.db.users.update_one({'_id': friend_obj}, {'$pull': {'friends': user_obj}})
    return jsonify(success=True, message='Friend removed')


@social_bp.route('/api/friends/list', methods=['GET'])
@jwt_required()
def friend_list():
    user_id = get_jwt_identity()
    user_doc = mongo.db.users.find_one({'_id': ObjectId(user_id)})
    if not user_doc:
        return jsonify(success=False, message='User not found'), 404

    _ensure_user_fields(user_doc)
    friend_ids = user_doc.get('friends', []) or []
    friends = []
    for friend in mongo.db.users.find({'_id': {'$in': friend_ids}}):
        summary = _user_summary(friend, user_id)
        friends.append(summary)

    return jsonify(success=True, friends=friends)


@social_bp.route('/api/friends/requests', methods=['GET'])
@jwt_required()
def incoming_requests():
    user_id = get_jwt_identity()
    pending_requests = list(mongo.db.friend_requests.find({'receiver': ObjectId(user_id), 'status': 'pending'}).sort('createdAt', -1))
    response = []
    for req in pending_requests:
        sender = mongo.db.users.find_one({'_id': req['sender']})
        if not sender:
            continue  # skip orphaned requests where sender was deleted
        response.append({
            'requestId': str(req['_id']),
            'sender': _user_summary(sender, user_id),
            'createdAt': req['createdAt'].isoformat()
        })
    return jsonify(success=True, requests=response, count=len(response))


@social_bp.route('/api/users/search', methods=['GET'])
@jwt_required()
def search_users():
    user_id = get_jwt_identity()
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify(success=True, users=[])

    regex = {'$regex': query, '$options': 'i'}
    current_user = mongo.db.users.find_one({'_id': ObjectId(user_id)})
    if not current_user:
        return jsonify(success=False, message='User not found'), 404

    _ensure_user_fields(current_user)
    friends = current_user.get('friends', []) or []

    results = []
    cursor = mongo.db.users.find({
        '_id': {'$ne': ObjectId(user_id)},
        '$or': [
            {'username': regex},
            {'email': regex},
            {'full_name': regex}
        ]
    }).limit(30)

    for user in cursor:
        relation = 'none'
        if user['_id'] in friends:
            relation = 'friends'
        else:
            request_sent = mongo.db.friend_requests.find_one({'sender': ObjectId(user_id), 'receiver': user['_id'], 'status': 'pending'})
            if request_sent:
                relation = 'request_sent'
            else:
                request_received = mongo.db.friend_requests.find_one({'sender': user['_id'], 'receiver': ObjectId(user_id), 'status': 'pending'})
                if request_received:
                    relation = 'request_received'
        profile = _user_summary(user, user_id)
        profile['relation'] = relation
        results.append(profile)

    return jsonify(success=True, users=results)


@social_bp.route('/api/users/<user_id>', methods=['GET'])
@jwt_required()
def get_user_profile(user_id):
    user_obj = _object_id(user_id)
    if not user_obj:
        return jsonify(success=False, message='Invalid user ID'), 400

    user = mongo.db.users.find_one({'_id': user_obj}, {'password': 0})
    if not user:
        return jsonify(success=False, message='User not found'), 404

    return jsonify(success=True, user=_user_summary(user, get_jwt_identity()))


@social_bp.route('/api/messages/<friend_id>', methods=['GET'])
@jwt_required()
def get_messages(friend_id):
    user_id = get_jwt_identity()
    friend_obj = _object_id(friend_id)
    if not friend_obj:
        return jsonify(success=False, message='Invalid friend ID'), 400

    user_doc = mongo.db.users.find_one({'_id': ObjectId(user_id)})
    if not user_doc:
        return jsonify(success=False, message='User not found'), 404

    if friend_obj not in (user_doc.get('friends', []) or []):
        return jsonify(success=False, message='Can only chat with friends'), 403

    messages = list(mongo.db.messages.find({
        '$or': [
            {'sender': ObjectId(user_id), 'receiver': friend_obj},
            {'sender': friend_obj, 'receiver': ObjectId(user_id)}
        ]
    }).sort('timestamp', 1))

    response = []
    for msg in messages:
        response.append({
            'id': str(msg['_id']),
            'sender': str(msg['sender']),
            'receiver': str(msg['receiver']),
            'message': msg.get('message', ''),
            'timestamp': msg['timestamp'].isoformat()
        })

    return jsonify(success=True, messages=response)


@social_bp.route('/api/messages', methods=['POST'])
@jwt_required()
def post_message():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    receiver_id = data.get('receiverId')
    message = _sanitize_text(data.get('message', ''))

    if not receiver_id or not message:
        return jsonify(success=False, message='Receiver and message are required'), 400

    sender_obj = _object_id(user_id)
    receiver_obj = _object_id(receiver_id)
    if not sender_obj or not receiver_obj:
        return jsonify(success=False, message='Invalid user ID'), 400

    user_doc = mongo.db.users.find_one({'_id': sender_obj})
    if not user_doc or receiver_obj not in (user_doc.get('friends', []) or []):
        return jsonify(success=False, message='Can only message friends'), 403

    message_doc = {
        'sender': sender_obj,
        'receiver': receiver_obj,
        'message': message,
        'timestamp': datetime.utcnow()
    }
    mongo.db.messages.insert_one(message_doc)

    payload = {
        'sender': user_id,
        'receiver': receiver_id,
        'message': message,
        'timestamp': message_doc['timestamp'].isoformat()
    }
    socketio.emit('new_message', payload, room=receiver_id)
    return jsonify(success=True, message='Message sent', data=payload)


@social_bp.route('/api/posts', methods=['POST'])
@jwt_required()
def create_post():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    content = _sanitize_text(data.get('content', ''))
    image = data.get('image')

    if not content and not image:
        return jsonify(success=False, message='Post content or image is required'), 400

    author_obj = ObjectId(user_id)
    post_doc = {
        'author': author_obj,
        'content': content,
        'image': image,
        'likes': [],
        'comments': [],
        'createdAt': datetime.utcnow()
    }
    result = mongo.db.posts.insert_one(post_doc)
    return jsonify(success=True, message='Post created', postId=str(result.inserted_id))


@social_bp.route('/api/posts/feed', methods=['GET'])
@jwt_required()
def get_feed():
    user_id = get_jwt_identity()
    user_doc = mongo.db.users.find_one({'_id': ObjectId(user_id)})
    if not user_doc:
        return jsonify(success=False, message='User not found'), 404

    friends = user_doc.get('friends', []) or []
    author_ids = [ObjectId(user_id)] + friends
    posts = list(mongo.db.posts.find({'author': {'$in': author_ids}}).sort('createdAt', -1).limit(50))
    author_ids_set = list({post['author'] for post in posts})
    authors = {str(user['_id']): user for user in mongo.db.users.find({'_id': {'$in': author_ids_set}})}

    feed = []
    for post in posts:
        author = authors.get(str(post['author']))
        # Skip posts from deleted users entirely
        if not author:
            continue
        feed.append({
            'id': str(post['_id']),
            'user_id': str(post['author']),
            'author': _user_summary(author, user_id),
            'content': post.get('content', ''),
            'image': post.get('image'),
            'likes': len(post.get('likes', [])),
            'likedByUser': str(ObjectId(user_id)) in [str(uid) for uid in post.get('likes', [])],
            'commentsCount': len(post.get('comments', [])),
            'comments': [
                {
                    'id': str(comment.get('id')),
                    'user': comment.get('user'),
                    'username': comment.get('username'),
                    'text': comment.get('text'),
                    'createdAt': comment.get('createdAt').isoformat() if comment.get('createdAt') else None
                }
                for comment in post.get('comments', [])
            ],
            'createdAt': post['createdAt'].isoformat()
        })

    return jsonify(success=True, posts=feed)


@social_bp.route('/api/posts/<post_id>/like', methods=['POST'])
@jwt_required()
def like_post(post_id):
    user_id = get_jwt_identity()
    post_obj = _object_id(post_id)
    if not post_obj:
        return jsonify(success=False, message='Invalid post ID'), 400

    post = mongo.db.posts.find_one({'_id': post_obj})
    if not post:
        return jsonify(success=False, message='Post not found'), 404

    user_obj = ObjectId(user_id)
    if user_obj in post.get('likes', []):
        mongo.db.posts.update_one({'_id': post_obj}, {'$pull': {'likes': user_obj}})
        liked = False
    else:
        mongo.db.posts.update_one({'_id': post_obj}, {'$addToSet': {'likes': user_obj}})
        liked = True

    return jsonify(success=True, liked=liked)


@social_bp.route('/api/posts/<post_id>/comment', methods=['POST'])
@jwt_required()
def comment_post(post_id):
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    text = _sanitize_text(data.get('comment', ''))
    if not text:
        return jsonify(success=False, message='Comment cannot be empty'), 400

    post_obj = _object_id(post_id)
    if not post_obj:
        return jsonify(success=False, message='Invalid post ID'), 400

    user = mongo.db.users.find_one({'_id': ObjectId(user_id)})
    if not user:
        return jsonify(success=False, message='User not found'), 404

    comment = {
        'id': ObjectId(),
        'user': user_id,
        'username': user.get('username') or user.get('full_name', ''),
        'text': text,
        'createdAt': datetime.utcnow()
    }

    mongo.db.posts.update_one({'_id': post_obj}, {'$push': {'comments': comment}})
    return jsonify(success=True, commentId=str(comment['id']))


@social_bp.route('/api/posts/<post_id>', methods=['DELETE'])
@jwt_required()
def delete_post(post_id):
    user_id = get_jwt_identity()
    post_obj = _object_id(post_id)
    if not post_obj:
        return jsonify(success=False, message='Invalid post ID'), 400

    post = mongo.db.posts.find_one({'_id': post_obj})
    if not post:
        return jsonify(success=False, message='Post not found'), 404

    if str(post['author']) != user_id:
        return jsonify(success=False, message='Unauthorized'), 403

    mongo.db.posts.delete_one({'_id': post_obj})
    return jsonify(success=True, message='Post deleted')


@social_bp.route('/api/posts/<post_id>', methods=['PUT'])
@jwt_required()
def edit_post(post_id):
    user_id = get_jwt_identity()
    post_obj = _object_id(post_id)
    if not post_obj:
        return jsonify(success=False, message='Invalid post ID'), 400

    post = mongo.db.posts.find_one({'_id': post_obj})
    if not post:
        return jsonify(success=False, message='Post not found'), 404

    if str(post['author']) != user_id:
        return jsonify(success=False, message='Unauthorized'), 403

    data = request.get_json() or {}
    content = _sanitize_text(data.get('content', ''))
    if not content:
        return jsonify(success=False, message='Content cannot be empty'), 400

    mongo.db.posts.update_one({'_id': post_obj}, {'$set': {'content': content}})
    return jsonify(success=True, message='Post updated')

@social_bp.route('/api/messages/unread-count', methods=['GET'])
@jwt_required()
def unread_message_count():
    """Return count of unread messages for the current user."""
    user_id = get_jwt_identity()
    try:
        count = mongo.db.messages.count_documents({'receiver': user_id, 'read': False})
        return jsonify({'success': True, 'unread_count': count})
    except Exception as e:
        return jsonify({'success': False, 'unread_count': 0, 'message': str(e)}), 500


@social_bp.route('/api/messages/<friend_id>/read', methods=['PUT'])
@jwt_required()
def mark_messages_read(friend_id):
    """Mark all messages from a given sender as read."""
    user_id = get_jwt_identity()
    try:
        mongo.db.messages.update_many(
            {'sender': friend_id, 'receiver': user_id, 'read': False},
            {'$set': {'read': True}}
        )
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500
