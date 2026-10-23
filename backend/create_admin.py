"""Create or promote an admin from the command line.

    python create_admin.py you@example.com                      # promote an existing user
    python create_admin.py new@example.com --name "New Admin" --password "Str0ngPass1"   # create one
"""
import argparse
import os
import sys

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

from werkzeug.security import generate_password_hash  # noqa: E402
from app import create_app  # noqa: E402
from app.extensions import mongo  # noqa: E402
from app.auth.routes import validate_password, _generate_username  # noqa: E402
from app.utils import utcnow  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('email')
ap.add_argument('--name', default='Administrator')
ap.add_argument('--password')
args = ap.parse_args()

app = create_app()
with app.app_context():
    email = args.email.strip().lower()
    user = mongo.db.users.find_one({'email': email})
    if user:
        mongo.db.users.update_one({'_id': user['_id']}, {'$set': {'is_admin': True, 'is_active': True}})
        print(f'Promoted existing user {email} to admin.')
    else:
        if not args.password:
            sys.exit('User does not exist: pass --password (and optionally --name) to create it.')
        ok, msg = validate_password(args.password)
        if not ok:
            sys.exit(msg)
        mongo.db.users.insert_one({
            'email': email, 'password': generate_password_hash(args.password), 'full_name': args.name,
            'username': _generate_username(args.name), 'friends': [], 'points': 0, 'is_admin': True,
            'is_active': True, 'created_at': utcnow(), 'last_active': None, 'profile_complete': False})
        print(f'Created admin {email}.')
