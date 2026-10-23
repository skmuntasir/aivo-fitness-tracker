"""Admin portal API (`/api/admin/*`) + the small public endpoints it feeds."""
from flask import Blueprint

admin_bp = Blueprint('admin', __name__, url_prefix='/api/admin')

# Route modules register themselves on `admin_bp` at import time (order matters: content uses users' helpers).
from . import core, users, content  # noqa: E402,F401
from .public import public_bp       # noqa: E402,F401
