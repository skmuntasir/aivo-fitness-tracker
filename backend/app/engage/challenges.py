"""Friend challenges: "Most minutes this week" between two friends.

Lifecycle: pending (waiting for the friend) -> active (accepted) -> finished (the week ended).
A pending challenge nobody accepted before the week ended becomes `expired`.
Everyone is measured over the SAME window (Monday 00:00 -> next Monday 00:00 in the creator's
timezone), so the race is fair even when the challenge is created or accepted mid-week.
Progress is never stored while the week runs - it is summed live from the `workouts` collection.
"""
import uuid
from datetime import timedelta
from bson.objectid import ObjectId

from app.extensions import mongo
from app.utils import utcnow, iso_utc, local_today, local_midnight_utc


def week_window(tz_name):
    """(monday_local_date, start_utc, end_utc) of the current local week."""
    today = local_today(tz_name)
    monday = today - timedelta(days=today.weekday())
    return monday, local_midnight_utc(monday, tz_name), local_midnight_utc(monday + timedelta(days=7), tz_name)


def seconds_between(user_ids, start, end):
    """{user_id: seconds trained in [start, end)} - one aggregation for any number of users."""
    out = {u: 0 for u in user_ids}
    if not user_ids:
        return out
    rows = mongo.db.workouts.aggregate([
        {'$match': {'user_id': {'$in': list(user_ids)}, 'start_time': {'$gte': start, '$lt': end}}},
        {'$group': {'_id': '$user_id', 'secs': {'$sum': '$duration'}}}])
    for r in rows:
        out[r['_id']] = int(r.get('secs') or 0)
    return out


def _winner_of(a_id, b_id, totals):
    a, b = totals.get(a_id, 0), totals.get(b_id, 0)
    if a == b:
        return 'tie'
    return a_id if a > b else b_id


def settle_due(user_id):
    """Close this user's challenges whose week is over (idempotent, cheap)."""
    uid = str(user_id)
    now = utcnow()
    due = mongo.db.challenges.find({
        '$or': [{'challenger': uid}, {'opponent': uid}],
        'status': {'$in': ['pending', 'active']}, 'week_end': {'$lte': now}})
    for c in due:
        if c['status'] == 'pending':
            mongo.db.challenges.update_one({'_id': c['_id'], 'status': 'pending'}, {'$set': {'status': 'expired'}})
            continue
        totals = seconds_between([c['challenger'], c['opponent']], c['week_start'], c['week_end'])
        mongo.db.challenges.update_one(
            {'_id': c['_id'], 'status': 'active'},
            {'$set': {'status': 'finished', 'winner': _winner_of(c['challenger'], c['opponent'], totals),
                      'final': totals, 'finished_at': now}})


def wins_for(user_id):
    return mongo.db.challenges.count_documents({'status': 'finished', 'winner': str(user_id)})


def create(me_id, friend_id, tz_name):
    """Returns (challenge_doc | None, error_message | None, http_status)."""
    me_id, friend_id = str(me_id), str(friend_id)
    if me_id == friend_id:
        return None, "You can't challenge yourself.", 400
    try:
        me_doc = mongo.db.users.find_one({'_id': ObjectId(me_id)}, {'friends': 1})
        friend_oid = ObjectId(friend_id)
    except Exception:
        return None, 'Invalid user.', 400
    if not me_doc or friend_oid not in (me_doc.get('friends') or []):
        return None, 'You can only challenge your friends.', 403
    friend = mongo.db.users.find_one({'_id': friend_oid, 'is_active': {'$ne': False}}, {'_id': 1})
    if not friend:
        return None, 'That user is not available.', 404

    monday, start, end = week_window(tz_name)
    clash = mongo.db.challenges.find_one({
        'status': {'$in': ['pending', 'active']}, 'week_start': start,
        '$or': [{'challenger': me_id, 'opponent': friend_id}, {'challenger': friend_id, 'opponent': me_id}]})
    if clash:
        return None, ('You already have a challenge with this friend this week.' if clash['status'] == 'active'
                      else 'A challenge with this friend is already waiting for a reply.'), 409
    doc = {'_id': str(uuid.uuid4()), 'challenger': me_id, 'opponent': friend_id, 'status': 'pending',
           'metric': 'minutes', 'week_start': start, 'week_end': end, 'week_label': monday.isoformat(),
           'tz': tz_name, 'created_at': utcnow()}
    mongo.db.challenges.insert_one(doc)
    return doc, None, 201


def serialize_for(me_id, docs):
    """Challenges as the member app needs them, with LIVE minutes for running ones."""
    me_id = str(me_id)
    if not docs:
        return []
    now = utcnow()
    ids = {me_id}
    for c in docs:
        ids.update([c['challenger'], c['opponent']])
    names = {}
    try:
        for u in mongo.db.users.find({'_id': {'$in': [ObjectId(i) for i in ids]}}, {'full_name': 1}):
            names[str(u['_id'])] = u.get('full_name') or 'Member'
    except Exception:
        pass

    out = []
    for c in docs:
        other = c['opponent'] if c['challenger'] == me_id else c['challenger']
        if c['status'] == 'finished' and c.get('final'):
            totals = c['final']
        elif c['status'] in ('active', 'pending'):
            totals = seconds_between([me_id, other], c['week_start'], min(c['week_end'], now + timedelta(seconds=1)))
        else:
            totals = {}
        mine, theirs = int(totals.get(me_id, 0)), int(totals.get(other, 0))
        total = mine + theirs
        leader = 'tie' if mine == theirs else ('me' if mine > theirs else 'friend')
        winner = None
        if c['status'] == 'finished':
            w = c.get('winner')
            winner = 'tie' if w == 'tie' else ('me' if w == me_id else 'friend')
        out.append({
            'id': c['_id'], 'status': c['status'],
            'role': 'challenger' if c['challenger'] == me_id else 'opponent',
            'week_label': c.get('week_label'), 'week_end': iso_utc(c['week_end']),
            'seconds_left': max(0, int((c['week_end'] - now).total_seconds())),
            'me': {'id': me_id, 'name': names.get(me_id, 'You'), 'seconds': mine},
            'friend': {'id': other, 'name': names.get(other, 'Friend'), 'seconds': theirs},
            'my_share': round(mine * 100 / total) if total else 50,
            'leader': leader, 'winner': winner})
    return out


def list_for(me_id):
    me_id = str(me_id)
    settle_due(me_id)
    since = utcnow() - timedelta(days=28)
    base = {'$or': [{'challenger': me_id}, {'opponent': me_id}]}
    live = list(mongo.db.challenges.find({**base, 'status': {'$in': ['pending', 'active']}}).sort('created_at', -1).limit(20))
    done = list(mongo.db.challenges.find({**base, 'status': 'finished', 'week_end': {'$gte': since}})
                .sort('week_end', -1).limit(6))
    live.sort(key=lambda c: 0 if c['status'] == 'active' else 1)
    return serialize_for(me_id, live + done)
