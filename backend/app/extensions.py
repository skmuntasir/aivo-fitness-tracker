from flask_pymongo import PyMongo
from flask_jwt_extended import JWTManager
from flask_socketio import SocketIO

mongo = PyMongo()
jwt = JWTManager()
# threading mode + simple-websocket => real WebSocket transport (no long-polling fallback)
socketio = SocketIO(async_mode='threading')
