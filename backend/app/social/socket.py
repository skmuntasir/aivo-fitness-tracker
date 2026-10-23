from flask import request
from flask_jwt_extended import decode_token
from flask_socketio import join_room
from bson.objectid import ObjectId
from app import mongo
from app.extensions import socketio
from app.utils import utcnow
from app.social.service import create_message, is_friend
from app.runtime import user_status

# user_id -> set of socket ids (a user can have several tabs/devices)
online_users = {}
sid_to_user = {}


def _get_user_id_from_token(token):
    if not token:
        return None
    try:
        decoded = decode_token(token)
        uid = str(decoded.get('sub') or decoded.get('identity'))
        st = user_status(uid)
        if not st or not st['is_active'] or (st['tv'] is not None and int(decoded.get('tv', 0) or 0) != st['tv']):
            return None   # suspended, deleted or force-logged-out
        return uid
    except Exception:
        return None


def _friend_ids(user_id):
    user = mongo.db.users.find_one({'_id': ObjectId(user_id)}, {'friends': 1})
    return [str(f) for f in (user or {}).get('friends', [])]


def _broadcast_presence(user_id, online):
    event = 'user_online' if online else 'user_offline'
    for fid in _friend_ids(user_id):
        socketio.emit(event, {'userId': user_id}, room=fid)


@socketio.on('connect')
def on_connect(auth):
    token = auth.get('token') if isinstance(auth, dict) else None
    token = token or request.args.get('token')
    user_id = _get_user_id_from_token(token)
    if not user_id:
        return False

    first_connection = user_id not in online_users
    online_users.setdefault(user_id, set()).add(request.sid)
    sid_to_user[request.sid] = user_id
    join_room(user_id)
    if first_connection:
        mongo.db.users.update_one({'_id': ObjectId(user_id)}, {'$set': {'last_active': utcnow()}})
        _broadcast_presence(user_id, True)


@socketio.on('disconnect')
def on_disconnect(*_args):
    sid = request.sid
    user_id = sid_to_user.pop(sid, None)
    if not user_id:
        return
    sids = online_users.get(user_id, set())
    sids.discard(sid)
    # Only mark offline when the user's LAST connection closes. Previously any
    # single disconnect (e.g. React StrictMode remount) marked them offline.
    if not sids:
        online_users.pop(user_id, None)
        mongo.db.users.update_one({'_id': ObjectId(user_id)}, {'$set': {'last_active': utcnow()}})
        _broadcast_presence(user_id, False)


@socketio.on('typing')
def on_typing(payload):
    user_id = sid_to_user.get(request.sid)
    receiver_id = (payload or {}).get('receiverId')
    if not user_id or not receiver_id or not is_friend(user_id, receiver_id):
        return
    socketio.emit('typing', {
        'senderId': user_id, 'receiverId': receiver_id,
        'isTyping': bool(payload.get('isTyping'))
    }, room=receiver_id)


@socketio.on('send_message')
def on_send_message(payload):
    """Returns an ack {ok, message|error} so the sender can swap its optimistic
    bubble for the saved message instead of appending a second copy."""
    sender_id = sid_to_user.get(request.sid)
    if not sender_id:
        return {'ok': False, 'error': 'Not authenticated'}
    payload = payload or {}
    receiver_id = payload.get('receiverId')
    message, error = create_message(sender_id, receiver_id, payload.get('message'), payload.get('clientId'))
    if error:
        return {'ok': False, 'error': error}

    # Deliver to the receiver, and to the sender's OTHER tabs (the sending tab
    # already has the ack, so skip it to avoid a duplicate).
    socketio.emit('new_message', message, room=receiver_id)
    socketio.emit('new_message', message, room=sender_id, skip_sid=request.sid)
    return {'ok': True, 'message': message}


@socketio.on('mark_read')
def on_mark_read(payload):
    user_id = sid_to_user.get(request.sid)
    friend_id = (payload or {}).get('friendId')
    if not user_id or not friend_id:
        return
    try:
        mongo.db.messages.update_many(
            {'sender': ObjectId(friend_id), 'receiver': ObjectId(user_id), 'read': False},
            {'$set': {'read': True}})
        socketio.emit('messages_read', {'by': user_id}, room=friend_id)
    except Exception:
        pass
