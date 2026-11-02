from flask_pymongo import PyMongo
from flask_jwt_extended import JWTManager
from flask_socketio import SocketIO


class ScopedMongo(PyMongo):
    """PyMongo whose ``.db`` is the real database for normal requests and the isolated ``demo_`` view of it
    for demo-sandbox requests (see app/demo.py). Every route keeps using ``mongo.db.<collection>`` unchanged."""

    @property
    def real_db(self):
        return self.__dict__.get('_real_db')

    @property
    def db(self):
        real = self.__dict__.get('_real_db')
        if real is None:
            return None
        from .demo import is_demo, DemoDB
        return DemoDB(real) if is_demo() else real

    @db.setter
    def db(self, value):       # PyMongo.init_app (and the test-suite's fake init) assign `self.db = ...`
        self.__dict__['_real_db'] = value


mongo = ScopedMongo()
jwt = JWTManager()
# threading mode + simple-websocket => real WebSocket transport (no long-polling fallback)
socketio = SocketIO(async_mode='threading')
