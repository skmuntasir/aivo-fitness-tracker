from flask_pymongo import PyMongo
from flask_jwt_extended import JWTManager
from flask_socketio import SocketIO

mongo = PyMongo()
jwt = JWTManager()
socketio = SocketIO(cors_allowed_origins='*', async_mode='threading')
