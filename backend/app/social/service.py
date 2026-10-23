"""Shared chat logic used by BOTH the REST endpoint and the Socket.IO handler,
so a message is always created, serialised and broadcast the same way."""
import html
from bson.objectid import ObjectId
from app import mongo
from app.utils import utcnow, iso_utc

MAX_MESSAGE_LEN = 2000


def clean_text(value, max_len=MAX_MESSAGE_LEN):
    # NOTE: no html.escape here. React already escapes on render; escaping on
    # write caused literal "&#x27;" / "&lt;" to show up in messages and posts.
    text = ''.join(ch for ch in str(value or '') if ch == '\n' or ch >= ' ').strip()
    return text[:max_len]


def unescape_legacy(value):
    """Older rows were stored HTML-escaped; undo that when reading."""
    return html.unescape(value) if value else ''


def is_friend(user_id, friend_id):
    try:
        return bool(mongo.db.users.count_documents(
            {'_id': ObjectId(user_id), 'friends': ObjectId(friend_id)}, limit=1))
    except Exception:
        return False


def serialize_message(doc, client_id=None):
    sender, receiver = str(doc['sender']), str(doc['receiver'])
    payload = {
        'id': str(doc['_id']),
        'sender': sender,
        'receiver': receiver,
        'senderId': sender,      # kept for backward compatibility
        'receiverId': receiver,  # kept for backward compatibility
        'message': unescape_legacy(doc.get('message', '')),
        'timestamp': iso_utc(doc['timestamp']),
        'read': bool(doc.get('read', False)),
    }
    if client_id:
        payload['clientId'] = str(client_id)[:64]
    return payload


def create_message(sender_id, receiver_id, text, client_id=None):
    """Validate + insert. Returns (payload, error)."""
    text = clean_text(text)
    if not text:
        return None, 'Message is empty'
    try:
        sender_obj, receiver_obj = ObjectId(sender_id), ObjectId(receiver_id)
    except Exception:
        return None, 'Invalid user ID'
    if not is_friend(sender_id, receiver_id):
        return None, 'Can only message friends'
    doc = {'sender': sender_obj, 'receiver': receiver_obj, 'message': text,
           'timestamp': utcnow(), 'read': False}
    doc['_id'] = mongo.db.messages.insert_one(doc).inserted_id
    return serialize_message(doc, client_id), None
