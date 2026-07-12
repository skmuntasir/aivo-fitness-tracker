from datetime import datetime
from flask import request
from flask_jwt_extended import decode_token
from flask_socketio import join_room, leave_room
from bson.objectid import ObjectId
from app import mongo
from app.extensions import socketio

online_users = {}
sid_to_user = {}


def _get_user_id_from_token(token):
    if not token:
        return None
    try:
        decoded = decode_token(token)
        return str(decoded.get('sub') or decoded.get('identity'))
    except Exception:
        return None


def _is_friend(user_id, friend_id):
    try:
        user = mongo.db.users.find_one({'_id': ObjectId(user_id)}, {'friends': 1})
        if not user:
            return False
        return ObjectId(friend_id) in user.get('friends', [])
    except Exception:
        return False


@socketio.on('connect')
def on_connect(auth):
    token = None
    if isinstance(auth, dict):
        token = auth.get('token')
    if not token:
        token = request.args.get('token')

    user_id = _get_user_id_from_token(token)
    if not user_id:
        return False

    online_users[user_id] = request.sid
    sid_to_user[request.sid] = user_id
    join_room(user_id)
    mongo.db.users.update_one(
        {'_id': ObjectId(user_id)},
        {'$set': {'last_active': datetime.utcnow()}}
    )
    socketio.emit('user_online', {'userId': user_id}, room=user_id)


@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    user_id = sid_to_user.pop(sid, None)
    if user_id:
        online_users.pop(user_id, None)
        leave_room(user_id)
        mongo.db.users.update_one(
            {'_id': ObjectId(user_id)},
            {'$set': {'last_active': datetime.utcnow()}}
        )
        socketio.emit('user_offline', {'userId': user_id}, room=user_id)


@socketio.on('typing')
def on_typing(payload):
    user_id = sid_to_user.get(request.sid)
    if not user_id:
        return

    receiver_id = payload.get('receiverId')
    is_typing = bool(payload.get('isTyping'))
    if not receiver_id:
        return

    if not _is_friend(user_id, receiver_id):
        return

    socketio.emit('typing', {
        'senderId': user_id,
        'receiverId': receiver_id,
        'isTyping': is_typing
    }, room=receiver_id)


@socketio.on('send_message')
def on_send_message(payload):
    sender_id = sid_to_user.get(request.sid)
    if not sender_id:
        return

    receiver_id = payload.get('receiverId')
    message_text = payload.get('message', '').strip()
    if not receiver_id or not message_text:
        return

    if not _is_friend(sender_id, receiver_id):
        return

    safe_message = message_text[:2000]
    message_doc = {
        'sender': ObjectId(sender_id),
        'receiver': ObjectId(receiver_id),
        'message': safe_message,
        'timestamp': datetime.utcnow()
    }

    mongo.db.messages.insert_one(message_doc)

    message_payload = {
        'senderId': sender_id,
        'receiverId': receiver_id,
        'message': safe_message,
        'timestamp': message_doc['timestamp'].isoformat()
    }

    socketio.emit('new_message', message_payload, room=receiver_id)
    socketio.emit('new_message', message_payload, room=sender_id)
