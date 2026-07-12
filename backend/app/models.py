from datetime import datetime
from your_app import db  # adjust import as per your project

class Workout(db.Model):
    __tablename__ = 'workouts'
    id = db.Column(db.String, primary_key=True)
    user_id = db.Column(db.String, db.ForeignKey('user.id'), nullable=False)
    start_time = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    end_time = db.Column(db.DateTime, nullable=False)
    duration = db.Column(db.Integer, nullable=False)  # seconds
    activity_type = db.Column(db.String(32), nullable=True)

    def __init__(self, id, user_id, start_time, end_time, duration, activity_type=None):
        self.id = id
        self.user_id = user_id
        self.start_time = start_time
        self.end_time = end_time
        self.duration = duration
        self.activity_type = activity_type
