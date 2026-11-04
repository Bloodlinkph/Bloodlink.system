import os
import sys
import secrets
from functools import wraps
from getpass import getpass
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature
import mariadb
import smtplib
import time
from email.message import EmailMessage
import re
import math
from datetime import datetime, date, timedelta
from decimal import Decimal, InvalidOperation


# =====================================================================
# .env FILE: settings are read from a file named ".env" next to this script.
#   Lines look like  NAME=value  ("#" starts a comment, quotes are optional).
#   Settings already set in the real environment win over the file.
#   Keep .env private: never commit it to git (see .env.example).
# =====================================================================
def load_env_file(path=None):
    path = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            name, _, value = line.partition("=")
            name, value = name.strip(), value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            os.environ.setdefault(name, value)


load_env_file()


# =====================================================================
# DATABASE CONNECTION  (points to the BloodLink schema created earlier)
# =====================================================================
def db_connect():
    # defaults match the old setup; override with environment variables in production
    return mariadb.connect(
        host=os.environ.get("BLOODLINK_DB_HOST", "localhost"),
        user=os.environ.get("BLOODLINK_DB_USER", "root"),
        password=os.environ.get("BLOODLINK_DB_PASSWORD", ""),
        database=os.environ.get("BLOODLINK_DB_NAME", "bloodlink_db")
    )


app = Flask(__name__)
# only your frontend may call the API (comma-separated list in BLOODLINK_ORIGINS)
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get(
        "BLOODLINK_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",") if o.strip()
]
CORS(app, origins=ALLOWED_ORIGINS)


# =====================================================================
# VALIDATION REGEX PATTERNS (matched to BloodLink fields)
# =====================================================================
name_regex = re.compile(r"^[A-Za-zÑñ\s-]+$")

email_regex = re.compile(
    r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
)

# Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX
contact_regex = re.compile(r"^(09\d{9}|\+639\d{9})$")

# At least 8 characters, containing at least one letter and one number
password_regex = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{8,}$")

address_regex = re.compile(r"^[A-Za-z0-9ÑñÁáÉéÍíÓóÚú.,#\-\s]+$")

blood_type_regex = re.compile(r"^(A|B|AB|O)[+-]$")

# CHANGED: donor + requester are now one "member" role
role_regex = re.compile(r"^(member|blood_bank|admin)$")

# roles that may have donor/requester profiles (old values kept as a safety net)
MEMBER_ROLES = ("member", "donor", "requester")

decimal_coord_regex = re.compile(r"^-?\d{1,3}(\.\d+)?$")

# =====================================================================
# BLOOD UNITS: ONE DEFINITION FOR THE WHOLE SYSTEM
#   1 unit = 1 bag = 450 mL of whole blood
#   Allowed values are multiples of 0.5 (0.5 = 225 mL, 1, 1.5, 2 ...)
#   Requests, inventory and donations all use this same unit.
#   Stored as DECIMAL(6,1) in the database, never as an integer.
# =====================================================================
UNIT_ML = 450
UNIT_STEP = Decimal("0.5")
MAX_UNITS = Decimal("9999")


def parse_units(value, allow_zero=False):
    """Returns a Decimal if `value` is a valid number of units, otherwise None.
       Valid = a multiple of 0.5, not negative, not zero (unless allow_zero)."""
    try:
        d = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None
    if not d.is_finite() or d < 0 or d > MAX_UNITS:
        return None
    if d == 0 and not allow_zero:
        return None
    if d % UNIT_STEP != 0:
        return None
    return d


def fmt_units(d):
    """Decimal/float -> '1', '1.5', '0.5' (no trailing .0)."""
    text = f"{Decimal(str(d)):f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def unit_label(d):
    """'1 unit', '0.5 units', '1.5 units'"""
    text = fmt_units(d)
    return f"{text} unit" if text == "1" else f"{text} units"


UNIT_RULE_MSG = "must be in half-unit steps (0.5, 1, 1.5, ...). 1 unit = 1 bag = 450 mL."

urgency_regex = re.compile(r"^(low|medium|high|critical)$")

date_regex = re.compile(r"^\d{4}-\d{2}-\d{2}(\s\d{2}:\d{2}(:\d{2})?)?$")

requester_type_regex = re.compile(r"^(individual|hospital|family_member)$")


# =====================================================================
# BLOOD TYPE COMPATIBILITY MAP  (donor_type -> list of types donor can give to)
# =====================================================================
COMPATIBILITY = {
    "O-":  ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"],
    "O+":  ["O+", "A+", "B+", "AB+"],
    "A-":  ["A-", "A+", "AB-", "AB+"],
    "A+":  ["A+", "AB+"],
    "B-":  ["B-", "B+", "AB-", "AB+"],
    "B+":  ["B+", "AB+"],
    "AB-": ["AB-", "AB+"],
    "AB+": ["AB+"],
}


def haversine_km(lat1, lon1, lat2, lon2):
    if None in (lat1, lon1, lat2, lon2):
        return None
    r = 6371  # earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    c = 2 * math.asin(math.sqrt(a))
    return round(r * c, 2)


def get_blood_type_id(curr, blood_type):
    curr.execute("SELECT blood_type_id FROM BloodTypes WHERE blood_type = ?", (blood_type,))
    row = curr.fetchone()
    return row[0] if row else None


def send_notification(curr, user_id, message, notif_type="in_app", related_request_id=None):
    """Inserts a notification row using the caller's existing cursor.
       The caller is responsible for committing the transaction."""
    if not user_id:
        return
    curr.execute("""
        INSERT INTO Notifications (user_id, related_request_id, message, type)
        VALUES (?, ?, ?, ?)
    """, (user_id, related_request_id, message, notif_type))


ROLE_LABELS = {"member": "Member", "blood_bank": "Blood bank", "admin": "Admin"}

# admins are told about every login; the same login is only announced once per
# this many minutes, so refreshing or re-logging in doesn't flood the bell
LOGIN_NOTIFY_DEDUPE_MIN = 30


def notify_admins(curr, message, exclude_user_id=None, dedupe_minutes=0):
    """Sends an in-app notification to every ACTIVE admin (except `exclude_user_id`).
       Uses the caller's cursor; the caller commits."""
    curr.execute("SELECT user_id FROM Users WHERE role = 'admin' AND account_status = 'active'")
    admin_ids = [r[0] for r in curr.fetchall()]

    for admin_id in admin_ids:
        if exclude_user_id is not None and admin_id == exclude_user_id:
            continue
        if dedupe_minutes:
            curr.execute(f"""
                SELECT 1 FROM Notifications
                WHERE user_id = ? AND message = ?
                  AND date_sent > DATE_SUB(NOW(), INTERVAL {int(dedupe_minutes)} MINUTE)
                LIMIT 1
            """, (admin_id, message))
            if curr.fetchone():
                continue
        send_notification(curr, admin_id, message, "in_app")


# =====================================================================
# PHASE 3: SETTINGS AND HELPERS
# =====================================================================
# Whole blood: a healthy donor may give again after 3 months (PRC / DOH guidance).
# Change this ONE number if your blood banks use a different interval.
DONATION_INTERVAL_DAYS = 90

# SQL twin of in_rest_period(). Use it in queries where Donors is aliased as d.
REST_OK_SQL = (f"(d.last_donation_date IS NULL OR "
               f"d.last_donation_date <= DATE_SUB(CURDATE(), INTERVAL {DONATION_INTERVAL_DAYS} DAY))")


def next_eligible_on(last_donation):
    """Date the donor may give again, or None if there is no donation on record."""
    d = to_date(last_donation)
    return d + timedelta(days=DONATION_INTERVAL_DAYS) if d else None


def in_rest_period(last_donation, on=None):
    nxt = next_eligible_on(last_donation)
    return nxt is not None and (on or date.today()) < nxt


def effective_eligibility(stored_status, last_donation):
    """stored_status is the manual/medical status; the rest period is added on top of it."""
    if stored_status == "ineligible":
        return "ineligible"
    if stored_status != "eligible" or in_rest_period(last_donation):
        return "temporarily_deferred"
    return "eligible"


# Critical urgency can only be CONFIRMED by a verified blood bank or an admin.
CRITICAL_MIN_REASON = 10       # characters the requester must write
MAX_PENDING_CRITICAL = 2       # emergency flags waiting for review, per requester
MAX_REJECTED_CRITICAL = 3      # rejected flags within CRITICAL_LOCK_DAYS before flags are paused
CRITICAL_LOCK_DAYS = 90


def notify_critical_reviewers(curr, message, request_id):
    """Tells every active admin and every verified blood bank. Caller commits."""
    curr.execute("""
        SELECT u.user_id FROM Users u
        WHERE u.account_status = 'active'
          AND (u.role = 'admin'
               OR u.user_id IN (SELECT user_id FROM BloodBanks WHERE verified_status = 'verified'))
    """)
    for (uid,) in curr.fetchall():
        send_notification(curr, uid, message[:250], "in_app", request_id)


def sync_request_status(curr, request_id):
    """pending <-> matched follows the donor matches (matched while a donor has accepted or confirmed).
       fulfilled / cancelled requests are never touched. Caller commits."""
    curr.execute("SELECT status FROM BloodRequests WHERE request_id = ? FOR UPDATE", (request_id,))
    row = curr.fetchone()
    if row is None or row[0] not in ("pending", "matched"):
        return
    curr.execute("""
        SELECT COUNT(*) FROM Matches
        WHERE request_id = ? AND match_status IN ('accepted', 'confirmed')
    """, (request_id,))
    wanted = "matched" if curr.fetchone()[0] else "pending"
    if wanted != row[0]:
        curr.execute("UPDATE BloodRequests SET status = ? WHERE request_id = ?", (wanted, request_id))


# =====================================================================
# VALIDATION FUNCTIONS
# =====================================================================
def validate_user_common(params, require_password=True):

    full_name = str(params.get("full_name", "")).strip()
    if not full_name:
        return "Full Name is required."
    if not name_regex.fullmatch(full_name):
        return "Full Name can contain letters, spaces, and dash only."

    email = str(params.get("email", "")).strip()
    if not email:
        return "Email is required."
    if not email_regex.fullmatch(email):
        return "Please enter a valid email address."

    if require_password:
        password = str(params.get("password", "")).strip()
        if not password:
            return "Password is required."
        if not password_regex.fullmatch(password):
            return "Password must be at least 8 characters and include a letter and a number."

    contact_number = str(params.get("contact_number", "")).strip()
    if not contact_number:
        return "Contact Number is required."
    if not contact_regex.fullmatch(contact_number):
        return "Contact Number must be a valid PH mobile number (e.g. 09171234567)."

    address = params.get("address")
    if address is not None and str(address).strip() != "":
        if not address_regex.fullmatch(str(address).strip()):
            return "Address contains invalid characters."

    barangay = params.get("barangay")
    if barangay is not None and str(barangay).strip() != "":
        if not name_regex.fullmatch(str(barangay).strip()):
            return "Barangay can contain letters, spaces, and dash only."

    city = params.get("city")
    if city is not None and str(city).strip() != "":
        if not name_regex.fullmatch(str(city).strip()):
            return "City can contain letters, spaces, and dash only."

    role = str(params.get("role", "")).strip()
    if not role:
        return "Role is required."
    if not role_regex.fullmatch(role):
        return "Role must be one of: member, blood_bank, admin."

    return None


def validate_coordinates(params):
    lat = params.get("latitude")
    lon = params.get("longitude")

    if lat is not None and str(lat).strip() != "":
        if not decimal_coord_regex.fullmatch(str(lat).strip()):
            return "Latitude must be a valid decimal number."
        if not (-90 <= float(lat) <= 90):
            return "Latitude must be between -90 and 90."

    if lon is not None and str(lon).strip() != "":
        if not decimal_coord_regex.fullmatch(str(lon).strip()):
            return "Longitude must be a valid decimal number."
        if not (-180 <= float(lon) <= 180):
            return "Longitude must be between -180 and 180."

    return None


def validate_donor_extra(params):
    blood_type = str(params.get("blood_type", "")).strip().upper()
    if not blood_type:
        return "Blood Type is required."
    if not blood_type_regex.fullmatch(blood_type):
        return "Blood Type must be one of A+, A-, B+, B-, O+, O-, AB+, AB-."

    err = validate_coordinates(params)
    if err:
        return err

    availability = params.get("availability_status", "available")
    if availability not in ("available", "unavailable"):
        return "Availability Status must be 'available' or 'unavailable'."

    last_donation_date = params.get("last_donation_date")
    if last_donation_date:
        if not date_regex.fullmatch(str(last_donation_date).strip()):
            return "Last Donation Date must use YYYY-MM-DD format."
        try:
            datetime.strptime(str(last_donation_date).strip()[:10], "%Y-%m-%d")
        except ValueError:
            return "Last Donation Date is not a valid date."

    return None


def validate_requester_extra(params):
    requester_type = str(params.get("requester_type", "individual")).strip()
    if not requester_type_regex.fullmatch(requester_type):
        return "Requester Type must be individual, hospital, or family_member."

    hospital = params.get("affiliated_hospital")
    if hospital is not None and str(hospital).strip() != "":
        if not name_regex.fullmatch(str(hospital).strip()):
            return "Affiliated Hospital can contain letters, spaces, and dash only."

    return None


def validate_bloodbank_extra(params):
    bank_name = str(params.get("bank_name", "")).strip()
    if not bank_name:
        return "Blood Bank Name is required."
    if not re.fullmatch(r"^[A-Za-z0-9Ññ.\s-]+$", bank_name):
        return "Blood Bank Name contains invalid characters."

    license_number = params.get("license_number")
    if license_number is not None and str(license_number).strip() != "":
        if not re.fullmatch(r"^[A-Za-z0-9-]+$", str(license_number).strip()):
            return "License Number must contain letters, numbers, and dash only."

    return None


def validate_blood_request(params):
    blood_type = str(params.get("blood_type", "")).strip().upper()
    if not blood_type:
        return "Blood Type is required."
    if not blood_type_regex.fullmatch(blood_type):
        return "Blood Type must be one of A+, A-, B+, B-, O+, O-, AB+, AB-."

    quantity = str(params.get("quantity_needed", "")).strip()
    if not quantity:
        return "Units needed is required."
    if parse_units(quantity) is None:
        return "Units needed " + UNIT_RULE_MSG

    urgency = str(params.get("urgency_level", "medium")).strip()
    if not urgency_regex.fullmatch(urgency):
        return "Urgency Level must be low, medium, high, or critical."

    location = params.get("location_needed")
    if location is not None and str(location).strip() != "":
        if not address_regex.fullmatch(str(location).strip()):
            return "Location Needed contains invalid characters."

    err = validate_coordinates(params)
    if err:
        return err

    date_needed_by = params.get("date_needed_by")
    if date_needed_by:
        if not date_regex.fullmatch(str(date_needed_by).strip()):
            return "Date Needed By must use YYYY-MM-DD (optionally HH:MM:SS) format."

    return None


def validate_donation(params):
    units = params.get("units", 1)
    if parse_units(units) is None:
        return "Units donated " + UNIT_RULE_MSG

    status = str(params.get("status", "completed")).strip()
    if status not in ("completed", "deferred", "cancelled"):
        return "Donation Status must be completed, deferred, or cancelled."

    return None


# =====================================================================
# AUTH: REGISTER
# =====================================================================
# =====================================================================
# AUTH: signed tokens + role / ownership checks
#   - /login hands out a signed token; the frontend sends it as
#     "Authorization: Bearer <token>" on every request.
#   - The user comes from the TOKEN, never from ids in the request body.
#   - The account is re-checked in the database on every call, so a
#     disabled account stops working immediately.
# =====================================================================
SECRET_KEY = os.environ.get("BLOODLINK_SECRET")
if not SECRET_KEY:
    SECRET_KEY = secrets.token_hex(32)
    print("[auth] BLOODLINK_SECRET is not set: using a temporary key. "
          "Everyone is logged out whenever the server restarts.")
TOKEN_HOURS = 8
_serializer = URLSafeTimedSerializer(SECRET_KEY, salt="bloodlink-auth")


def make_token(user_id):
    return _serializer.dumps({"uid": int(user_id)})


def _log_db_error(e):
    """Keep database details in the server log, not in the API response."""
    app.logger.error("Database error: %s", e)
    return None


def _one(sql, args=()):
    conn = db_connect()
    try:
        curr = conn.cursor()
        curr.execute(sql, args)
        row = curr.fetchone()
        curr.close()
        return row
    finally:
        conn.close()


def _body():
    return request.get_json(silent=True) or {}


def _current_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    try:
        data = _serializer.loads(header[7:].strip(), max_age=TOKEN_HOURS * 3600)
        uid = int(data["uid"])
    except (BadSignature, KeyError, ValueError, TypeError):
        return None
    row = _one("SELECT role, account_status FROM Users WHERE user_id = ?", (uid,))
    if row is None or row[1] != "active":
        return None
    role = "member" if row[0] in MEMBER_ROLES else row[0]
    return {"uid": uid, "role": role}


def require_auth(*roles, allow=None):
    """@require_auth()                      any logged-in user
       @require_auth("admin")              only these roles
       @require_auth(allow=fn)             fn(user, route_kwargs) must return True"""
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                user = _current_user()
                if user is None:
                    return jsonify({"message": "Please log in again."}), 401
                if roles and user["role"] not in roles:
                    return jsonify({"message": "You do not have access to this."}), 403
                if allow is not None and not allow(user, kwargs):
                    return jsonify({"message": "You are not allowed to do that."}), 403
            except mariadb.Error as e:
                return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
            g.user = user
            return fn(*args, **kwargs)
        return wrapper
    return decorator


# ---------- ownership helpers ----------
def _admin(u):
    return u["role"] == "admin"


def _same(u, value):
    return value is not None and str(u["uid"]) == str(value)


def _owns_bank(u, bank_id):
    if _admin(u):
        return True
    if not bank_id:
        return False
    return _one("SELECT 1 FROM BloodBanks WHERE blood_bank_id = ? AND user_id = ?",
                (bank_id, u["uid"])) is not None


def _owns_donor(u, donor_id):
    if _admin(u):
        return True
    if not donor_id:
        return False
    return _one("SELECT 1 FROM Donors WHERE donor_id = ? AND user_id = ?",
                (donor_id, u["uid"])) is not None


def _owns_requester(u, requester_id):
    if _admin(u):
        return True
    if not requester_id:
        return False
    return _one("SELECT 1 FROM Requesters WHERE requester_id = ? AND user_id = ?",
                (requester_id, u["uid"])) is not None


def _owns_request(u, request_id):
    if _admin(u):
        return True
    if not request_id:
        return False
    return _one("""
        SELECT 1 FROM BloodRequests r
        JOIN Requesters q ON r.requester_id = q.requester_id
        WHERE r.request_id = ? AND q.user_id = ?
    """, (request_id, u["uid"])) is not None


# ---------- rules used by the route decorators ----------
def ALLOW_SELF(u, kw):
    return _same(u, kw.get("user_id"))


def ALLOW_SELF_OR_ADMIN(u, kw):
    return _admin(u) or _same(u, kw.get("user_id"))


def ALLOW_DONOR_SETUP(u, kw):
    return _same(u, _body().get("user_id"))


def ALLOW_DONOR(u, kw):
    return _owns_donor(u, kw["donor_id"])


def ALLOW_NEW_REQUEST(u, kw):
    return _owns_requester(u, _body().get("requester_id"))


def ALLOW_REQUEST(u, kw):
    return _owns_request(u, kw["request_id"])


def ALLOW_REQUEST_LIST(u, kw):
    return u["role"] in ("admin", "blood_bank") or _owns_requester(u, request.args.get("requester_id"))


def ALLOW_REQUEST_STATUS(u, kw):
    if u["role"] in ("admin", "blood_bank"):
        return True
    # the person who posted a request may only cancel it (fulfilled / matched are set by staff)
    status = str(_body().get("status", "")).strip()
    return status == "cancelled" and _owns_request(u, kw["request_id"])


def ALLOW_MATCH_LIST(u, kw):
    if _admin(u):
        return True
    donor_id = request.args.get("donor_id")
    request_id = request.args.get("request_id")
    return bool((donor_id and _owns_donor(u, donor_id)) or (request_id and _owns_request(u, request_id)))


def ALLOW_MATCH_NEW(u, kw):
    return _owns_request(u, _body().get("request_id"))


def ALLOW_MATCH_UPDATE(u, kw):
    if _admin(u):
        return True
    row = _one("""
        SELECT d.user_id, q.user_id
        FROM Matches m
        JOIN Donors d ON m.donor_id = d.donor_id
        JOIN BloodRequests br ON m.request_id = br.request_id
        JOIN Requesters q ON br.requester_id = q.requester_id
        WHERE m.match_id = ?
    """, (kw["match_id"],))
    if row is None:
        return True  # let the route answer 404
    status = str(_body().get("match_status", "")).strip()
    if str(row[0]) == str(u["uid"]):      # the donor answers the match
        return status in ("accepted", "declined")
    if str(row[1]) == str(u["uid"]):      # the requester confirms or closes it
        return status in ("confirmed", "expired")
    return False


def ALLOW_BANK(u, kw):
    return _owns_bank(u, kw["blood_bank_id"])


def ALLOW_INVENTORY_WRITE(u, kw):
    return _owns_bank(u, kw["blood_bank_id"]) and _same(u, _body().get("changed_by"))


def ALLOW_BANK_IN_BODY(u, kw):
    return _owns_bank(u, _body().get("blood_bank_id"))


def ALLOW_SCOPED_LIST(u, kw):
    """donations / appointments lists: admin, or a bank/donor asking about itself"""
    if _admin(u):
        return True
    bank_id = request.args.get("blood_bank_id")
    donor_id = request.args.get("donor_id")
    return bool((bank_id and _owns_bank(u, bank_id)) or (donor_id and _owns_donor(u, donor_id)))


def ALLOW_NOTIFICATION_READ(u, kw):
    return _one("SELECT 1 FROM Notifications WHERE notification_id = ? AND user_id = ?",
                (kw["notification_id"], u["uid"])) is not None


def ALLOW_APPOINTMENT_UPDATE(u, kw):
    if _admin(u):
        return True
    row = _one("""
        SELECT bb.user_id, d.user_id
        FROM Appointments a
        JOIN BloodBanks bb ON a.blood_bank_id = bb.blood_bank_id
        JOIN Donors d ON a.donor_id = d.donor_id
        WHERE a.appointment_id = ?
    """, (kw["appointment_id"],))
    if row is None:
        return True  # let the route answer 404
    if str(row[0]) == str(u["uid"]):      # the bank manages its appointments
        return True
    if str(row[1]) == str(u["uid"]):      # a donor may only cancel their own
        return str(_body().get("status", "")).strip() == "cancelled"
    return False


@app.route("/register", methods=["POST"])
def register():

    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        error = validate_user_common(params, require_password=True)
        if error:
            return jsonify({"message": error}), 400

        role = params["role"].strip()

        # admins are never created from the public form (use: python bloodlink_1.py create-admin)
        if role == "admin":
            return jsonify({"message": "Admin accounts cannot be created from the sign-up form."}), 403

        # Role-specific validation before touching the database
        if role == "member":
            error = validate_donor_extra(params) or validate_requester_extra(params)
        elif role == "blood_bank":
            error = validate_bloodbank_extra(params)
        elif role == "admin":
            error = None
        else:
            error = "Invalid role."

        if error:
            return jsonify({"message": error}), 400

        conn = db_connect()
        curr = conn.cursor()

        password_hash = generate_password_hash(params["password"].strip())

        curr.execute("""
            INSERT INTO Users (
                full_name, email, password_hash, contact_number,
                address, barangay, city, role, account_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
        """, (
            params["full_name"].strip(),
            params["email"].strip(),
            password_hash,
            params["contact_number"].strip(),
            params.get("address"),
            params.get("barangay"),
            params.get("city"),
            role
        ))

        user_id = curr.lastrowid

        if role == "member":
            # one account = a donor profile AND a requester profile
            blood_type = params["blood_type"].strip().upper()
            blood_type_id = get_blood_type_id(curr, blood_type)
            if blood_type_id is None:
                conn.rollback()
                curr.close()
                conn.close()
                return jsonify({"message": "Unknown Blood Type."}), 400

            curr.execute("""
                INSERT INTO Donors (
                    user_id, blood_type_id, latitude, longitude,
                    availability_status, last_donation_date
                )
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                user_id,
                blood_type_id,
                params.get("latitude"),
                params.get("longitude"),
                params.get("availability_status", "available"),
                params.get("last_donation_date")
            ))

            curr.execute("""
                INSERT INTO Requesters (user_id, requester_type, affiliated_hospital)
                VALUES (?, ?, ?)
            """, (
                user_id,
                params.get("requester_type", "individual"),
                params.get("affiliated_hospital")
            ))

        elif role == "blood_bank":
            curr.execute("""
                INSERT INTO BloodBanks (user_id, bank_name, license_number, operating_hours)
                VALUES (?, ?, ?, ?)
            """, (
                user_id,
                params["bank_name"].strip(),
                params.get("license_number"),
                params.get("operating_hours")
            ))

        elif role == "admin":
            curr.execute("""
                INSERT INTO Admins (user_id, permission_level)
                VALUES (?, ?)
            """, (
                user_id,
                params.get("permission_level", "staff")
            ))

        # tell the admins a new account was created (accounts are active right away;
        # only blood banks still need verification, which gates inventory/donations)
        name = params["full_name"].strip()
        email = params["email"].strip()
        if role == "blood_bank":
            admin_msg = f"New blood bank registered: {params['bank_name'].strip()} ({email}). Needs verification."
        else:
            admin_msg = f"New {ROLE_LABELS[role].lower()} account registered: {name} ({email})."
        notify_admins(curr, admin_msg)

        conn.commit()
        curr.close()
        conn.close()

        return jsonify({"message": "Registration successful.", "user_id": user_id}), 201

    except mariadb.IntegrityError as e:
        return jsonify({"message": "Email already exists or violates a database constraint.", "error": _log_db_error(e)}), 400

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# =====================================================================
# AUTH: LOGIN
# =====================================================================
@app.route("/login", methods=["POST"])
def login():

    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        email = str(params.get("email", "")).strip()
        password = str(params.get("password", "")).strip()

        if not email or not email_regex.fullmatch(email):
            return jsonify({"message": "A valid email is required."}), 400
        if not password:
            return jsonify({"message": "Password is required."}), 400

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT user_id, full_name, email, password_hash, role, account_status
            FROM Users WHERE email = ?
        """, (email,))
        row = curr.fetchone()

        if row is None or not check_password_hash(row[3], password):
            curr.close()
            conn.close()
            return jsonify({"message": "Invalid email or password."}), 401

        if row[5] != "active":
            curr.close()
            conn.close()
            return jsonify({"message": "This account is disabled. Please contact an admin."}), 403

        curr.execute("UPDATE Users SET last_login = ? WHERE user_id = ?",
                     (datetime.now(), row[0]))

        notify_admins(
            curr,
            f"{ROLE_LABELS.get(row[4], row[4])} logged in: {row[1]} ({row[2]}).",
            exclude_user_id=row[0],
            dedupe_minutes=LOGIN_NOTIFY_DEDUPE_MIN
        )
        conn.commit()
        curr.close()
        conn.close()

        return jsonify({
            "message": "Login successful.",
            "user_id": row[0],
            "full_name": row[1],
            "email": row[2],
            "role": row[4],
            "token": make_token(row[0])
        }), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# =====================================================================
# DONORS
# =====================================================================
# PHASE 3: availability / eligibility returned here are the EFFECTIVE values
# (the donor's own switch + the rest period after their last donation)
@app.route("/donors/profile/<int:user_id>", methods=["GET"])
@require_auth(allow=ALLOW_SELF_OR_ADMIN)
def get_donor_profile(user_id):

    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT d.donor_id, u.full_name, u.email, u.contact_number,
                   u.address, u.barangay, u.city,
                   bt.blood_type, d.latitude, d.longitude,
                   d.availability_status, d.eligibility_status, d.last_donation_date
            FROM Donors d
            JOIN Users u ON d.user_id = u.user_id
            JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
            WHERE d.user_id = ?
        """, (user_id,))
        row = curr.fetchone()
        curr.close()
        conn.close()

        # 404 here tells the frontend to show the "Set up your donor profile" screen
        if row is None:
            return jsonify({"message": "Donor profile not found."}), 404

        last = to_date(row[12])
        nxt = next_eligible_on(last)
        resting = in_rest_period(last)

        result = {
            "donor_id": row[0], "full_name": row[1], "email": row[2], "contact_number": row[3],
            "address": row[4], "barangay": row[5], "city": row[6], "blood_type": row[7],
            "latitude": float(row[8]) if row[8] is not None else None,
            "longitude": float(row[9]) if row[9] is not None else None,
            # what the system uses: the donor's own switch AND the rest period
            "availability_status": "unavailable" if resting else row[10],
            # the donor's own switch, so saving the form never overwrites it
            "availability_preference": row[10],
            "eligibility_status": effective_eligibility(row[11], last),
            "last_donation_date": last.isoformat() if last else None,
            "next_eligible_date": nxt.isoformat() if nxt else None,
            "in_rest_period": resting,
        }

        return jsonify(result), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# NEW: lets a member who has no donor profile (old requester-only account) create one
@app.route("/donors/setup", methods=["POST"])
@require_auth(allow=ALLOW_DONOR_SETUP)
def setup_donor_profile():

    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        user_id = params.get("user_id")
        blood_type = str(params.get("blood_type", "")).strip().upper()

        if not user_id:
            return jsonify({"message": "User ID is required."}), 400
        if not blood_type_regex.fullmatch(blood_type):
            return jsonify({"message": "Blood Type must be one of A+, A-, B+, B-, O+, O-, AB+, AB-."}), 400

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("SELECT role FROM Users WHERE user_id = ?", (user_id,))
        u = curr.fetchone()
        if u is None or u[0] not in MEMBER_ROLES:
            curr.close()
            conn.close()
            return jsonify({"message": "Only member accounts can have a donor profile."}), 403

        blood_type_id = get_blood_type_id(curr, blood_type)
        if blood_type_id is None:
            curr.close()
            conn.close()
            return jsonify({"message": "Unknown Blood Type."}), 400

        curr.execute(
            "INSERT INTO Donors (user_id, blood_type_id) VALUES (?, ?)",
            (user_id, blood_type_id)
        )
        conn.commit()
        curr.close()
        conn.close()

        return jsonify({"message": "Donor profile created."}), 201

    except mariadb.IntegrityError:
        return jsonify({"message": "This account already has a donor profile."}), 400

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# PHASE 3: availability / eligibility are the EFFECTIVE values, plus next_eligible_date
@app.route("/donors", methods=["GET"])
@require_auth("blood_bank", "admin")
def get_donors():

    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT d.donor_id, u.full_name, u.email, u.contact_number,
                   bt.blood_type, d.latitude, d.longitude,
                   d.availability_status, d.eligibility_status, d.last_donation_date
            FROM Donors d
            JOIN Users u ON d.user_id = u.user_id
            JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
            ORDER BY d.donor_id ASC
        """)
        rows = curr.fetchall()
        curr.close()
        conn.close()

        results = []
        for r in rows:
            last = to_date(r[9])
            nxt = next_eligible_on(last)
            results.append({
                "donor_id": r[0], "full_name": r[1], "email": r[2], "contact_number": r[3],
                "blood_type": r[4],
                "latitude": float(r[5]) if r[5] is not None else None,
                "longitude": float(r[6]) if r[6] is not None else None,
                "availability_status": "unavailable" if in_rest_period(last) else r[7],
                "eligibility_status": effective_eligibility(r[8], last),
                "last_donation_date": last.isoformat() if last else None,
                "next_eligible_date": nxt.isoformat() if nxt else None,
            })

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# PHASE 3: donors can change availability and location only.
# eligibility_status and last_donation_date come from donation history / staff,
# so only an admin may edit them (before, a donor could reset their own rest period).
@app.route("/donors/<int:donor_id>", methods=["PUT"])
@require_auth(allow=ALLOW_DONOR)
def update_donor(donor_id):

    conn = None
    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        error = validate_coordinates(params)
        if error:
            return jsonify({"message": error}), 400

        sets, vals = [], []

        if "latitude" in params or "longitude" in params:
            sets += ["latitude = ?", "longitude = ?"]
            vals += [params.get("latitude"), params.get("longitude")]

        if "availability_status" in params:
            if params["availability_status"] not in ("available", "unavailable"):
                return jsonify({"message": "Availability Status must be 'available' or 'unavailable'."}), 400
            sets.append("availability_status = ?")
            vals.append(params["availability_status"])

        if g.user["role"] == "admin":
            if "eligibility_status" in params:
                if params["eligibility_status"] not in ("eligible", "temporarily_deferred", "ineligible"):
                    return jsonify({"message": "Invalid Eligibility Status."}), 400
                sets.append("eligibility_status = ?")
                vals.append(params["eligibility_status"])
            if params.get("last_donation_date"):
                text = str(params["last_donation_date"]).strip()
                if not date_regex.fullmatch(text) or to_date(text) is None:
                    return jsonify({"message": "Last Donation Date must use YYYY-MM-DD format."}), 400
                sets.append("last_donation_date = ?")
                vals.append(text[:10])

        if not sets:
            return jsonify({"message": "Nothing to update."}), 400

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("SELECT 1 FROM Donors WHERE donor_id = ?", (donor_id,))
        if curr.fetchone() is None:
            return jsonify({"message": "Donor not found."}), 404

        curr.execute(f"UPDATE Donors SET {', '.join(sets)} WHERE donor_id = ?", tuple(vals) + (donor_id,))
        conn.commit()

        return jsonify({"message": "Donor updated successfully."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500

    finally:
        if conn:
            conn.close()


@app.route("/donors/<int:donor_id>", methods=["DELETE"])
@require_auth("admin")
def delete_donor(donor_id):

    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("DELETE FROM Donors WHERE donor_id = ?", (donor_id,))

        if curr.rowcount == 0:
            curr.close()
            conn.close()
            return jsonify({"message": "Donor not found."}), 404

        conn.commit()
        curr.close()
        conn.close()

        return jsonify({"message": "Donor deleted successfully."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# =====================================================================
# BLOOD REQUESTS
# =====================================================================
@app.route("/requesters/profile/<int:user_id>", methods=["GET"])
@require_auth(allow=ALLOW_SELF_OR_ADMIN)
def get_requester_profile(user_id):

    try:
        conn = db_connect()
        curr = conn.cursor()

        query = """
            SELECT req.requester_id, u.full_name, u.email, u.contact_number,
                   req.requester_type, req.affiliated_hospital
            FROM Requesters req
            JOIN Users u ON req.user_id = u.user_id
            WHERE req.user_id = ?
        """
        curr.execute(query, (user_id,))
        row = curr.fetchone()

        # members always get a requester profile: create it on first use
        if row is None:
            curr.execute("SELECT role FROM Users WHERE user_id = ?", (user_id,))
            u = curr.fetchone()
            if u is None or u[0] not in MEMBER_ROLES:
                curr.close()
                conn.close()
                return jsonify({"message": "Requester profile not found."}), 404

            curr.execute(
                "INSERT INTO Requesters (user_id, requester_type) VALUES (?, 'individual')",
                (user_id,)
            )
            conn.commit()
            curr.execute(query, (user_id,))
            row = curr.fetchone()

        curr.close()
        conn.close()

        result = {
            "requester_id": row[0], "full_name": row[1], "email": row[2],
            "contact_number": row[3], "requester_type": row[4],
            "affiliated_hospital": row[5]
        }
        return jsonify(result), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# PHASE 3: requesters can never set "critical" themselves. They can FLAG an emergency
# (critical_claim); it is stored as high urgency + a pending claim until a verified
# blood bank or an admin confirms it (see review_critical below).
@app.route("/requests", methods=["POST"])
@require_auth(allow=ALLOW_NEW_REQUEST)
def create_request():

    conn = None
    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        requester_id = params.get("requester_id")
        if not requester_id:
            return jsonify({"message": "Requester ID is required."}), 400

        error = validate_blood_request(params)
        if error:
            return jsonify({"message": error}), 400

        def clean(v, n):
            v = str(v).strip() if v is not None else ""
            return v[:n] if v else None

        # ---- urgency: requesters can never set "critical" themselves ----
        urgency = str(params.get("urgency_level", "medium")).strip()
        claim = params.get("critical_claim") is True or urgency == "critical"
        if urgency == "critical":
            urgency = "high"          # shown as high until a reviewer confirms it

        reason = clean(params.get("critical_reason"), 255) if claim else None
        hospital = clean(params.get("hospital_name"), 150)
        if claim:
            if not reason or len(reason) < CRITICAL_MIN_REASON:
                return jsonify({"message": "To flag an emergency, describe the situation (at least 10 characters)."}), 400
            if not hospital:
                return jsonify({"message": "To flag an emergency, enter the hospital or clinic."}), 400

        conn = db_connect()
        curr = conn.cursor()

        blood_type = params["blood_type"].strip().upper()
        blood_type_id = get_blood_type_id(curr, blood_type)
        if blood_type_id is None:
            return jsonify({"message": "Unknown Blood Type."}), 400

        # ---- abuse limits for emergency flags ----
        if claim:
            curr.execute(f"""
                SELECT COALESCE(SUM(critical_status = 'pending' AND status IN ('pending', 'matched')), 0),
                       COALESCE(SUM(critical_status = 'rejected'
                                    AND date_requested > DATE_SUB(NOW(), INTERVAL {int(CRITICAL_LOCK_DAYS)} DAY)), 0)
                FROM BloodRequests WHERE requester_id = ?
            """, (requester_id,))
            waiting, rejected = curr.fetchone()
            if waiting >= MAX_PENDING_CRITICAL:
                return jsonify({"message": "You already have emergency requests waiting for confirmation. "
                                           "Please wait for a decision before flagging another."}), 400
            if rejected >= MAX_REJECTED_CRITICAL:
                return jsonify({"message": "Emergency flags are paused on your account because several recent "
                                           "ones were not confirmed. You can still post a normal request."}), 403

        qty = parse_units(params["quantity_needed"])

        curr.execute("""
            INSERT INTO BloodRequests (
                requester_id, blood_type_id, quantity_needed, urgency_level,
                location_needed, latitude, longitude, date_needed_by,
                patient_name, patient_relationship, hospital_name,
                critical_status, critical_reason
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            requester_id,
            blood_type_id,
            qty,
            urgency,
            params.get("location_needed"),
            params.get("latitude"),
            params.get("longitude"),
            params.get("date_needed_by"),
            clean(params.get("patient_name"), 100),
            clean(params.get("patient_relationship"), 30),
            hospital,
            "pending" if claim else "none",
            reason,
        ))
        request_id = curr.lastrowid

        if claim:
            notify_critical_reviewers(
                curr,
                f"Emergency request #{request_id}: {blood_type}, {unit_label(qty)} at {hospital}. Needs confirmation.",
                request_id
            )

        conn.commit()

        return jsonify({
            "message": "Blood request created.", "request_id": request_id,
            "critical_status": "pending" if claim else "none"
        }), 201

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500

    finally:
        if conn:
            conn.close()


# PHASE 3: each request also carries critical_status / critical_reason and its match state
# (active_match = proposed / accepted / confirmed or None, declined_matches = how many said no)
@app.route("/requests", methods=["GET"])
@require_auth(allow=ALLOW_REQUEST_LIST)
def get_requests():

    try:
        status_filter = request.args.get("status")
        requester_id_filter = request.args.get("requester_id")

        conn = db_connect()
        curr = conn.cursor()

        query = """
            SELECT r.request_id, u.full_name, bt.blood_type, r.quantity_needed,
                   r.urgency_level, r.status, r.location_needed, r.date_requested,
                   r.requester_id, r.critical_status, r.critical_reason,
                   (SELECT m.match_status FROM Matches m
                     WHERE m.request_id = r.request_id
                       AND m.match_status IN ('proposed', 'accepted', 'confirmed')
                     ORDER BY FIELD(m.match_status, 'confirmed', 'accepted', 'proposed')
                     LIMIT 1) AS active_match,
                   (SELECT COUNT(*) FROM Matches m
                     WHERE m.request_id = r.request_id AND m.match_status = 'declined') AS declined_matches
            FROM BloodRequests r
            JOIN Requesters req ON r.requester_id = req.requester_id
            JOIN Users u ON req.user_id = u.user_id
            JOIN BloodTypes bt ON r.blood_type_id = bt.blood_type_id
        """
        conditions = []
        params_sql = []

        if status_filter:
            conditions.append("r.status = ?")
            params_sql.append(status_filter)
        if requester_id_filter:
            conditions.append("r.requester_id = ?")
            params_sql.append(requester_id_filter)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY r.date_requested DESC"

        curr.execute(query, tuple(params_sql))
        rows = curr.fetchall()
        curr.close()
        conn.close()

        results = [{
            "request_id": r[0], "requester_name": r[1], "blood_type": r[2],
            "quantity_needed": float(r[3]), "urgency_level": r[4], "status": r[5],
            "location_needed": r[6], "date_requested": str(r[7]), "requester_id": r[8],
            "critical_status": r[9], "critical_reason": r[10],
            "active_match": r[11], "declined_matches": int(r[12] or 0)
        } for r in rows]

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# PHASE 3 (NEW): a verified blood bank or an admin confirms or rejects an emergency flag
@app.route("/requests/<int:request_id>/critical", methods=["PUT"])
@require_auth("blood_bank", "admin")
def review_critical(request_id):

    conn = None
    try:
        decision = str(_body().get("decision", "")).strip()
        if decision not in ("confirm", "reject"):
            return jsonify({"message": "Decision must be confirm or reject."}), 400

        conn = db_connect()
        curr = conn.cursor()

        if g.user["role"] == "blood_bank":
            curr.execute("SELECT verified_status FROM BloodBanks WHERE user_id = ?", (g.user["uid"],))
            bank = curr.fetchone()
            if bank is None or bank[0] != "verified":
                return jsonify({"message": "Only a verified blood bank can review emergency requests."}), 403

        curr.execute("""
            SELECT critical_status, status, requester_id, blood_type_id
            FROM BloodRequests WHERE request_id = ? FOR UPDATE
        """, (request_id,))
        row = curr.fetchone()
        if row is None:
            return jsonify({"message": "Blood request not found."}), 404
        if row[0] != "pending":
            conn.rollback()
            return jsonify({"message": "This request isn't waiting for a decision."}), 409
        if row[1] not in ("pending", "matched"):
            conn.rollback()
            return jsonify({"message": "This request is already closed."}), 409

        if decision == "confirm":
            curr.execute("""
                UPDATE BloodRequests
                SET urgency_level = 'critical', critical_status = 'confirmed',
                    critical_reviewed_by = ?, critical_reviewed_at = NOW()
                WHERE request_id = ?
            """, (g.user["uid"], request_id))
            note = f"Your emergency request #{request_id} was confirmed as critical."
        else:
            curr.execute("""
                UPDATE BloodRequests
                SET critical_status = 'rejected',
                    critical_reviewed_by = ?, critical_reviewed_at = NOW()
                WHERE request_id = ?
            """, (g.user["uid"], request_id))
            note = (f"Your request #{request_id} was not confirmed as critical. "
                    f"It stays open as high urgency.")

        curr.execute("SELECT user_id FROM Requesters WHERE requester_id = ?", (row[2],))
        owner = curr.fetchone()
        if owner:
            send_notification(curr, owner[0], note, "in_app", request_id)

        curr.execute("""
            INSERT INTO AuditLogs (user_id, action_performed, details)
            VALUES (?, ?, ?)
        """, (g.user["uid"], "critical_review", f"Request {request_id}: {decision}"))

        conn.commit()
        return jsonify({"message": "Marked as critical." if decision == "confirm"
                        else "Critical flag rejected. The request stays open as high urgency."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500

    finally:
        if conn:
            conn.close()


REQUEST_TRANSITIONS = {
    "pending":   {"matched", "fulfilled", "cancelled"},
    "matched":   {"pending", "fulfilled", "cancelled"},
    "fulfilled": set(),
    "cancelled": set(),
}


@app.route("/requests/<int:request_id>", methods=["PUT"])
@require_auth(allow=ALLOW_REQUEST_STATUS)
def update_request_status(request_id):

    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        status = str(params.get("status", "")).strip()
        if status not in ("pending", "matched", "fulfilled", "cancelled"):
            return jsonify({"message": "Invalid status value."}), 400

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("SELECT status FROM BloodRequests WHERE request_id = ? FOR UPDATE", (request_id,))
        row = curr.fetchone()
        if row is None:
            curr.close()
            conn.close()
            return jsonify({"message": "Blood request not found."}), 404

        # fulfilled / cancelled are final; they can't be reopened or changed
        if status != row[0] and status not in REQUEST_TRANSITIONS.get(row[0], set()):
            conn.rollback()
            curr.close()
            conn.close()
            return jsonify({"message": f"A {row[0]} request can't be changed to {status}."}), 409

        curr.execute("UPDATE BloodRequests SET status = ? WHERE request_id = ?", (status, request_id))

        # cancelling a request also closes the donor matches that were still open
        if status == "cancelled" and row[0] != "cancelled":
            curr.execute("""
                SELECT d.user_id FROM Matches m JOIN Donors d ON m.donor_id = d.donor_id
                WHERE m.request_id = ? AND m.match_status IN ('proposed', 'accepted')
            """, (request_id,))
            for (donor_user_id,) in curr.fetchall():
                send_notification(curr, donor_user_id,
                                  "A blood request you were matched to has been cancelled by the requester.",
                                  "in_app", request_id)
            curr.execute("""
                UPDATE Matches SET match_status = 'expired', responded_at = ?
                WHERE request_id = ? AND match_status IN ('proposed', 'accepted')
            """, (datetime.now(), request_id))

        conn.commit()
        curr.close()
        conn.close()

        return jsonify({"message": "Blood request updated."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# =====================================================================
# MATCHING ENGINE
# =====================================================================
# PHASE 3: skips donors in their rest period, returns each donor's match_status
# (so the button can turn into a status), and only shows a phone number once the donor accepted.
@app.route("/requests/<int:request_id>/find-donors", methods=["GET"])
@require_auth(allow=ALLOW_REQUEST)
def find_donors(request_id):
    """Finds eligible, available, blood-type-compatible donors for a request,
       sorted by proximity if coordinates are available.
       The requester's own donor profile is excluded (one account can be both)."""

    conn = None
    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT bt.blood_type, r.latitude, r.longitude, req.user_id, r.quantity_needed
            FROM BloodRequests r
            JOIN BloodTypes bt ON r.blood_type_id = bt.blood_type_id
            JOIN Requesters req ON r.requester_id = req.requester_id
            WHERE r.request_id = ?
        """, (request_id,))
        req_row = curr.fetchone()

        if req_row is None:
            return jsonify({"message": "Blood request not found."}), 404

        needed_type, req_lat, req_lon, requester_user_id, units_needed = req_row
        compatible_types = [bt for bt, targets in COMPATIBILITY.items() if needed_type in targets] or [needed_type]

        placeholders = ",".join(["?"] * len(compatible_types))
        curr.execute(f"""
            SELECT d.donor_id, u.full_name, u.contact_number, bt.blood_type,
                   d.latitude, d.longitude, m.match_status
            FROM Donors d
            JOIN Users u ON d.user_id = u.user_id
            JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
            LEFT JOIN Matches m ON m.donor_id = d.donor_id AND m.request_id = ?
            WHERE bt.blood_type IN ({placeholders})
              AND u.account_status = 'active'
              AND d.availability_status = 'available'
              AND d.eligibility_status = 'eligible'
              AND {REST_OK_SQL}
              AND d.user_id <> ?
        """, (request_id,) + tuple(compatible_types) + (requester_user_id,))
        rows = curr.fetchall()

        results = []
        for r in rows:
            donor_lat = float(r[4]) if r[4] is not None else None
            donor_lon = float(r[5]) if r[5] is not None else None
            distance = haversine_km(
                float(req_lat) if req_lat is not None else None,
                float(req_lon) if req_lon is not None else None,
                donor_lat, donor_lon
            )
            status = r[6]
            results.append({
                "donor_id": r[0], "full_name": r[1],
                # the phone number is only shared once the donor has said yes
                "contact_number": r[2] if status in ("accepted", "confirmed") else None,
                "blood_type": r[3], "distance_km": distance,
                "match_status": status,
                "quantity_needed": float(units_needed)
            })

        results.sort(key=lambda x: (x["distance_km"] is None, x["distance_km"]))

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500

    finally:
        if conn:
            conn.close()


@app.route("/matches", methods=["GET"])
@require_auth(allow=ALLOW_MATCH_LIST)
def get_matches():

    try:
        donor_id_filter = request.args.get("donor_id")
        request_id_filter = request.args.get("request_id")

        conn = db_connect()
        curr = conn.cursor()

        query = """
            SELECT m.match_id, m.request_id, m.donor_id, m.distance_km,
                   m.match_status, m.match_date, m.responded_at,
                   bt.blood_type, br.quantity_needed, br.urgency_level,
                   br.location_needed, u.full_name AS requester_name,
                   u.contact_number AS requester_contact
            FROM Matches m
            JOIN BloodRequests br ON m.request_id = br.request_id
            JOIN BloodTypes bt ON br.blood_type_id = bt.blood_type_id
            JOIN Requesters req ON br.requester_id = req.requester_id
            JOIN Users u ON req.user_id = u.user_id
        """
        conditions = []
        params_sql = []

        if donor_id_filter:
            conditions.append("m.donor_id = ?")
            params_sql.append(donor_id_filter)
        if request_id_filter:
            conditions.append("m.request_id = ?")
            params_sql.append(request_id_filter)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY m.match_date DESC"

        curr.execute(query, tuple(params_sql))
        rows = curr.fetchall()
        curr.close()
        conn.close()

        results = [{
            "match_id": r[0], "request_id": r[1], "donor_id": r[2],
            "distance_km": float(r[3]) if r[3] is not None else None,
            "match_status": r[4], "match_date": str(r[5]),
            "responded_at": str(r[6]) if r[6] else None,
            "blood_type": r[7], "quantity_needed": float(r[8]), "urgency_level": r[9],
            "location_needed": r[10], "requester_name": r[11], "requester_contact": r[12]
        } for r in rows]

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


@app.route("/matches", methods=["POST"])
@require_auth(allow=ALLOW_MATCH_NEW)
def create_match():

    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        request_id = params.get("request_id")
        donor_id = params.get("donor_id")

        if not request_id or not donor_id:
            return jsonify({"message": "Request ID and Donor ID are required."}), 400

        conn = db_connect()
        curr = conn.cursor()

        # a member can't be matched to their own request
        curr.execute("""
            SELECT 1
            FROM BloodRequests br
            JOIN Requesters req ON br.requester_id = req.requester_id
            JOIN Donors d ON d.user_id = req.user_id
            WHERE br.request_id = ? AND d.donor_id = ?
        """, (request_id, donor_id))
        if curr.fetchone():
            curr.close()
            conn.close()
            return jsonify({"message": "You can't match with your own request."}), 400

        # PHASE 3: the request must still be open, and the donor must be free to donate right now
        curr.execute("SELECT status FROM BloodRequests WHERE request_id = ?", (request_id,))
        req_row = curr.fetchone()
        if req_row is None:
            curr.close()
            conn.close()
            return jsonify({"message": "Blood request not found."}), 404
        if req_row[0] not in ("pending", "matched"):
            curr.close()
            conn.close()
            return jsonify({"message": "This request is already closed."}), 400

        curr.execute(f"""
            SELECT 1 FROM Donors d
            WHERE d.donor_id = ? AND d.availability_status = 'available'
              AND d.eligibility_status = 'eligible' AND {REST_OK_SQL}
        """, (donor_id,))
        if curr.fetchone() is None:
            curr.close()
            conn.close()
            return jsonify({"message": "This donor isn't available to donate right now."}), 400

        curr.execute("""
            INSERT INTO Matches (request_id, donor_id, distance_km, match_status)
            VALUES (?, ?, ?, 'proposed')
        """, (request_id, donor_id, params.get("distance_km")))

        match_id = curr.lastrowid

        # Notify the donor that a blood request has been matched to them
        curr.execute("""
            SELECT d.user_id, bt.blood_type, br.urgency_level, u.full_name, br.quantity_needed
            FROM Donors d
            JOIN BloodRequests br ON br.request_id = ?
            JOIN BloodTypes bt ON br.blood_type_id = bt.blood_type_id
            JOIN Requesters req ON br.requester_id = req.requester_id
            JOIN Users u ON req.user_id = u.user_id
            WHERE d.donor_id = ?
        """, (request_id, donor_id))
        info = curr.fetchone()

        if info:
            donor_user_id, blood_type, urgency, requester_name, qty = info
            message = (f"{requester_name} needs {unit_label(qty)} of {blood_type} blood "
                       f"({urgency} urgency). Check your dashboard to respond.")
            send_notification(curr, donor_user_id, message, "in_app", request_id)

        conn.commit()
        curr.close()
        conn.close()

        return jsonify({"message": "Match created.", "match_id": match_id}), 201

    except mariadb.IntegrityError as e:
        return jsonify({"message": "This donor is already matched to this request.", "error": _log_db_error(e)}), 400

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


MATCH_TRANSITIONS = {
    "proposed":  {"accepted", "declined", "expired"},
    "accepted":  {"confirmed", "expired"},
    "declined":  set(),
    "confirmed": set(),
    "expired":   set(),
}


# PHASE 3: the request now flips between pending and matched as donors accept or decline
@app.route("/matches/<int:match_id>", methods=["PUT"])
@require_auth(allow=ALLOW_MATCH_UPDATE)
def update_match_status(match_id):

    conn = None
    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        status = str(params.get("match_status", "")).strip()
        if status not in ("proposed", "accepted", "declined", "confirmed", "expired"):
            return jsonify({"message": "Invalid match status."}), 400

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("SELECT match_status, request_id FROM Matches WHERE match_id = ? FOR UPDATE", (match_id,))
        row = curr.fetchone()
        if row is None:
            return jsonify({"message": "Match not found."}), 404

        if status == row[0]:
            # repeat click: nothing to change, and nobody is notified twice
            conn.rollback()
            return jsonify({"message": "Match updated."}), 200

        # a decision can't be undone: declined / confirmed / expired are final
        if status not in MATCH_TRANSITIONS.get(row[0], set()):
            conn.rollback()
            return jsonify({"message": f"This match is already {row[0]} and can't be changed to {status}."}), 409

        curr.execute("""
            UPDATE Matches SET match_status = ?, responded_at = ?
            WHERE match_id = ?
        """, (status, datetime.now(), match_id))

        # the request follows its matches: matched while a donor has accepted, pending again after a decline
        sync_request_status(curr, row[1])

        # Notify the requester when the donor responds to the match
        if status in ("accepted", "declined", "confirmed"):
            curr.execute("""
                SELECT ru.user_id, du.full_name, br.request_id
                FROM Matches m
                JOIN BloodRequests br ON m.request_id = br.request_id
                JOIN Requesters req ON br.requester_id = req.requester_id
                JOIN Users ru ON req.user_id = ru.user_id
                JOIN Donors d ON m.donor_id = d.donor_id
                JOIN Users du ON d.user_id = du.user_id
                WHERE m.match_id = ?
            """, (match_id,))
            info = curr.fetchone()

            if info:
                requester_user_id, donor_name, req_id = info
                status_messages = {
                    "accepted": f"{donor_name} accepted your blood request.",
                    "declined": f"{donor_name} declined your blood request. You can find another donor.",
                    "confirmed": f"Donation confirmed with {donor_name}.",
                }
                send_notification(curr, requester_user_id, status_messages[status], "in_app", req_id)

        conn.commit()
        return jsonify({"message": "Match updated."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500

    finally:
        if conn:
            conn.close()


# =====================================================================
# DONATIONS
# =====================================================================

@app.route("/bloodbanks/profile/<int:user_id>", methods=["GET"])
@require_auth(allow=ALLOW_SELF_OR_ADMIN)
def get_bloodbank_profile(user_id):

    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT bb.blood_bank_id, u.full_name, u.email, u.contact_number,
                   bb.bank_name, bb.license_number, bb.operating_hours, bb.verified_status
            FROM BloodBanks bb
            JOIN Users u ON bb.user_id = u.user_id
            WHERE bb.user_id = ?
        """, (user_id,))
        row = curr.fetchone()
        curr.close()
        conn.close()

        if row is None:
            return jsonify({"message": "Blood bank profile not found."}), 404

        result = {
            "blood_bank_id": row[0], "full_name": row[1], "email": row[2],
            "contact_number": row[3], "bank_name": row[4], "license_number": row[5],
            "operating_hours": row[6], "verified_status": row[7]
        }
        return jsonify(result), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


@app.route("/bloodbanks/<int:blood_bank_id>/inventory", methods=["GET"])
@require_auth()
def get_inventory(blood_bank_id):

    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT bt.blood_type_id, bt.blood_type,
                   COALESCE(inv.units_available, 0), inv.last_updated
            FROM BloodTypes bt
            LEFT JOIN BloodBankInventory inv
                ON bt.blood_type_id = inv.blood_type_id AND inv.blood_bank_id = ?
            ORDER BY bt.blood_type
        """, (blood_bank_id,))
        rows = curr.fetchall()
        curr.close()
        conn.close()

        results = [{
            "blood_type_id": r[0], "blood_type": r[1],
            "units_available": float(r[2]), "last_updated": str(r[3]) if r[3] else None
        } for r in rows]

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


def log_inventory_change(curr, blood_bank_id, blood_type_id, changed_by,
                         old_units, new_units, reason=None, source="manual"):
    """Writes one InventoryAuditLog row using the caller's cursor.
       The caller commits, so the stock change and its log entry succeed or fail together.
       `source` lets other features (e.g. 'donation') log their own stock changes later."""
    curr.execute("""
        INSERT INTO InventoryAuditLog (
            blood_bank_id, blood_type_id, changed_by,
            old_units, new_units, change_units, reason, source
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (blood_bank_id, blood_type_id, changed_by,
          old_units, new_units, new_units - old_units, reason, source))


@app.route("/bloodbanks/<int:blood_bank_id>/inventory", methods=["PUT"])
@require_auth("blood_bank", "admin", allow=ALLOW_INVENTORY_WRITE)
def update_inventory(blood_bank_id):

    conn = None
    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        blood_type_id = params.get("blood_type_id")
        units = parse_units(params.get("units_available", ""), allow_zero=True)
        changed_by = params.get("changed_by")
        reason = str(params.get("reason") or "").strip()[:255] or None

        if not blood_type_id:
            return jsonify({"message": "Blood Type ID is required."}), 400
        if units is None:
            return jsonify({"message": "Units available " + UNIT_RULE_MSG}), 400
        if not changed_by:
            return jsonify({"message": "Changed By (user ID) is required."}), 400

        conn = db_connect()
        curr = conn.cursor()

        # only the bank's own account (or an admin) may change its stock
        curr.execute("SELECT user_id, verified_status FROM BloodBanks WHERE blood_bank_id = ?", (blood_bank_id,))
        bank = curr.fetchone()
        if bank is None:
            return jsonify({"message": "Blood bank not found."}), 404

        curr.execute("SELECT role FROM Users WHERE user_id = ?", (changed_by,))
        actor = curr.fetchone()
        if actor is None or (str(bank[0]) != str(changed_by) and actor[0] != "admin"):
            return jsonify({"message": "You are not allowed to change this inventory."}), 403

        # only VERIFIED banks may edit stock (requests stay open to everyone)
        if bank[1] != "verified":
            return jsonify({
                "message": "Your blood bank must be verified by an admin before you can edit inventory.",
                "verified_status": bank[1]
            }), 403

        # read the old value (locked) so the log shows exactly what it was before
        curr.execute("""
            SELECT units_available FROM BloodBankInventory
            WHERE blood_bank_id = ? AND blood_type_id = ?
            FOR UPDATE
        """, (blood_bank_id, blood_type_id))
        row = curr.fetchone()
        old_units = Decimal(str(row[0])) if row else Decimal("0")

        if old_units == units:
            conn.rollback()
            return jsonify({"message": "No change.", "changed": False}), 200

        curr.execute("""
            INSERT INTO BloodBankInventory (blood_bank_id, blood_type_id, units_available)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE units_available = VALUES(units_available)
        """, (blood_bank_id, blood_type_id, units))

        log_inventory_change(curr, blood_bank_id, blood_type_id, changed_by,
                             old_units, units, reason, "manual")

        conn.commit()

        return jsonify({
            "message": "Inventory updated.", "changed": True,
            "old_units": float(old_units), "new_units": float(units)
        }), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500

    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------
# INVENTORY AUDIT LOG (read)
# ---------------------------------------------------------------------
def fetch_inventory_audit(blood_bank_id=None, limit=100):
    try:
        limit = min(max(int(limit), 1), 500)
    except (TypeError, ValueError):
        limit = 100

    query = """
        SELECT a.audit_id, a.blood_bank_id, bb.bank_name, bt.blood_type,
               a.old_units, a.new_units, a.change_units, a.reason, a.source,
               a.changed_by, u.full_name, u.role, a.changed_at
        FROM InventoryAuditLog a
        JOIN BloodBanks bb ON a.blood_bank_id = bb.blood_bank_id
        JOIN BloodTypes bt ON a.blood_type_id = bt.blood_type_id
        LEFT JOIN Users u ON a.changed_by = u.user_id
    """
    args = []
    if blood_bank_id:
        query += " WHERE a.blood_bank_id = ?"
        args.append(blood_bank_id)
    query += " ORDER BY a.changed_at DESC, a.audit_id DESC LIMIT ?"
    args.append(limit)

    conn = db_connect()
    try:
        curr = conn.cursor()
        curr.execute(query, tuple(args))
        rows = curr.fetchall()
        curr.close()
    finally:
        conn.close()

    return [{
        "audit_id": r[0], "blood_bank_id": r[1], "bank_name": r[2], "blood_type": r[3],
        "old_units": float(r[4]), "new_units": float(r[5]), "change_units": float(r[6]),
        "reason": r[7], "source": r[8],
        "changed_by": r[9], "changed_by_name": r[10] or "Unknown user", "changed_by_role": r[11],
        "changed_at": str(r[12])
    } for r in rows]


@app.route("/bloodbanks/<int:blood_bank_id>/inventory/audit", methods=["GET"])
@require_auth("blood_bank", "admin", allow=ALLOW_BANK)
def get_bank_inventory_audit(blood_bank_id):
    try:
        return jsonify(fetch_inventory_audit(blood_bank_id, request.args.get("limit", 100))), 200
    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# all banks, or one via ?blood_bank_id=  (for the admin screen)
@app.route("/admin/inventory-audit", methods=["GET"])
@require_auth("admin")
def get_admin_inventory_audit():
    try:
        return jsonify(fetch_inventory_audit(
            request.args.get("blood_bank_id"), request.args.get("limit", 100)
        )), 200
    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# PHASE 3: a completed donation must respect the rest period, and only a COMPLETED donation
# starts a new one (before, a deferred or cancelled entry also reset last_donation_date).
# donation_id is now read right after the insert (it used to return the notification's id).
@app.route("/donations", methods=["POST"])
@require_auth("blood_bank", "admin", allow=ALLOW_BANK_IN_BODY)
def create_donation():

    conn = None
    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        donor_id = params.get("donor_id")
        blood_bank_id = params.get("blood_bank_id")

        if not donor_id or not blood_bank_id:
            return jsonify({"message": "Donor ID and Blood Bank ID are required."}), 400

        error = validate_donation(params)
        if error:
            return jsonify({"message": error}), 400

        status = str(params.get("status", "completed")).strip()

        conn = db_connect()
        curr = conn.cursor()

        # only VERIFIED banks may record donations (same rule as inventory edits)
        curr.execute("SELECT verified_status FROM BloodBanks WHERE blood_bank_id = ?", (blood_bank_id,))
        bank = curr.fetchone()
        if bank is None:
            return jsonify({"message": "Blood bank not found."}), 404
        if bank[0] != "verified":
            return jsonify({
                "message": "Your blood bank must be verified by an admin before you can record donations.",
                "verified_status": bank[0]
            }), 403

        curr.execute("SELECT user_id, last_donation_date FROM Donors WHERE donor_id = ?", (donor_id,))
        donor = curr.fetchone()
        if donor is None:
            return jsonify({"message": "Donor not found."}), 404

        # a completed donation has to respect the rest period
        if status == "completed":
            nxt = next_eligible_on(donor[1])
            if nxt and date.today() < nxt:
                return jsonify({
                    "message": f"This donor gave blood recently and can donate again on {nxt.isoformat()} "
                               f"({DONATION_INTERVAL_DAYS}-day rule)."
                }), 400

        curr.execute("""
            INSERT INTO Donations (donor_id, blood_bank_id, request_id, volume_ml, status, remarks)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            donor_id,
            blood_bank_id,
            params.get("request_id"),
            int(parse_units(params.get("units", 1)) * UNIT_ML),  # entered in units, stored in mL
            status,
            params.get("remarks")
        ))
        donation_id = curr.lastrowid

        if status == "completed":
            # this starts the donor's rest period automatically
            curr.execute("UPDATE Donors SET last_donation_date = CURDATE() WHERE donor_id = ?", (donor_id,))
            send_notification(
                curr, donor[0],
                f"Thank you for your donation! You can donate again after "
                f"{(date.today() + timedelta(days=DONATION_INTERVAL_DAYS)).strftime('%b %d, %Y')}.",
                "in_app", params.get("request_id")
            )

        conn.commit()

        return jsonify({"message": "Donation recorded.", "donation_id": donation_id}), 201

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500

    finally:
        if conn:
            conn.close()


@app.route("/donations", methods=["GET"])
@require_auth(allow=ALLOW_SCOPED_LIST)
def get_donations():

    try:
        donor_id_filter = request.args.get("donor_id")
        bank_id_filter = request.args.get("blood_bank_id")

        conn = db_connect()
        curr = conn.cursor()

        query = """
            SELECT don.donation_id, u.full_name, bb.bank_name, don.volume_ml,
                   don.donation_date, don.status
            FROM Donations don
            JOIN Donors d ON don.donor_id = d.donor_id
            JOIN Users u ON d.user_id = u.user_id
            JOIN BloodBanks bb ON don.blood_bank_id = bb.blood_bank_id
        """
        conditions = []
        params_sql = []

        if donor_id_filter:
            conditions.append("don.donor_id = ?")
            params_sql.append(donor_id_filter)
        if bank_id_filter:
            conditions.append("don.blood_bank_id = ?")
            params_sql.append(bank_id_filter)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY don.donation_date DESC"

        curr.execute(query, tuple(params_sql))
        rows = curr.fetchall()
        curr.close()
        conn.close()

        results = [{
            "donation_id": r[0], "donor_name": r[1], "blood_bank": r[2],
            "volume_ml": r[3], "units": round(r[3] / UNIT_ML, 2),
            "donation_date": str(r[4]), "status": r[5]
        } for r in rows]

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


@app.route("/donors/search", methods=["GET"])
@require_auth("blood_bank", "admin")
def search_donors():

    try:
        keyword = request.args.get("q", "").strip()
        if not keyword:
            return jsonify([]), 200

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT d.donor_id, u.full_name, u.email, bt.blood_type
            FROM Donors d
            JOIN Users u ON d.user_id = u.user_id
            JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
            WHERE u.full_name LIKE ? OR u.email LIKE ?
            LIMIT 10
        """, (f"%{keyword}%", f"%{keyword}%"))

        rows = curr.fetchall()
        curr.close()
        conn.close()

        results = [{
            "donor_id": r[0], "full_name": r[1], "email": r[2], "blood_type": r[3]
        } for r in rows]

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# ---------------------------------------------------------------------
# MEMBER PROFILE HELPERS
# ---------------------------------------------------------------------
MIN_DONOR_AGE = 18
MIN_DONOR_WEIGHT_KG = Decimal("50")
REST_PERIOD_DAYS = DONATION_INTERVAL_DAYS   # PHASE 3: was 56; now one shared setting
GENDERS = ("female", "male", "other", "prefer_not_to_say")


def to_date(value):
    """DATE / DATETIME / 'YYYY-MM-DD...' -> date, or None."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def calc_age(dob, today=None):
    today = today or date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def build_eligibility(dob, weight, last_donation, eligibility_status):
    """The four checks shown on the Profile page.
       ok: True = passed, False = failed, None = we don't have the info yet."""
    today = date.today()
    checks = []

    # age
    if dob is None:
        checks.append({"key": "age", "title": "Age 18 or older",
                       "detail": "Add your date of birth", "ok": None})
    else:
        age = calc_age(dob, today)
        checks.append({"key": "age", "title": "Age 18 or older",
                       "detail": f"You are {age}", "ok": age >= MIN_DONOR_AGE})

    # weight
    if weight is None:
        checks.append({"key": "weight", "title": "Weight 50 kg or more",
                       "detail": "Add your weight", "ok": None})
    else:
        checks.append({"key": "weight", "title": "Weight 50 kg or more",
                       "detail": f"{fmt_units(weight)} kg \u00b7 self-reported",
                       "ok": Decimal(str(weight)) >= MIN_DONOR_WEIGHT_KG})

    # rest period
    next_eligible = None
    if last_donation is None:
        checks.append({"key": "rest", "title": f"{REST_PERIOD_DAYS}-day rest period",
                       "detail": "No previous donation, ready now", "ok": True})
    else:
        next_eligible = last_donation + timedelta(days=REST_PERIOD_DAYS)
        days_left = (next_eligible - today).days
        if days_left <= 0:
            checks.append({"key": "rest", "title": f"{REST_PERIOD_DAYS}-day rest period",
                           "detail": "Rest period is over", "ok": True})
        else:
            checks.append({"key": "rest", "title": f"{REST_PERIOD_DAYS}-day rest period",
                           "detail": f"{days_left} more day{'s' if days_left != 1 else ''} to go",
                           "ok": False})

    # deferral (set by the blood bank / admin through eligibility_status)
    deferred = eligibility_status != "eligible"
    checks.append({"key": "deferral", "title": "No active deferral",
                   "detail": "Deferred for now" if deferred else "Nothing on record",
                   "ok": not deferred})

    return checks, next_eligible


# ---------------------------------------------------------------------
# GET /members/<user_id>/profile-summary
# One call for the whole Profile page: details, donor stats, eligibility,
# active request and request history.
# ---------------------------------------------------------------------
@app.route("/members/<int:user_id>/profile-summary", methods=["GET"])
@require_auth(allow=ALLOW_SELF_OR_ADMIN)
def get_member_profile_summary(user_id):

    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT full_name, email, contact_number, address, barangay, city,
                   date_of_birth, gender, created_at, role
            FROM Users WHERE user_id = ?
        """, (user_id,))
        u = curr.fetchone()
        if u is None or u[9] not in MEMBER_ROLES:
            curr.close()
            conn.close()
            return jsonify({"message": "Member not found."}), 404

        dob = to_date(u[6])

        # donor side (may not exist for old requester-only accounts)
        curr.execute("""
            SELECT d.donor_id, bt.blood_type, d.latitude, d.longitude,
                   d.availability_status, d.eligibility_status,
                   d.last_donation_date, d.weight_kg
            FROM Donors d
            JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
            WHERE d.user_id = ?
        """, (user_id,))
        d = curr.fetchone()

        donor = None
        checks = []
        next_eligible = None
        total_donations = 0
        weight = None
        if d:
            weight = d[7]
            last_donation = to_date(d[6])
            checks, next_eligible = build_eligibility(dob, weight, last_donation, d[5])
            curr.execute("SELECT COUNT(*) FROM Donations WHERE donor_id = ? AND status = 'completed'",
                         (d[0],))
            total_donations = curr.fetchone()[0]
            donor = {
                "donor_id": d[0], "blood_type": d[1],
                "latitude": float(d[2]) if d[2] is not None else None,
                "longitude": float(d[3]) if d[3] is not None else None,
                # PHASE 3: effective values (the donor's own switch is kept in availability_preference)
                "availability_status": "unavailable" if in_rest_period(last_donation) else d[4],
                "availability_preference": d[4],
                "eligibility_status": effective_eligibility(d[5], last_donation),
                "in_rest_period": in_rest_period(last_donation),
                "last_donation_date": last_donation.isoformat() if last_donation else None,
                "weight_kg": float(weight) if weight is not None else None,
                "next_eligible_date": next_eligible.isoformat() if next_eligible else None,
                "can_donate_now": (
                    None if any(c["ok"] is None for c in checks)
                    else all(c["ok"] for c in checks)
                ),
                "total_donations": total_donations,
            }

        # requester side
        curr.execute("SELECT requester_id FROM Requesters WHERE user_id = ?", (user_id,))
        rq = curr.fetchone()
        requests = []
        if rq:
            curr.execute("""
                SELECT r.request_id, bt.blood_type, r.quantity_needed, r.urgency_level,
                       r.status, r.location_needed, r.date_requested,
                       r.patient_name, r.patient_relationship, r.hospital_name,
                       (SELECT COUNT(*) FROM Matches m
                         WHERE m.request_id = r.request_id
                           AND m.match_status IN ('accepted', 'confirmed')) AS matched_donors
                FROM BloodRequests r
                JOIN BloodTypes bt ON r.blood_type_id = bt.blood_type_id
                WHERE r.requester_id = ?
                ORDER BY r.date_requested DESC
            """, (rq[0],))
            requests = [{
                "request_id": r[0], "blood_type": r[1], "quantity_needed": float(r[2]),
                "urgency_level": r[3], "status": r[4], "location_needed": r[5],
                "date_requested": str(r[6]),
                "patient_name": r[7], "patient_relationship": r[8], "hospital_name": r[9],
                "matched_donors": r[10],
            } for r in curr.fetchall()]

        curr.close()
        conn.close()

        # how complete is the profile?
        pinned = bool(donor and donor["latitude"] is not None and donor["longitude"] is not None)
        optional = [
            ("contact number", u[2]), ("address", u[3]), ("barangay", u[4]), ("city", u[5]),
            ("date of birth", dob), ("gender", u[7]),
        ]
        if donor:
            optional += [("weight", weight), ("pinned location", pinned)]
        missing = [label for label, val in optional if not val]
        total_fields = len(optional) + 2          # + name and email, always filled
        filled = total_fields - len(missing)

        return jsonify({
            "user": {
                "full_name": u[0], "email": u[1], "contact_number": u[2],
                "address": u[3], "barangay": u[4], "city": u[5],
                "date_of_birth": dob.isoformat() if dob else None,
                "age": calc_age(dob) if dob else None,
                "gender": u[7],
                "member_since": str(u[8])[:10] if u[8] else None,
            },
            "donor": donor,
            "eligibility_checks": checks,
            "has_requester": rq is not None,
            "requests": requests,
            "completeness": {
                "percent": round(100 * filled / total_fields),
                "missing": missing,
            },
        }), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# ---------------------------------------------------------------------
# PUT /members/<user_id>/personal
# Date of birth, gender and weight (the details the completeness bar asks for).
# Only the fields you send are changed.
# ---------------------------------------------------------------------
@app.route("/members/<int:user_id>/personal", methods=["PUT"])
@require_auth(allow=ALLOW_SELF)
def update_member_personal(user_id):

    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        user_sets, user_vals = [], []

        dob_raw = params.get("date_of_birth")
        if dob_raw not in (None, ""):
            dob = to_date(dob_raw)
            if dob is None:
                return jsonify({"message": "Date of birth must use YYYY-MM-DD format."}), 400
            if dob > date.today() or calc_age(dob) > 120:
                return jsonify({"message": "Date of birth is not valid."}), 400
            user_sets.append("date_of_birth = ?")
            user_vals.append(dob)

        gender = params.get("gender")
        if gender not in (None, ""):
            if gender not in GENDERS:
                return jsonify({"message": "Gender must be female, male, other, or prefer_not_to_say."}), 400
            user_sets.append("gender = ?")
            user_vals.append(gender)

        weight = None
        weight_raw = params.get("weight_kg")
        if weight_raw not in (None, ""):
            try:
                weight = Decimal(str(weight_raw).strip())
            except InvalidOperation:
                return jsonify({"message": "Weight must be a number."}), 400
            if not weight.is_finite() or weight < 30 or weight > 300:
                return jsonify({"message": "Weight must be between 30 and 300 kg."}), 400
            weight = weight.quantize(Decimal("0.1"))

        if not user_sets and weight is None:
            return jsonify({"message": "Nothing to update."}), 400

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("SELECT role FROM Users WHERE user_id = ?", (user_id,))
        u = curr.fetchone()
        if u is None or u[0] not in MEMBER_ROLES:
            curr.close()
            conn.close()
            return jsonify({"message": "Member not found."}), 404

        if user_sets:
            curr.execute(f"UPDATE Users SET {', '.join(user_sets)} WHERE user_id = ?",
                         tuple(user_vals) + (user_id,))

        if weight is not None:
            curr.execute("SELECT 1 FROM Donors WHERE user_id = ?", (user_id,))
            if curr.fetchone() is None:
                conn.rollback()
                curr.close()
                conn.close()
                return jsonify({"message": "Set up your donor profile before adding weight."}), 400
            curr.execute("UPDATE Donors SET weight_kg = ? WHERE user_id = ?", (weight, user_id))

        conn.commit()
        curr.close()
        conn.close()

        return jsonify({"message": "Details updated."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# =====================================================================
# NOTIFICATIONS
# =====================================================================
@app.route("/notifications", methods=["POST"])
@require_auth("admin")
def create_notification():

    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        user_id = params.get("user_id")
        message = str(params.get("message", "")).strip()
        notif_type = str(params.get("type", "in_app")).strip()

        if not user_id:
            return jsonify({"message": "User ID is required."}), 400
        if not message:
            return jsonify({"message": "Message is required."}), 400
        if notif_type not in ("sms", "in_app", "email"):
            return jsonify({"message": "Type must be sms, in_app, or email."}), 400

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            INSERT INTO Notifications (user_id, related_request_id, message, type)
            VALUES (?, ?, ?, ?)
        """, (user_id, params.get("related_request_id"), message, notif_type))

        conn.commit()
        notification_id = curr.lastrowid
        curr.close()
        conn.close()

        return jsonify({"message": "Notification sent.", "notification_id": notification_id}), 201

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


@app.route("/notifications/<int:user_id>", methods=["GET"])
@require_auth(allow=ALLOW_SELF)
def get_notifications(user_id):

    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT notification_id, message, type, date_sent, read_status
            FROM Notifications
            WHERE user_id = ?
            ORDER BY date_sent DESC
        """, (user_id,))
        rows = curr.fetchall()
        curr.close()
        conn.close()

        results = [{
            "notification_id": r[0], "message": r[1], "type": r[2],
            "date_sent": str(r[3]), "read_status": bool(r[4])
        } for r in rows]

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


@app.route("/notifications/<int:notification_id>/read", methods=["PUT"])
@require_auth(allow=ALLOW_NOTIFICATION_READ)
def mark_notification_read(notification_id):

    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("UPDATE Notifications SET read_status = TRUE WHERE notification_id = ?",
                     (notification_id,))

        if curr.rowcount == 0:
            curr.close()
            conn.close()
            return jsonify({"message": "Notification not found."}), 404

        conn.commit()
        curr.close()
        conn.close()

        return jsonify({"message": "Notification marked as read."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# =====================================================================
# ADMIN: VERIFY / MANAGE USERS
# =====================================================================

# list users
@app.route("/admin/users", methods=["GET"])
@require_auth("admin")
def get_users():

    try:
        status_filter = request.args.get("status")

        conn = db_connect()
        curr = conn.cursor()

        query = """
            SELECT user_id, full_name, email, contact_number, role, account_status, date_created
            FROM Users
        """
        params_sql = ()

        if status_filter:
            query += " WHERE account_status = ?"
            params_sql = (status_filter,)

        query += " ORDER BY date_created DESC"

        curr.execute(query, params_sql)
        rows = curr.fetchall()
        curr.close()
        conn.close()

        results = [{
            "user_id": r[0], "full_name": r[1], "email": r[2],
            "contact_number": r[3], "role": r[4],
            "account_status": r[5], "date_created": str(r[6])
        } for r in rows]

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


@app.route("/admin/users/<int:user_id>/status", methods=["PUT"])
@require_auth("admin")
def update_account_status(user_id):

    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        status = str(params.get("account_status", "")).strip()
        if status not in ("pending", "active", "disabled"):
            return jsonify({"message": "Invalid account status."}), 400

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("UPDATE Users SET account_status = ? WHERE user_id = ?", (status, user_id))

        if curr.rowcount == 0:
            curr.close()
            conn.close()
            return jsonify({"message": "User not found."}), 404

        conn.commit()

        curr.execute("""
            INSERT INTO AuditLogs (user_id, action_performed, details)
            VALUES (?, ?, ?)
        """, (user_id, "account_status_update", f"Status changed to {status}"))
        conn.commit()

        curr.close()
        conn.close()

        return jsonify({"message": "Account status updated."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


@app.route("/admin/bloodbanks", methods=["GET"])
@require_auth("admin")
def get_bloodbanks_for_verification():

    try:
        conn = db_connect()
        curr = conn.cursor()

        curr.execute("""
            SELECT bb.blood_bank_id, bb.bank_name, u.email, u.contact_number,
                   bb.license_number, bb.verified_status
            FROM BloodBanks bb
            JOIN Users u ON bb.user_id = u.user_id
            ORDER BY bb.verified_status ASC, bb.blood_bank_id DESC
        """)
        rows = curr.fetchall()
        curr.close()
        conn.close()

        results = [{
            "blood_bank_id": r[0], "bank_name": r[1], "email": r[2],
            "contact_number": r[3], "license_number": r[4], "verified_status": r[5]
        } for r in rows]

        return jsonify(results), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


@app.route("/admin/bloodbanks/<int:blood_bank_id>/verify", methods=["PUT"])
@require_auth("admin")
def verify_bloodbank(blood_bank_id):
    """One approval flow for blood banks:
         verified -> bank is verified AND its login account is activated
         rejected -> bank is rejected; its login stays active so it can re-apply from its profile
         pending  -> verification only; the account status is left alone
       The bank is notified, and the decision is written to AuditLogs."""

    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        status = str(params.get("verified_status", "")).strip()
        if status not in ("pending", "verified", "rejected"):
            return jsonify({"message": "Invalid verification status."}), 400

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("SELECT user_id, bank_name FROM BloodBanks WHERE blood_bank_id = ?", (blood_bank_id,))
        bank = curr.fetchone()
        if bank is None:
            curr.close()
            conn.close()
            return jsonify({"message": "Blood bank not found."}), 404
        bank_user_id, bank_name = bank

        curr.execute("UPDATE BloodBanks SET verified_status = ? WHERE blood_bank_id = ?",
                     (status, blood_bank_id))

        if status == "verified":
            curr.execute("UPDATE Users SET account_status = 'active' WHERE user_id = ?", (bank_user_id,))
            send_notification(curr, bank_user_id,
                              "Your blood bank has been verified. You can now manage your inventory.")
        elif status == "rejected":
            # the login stays usable so the bank can read the decision and re-apply from its
            # profile; it still can't edit inventory, record donations or take appointments
            curr.execute("UPDATE Users SET account_status = 'active' WHERE user_id = ?", (bank_user_id,))
            send_notification(curr, bank_user_id,
                              "Your blood bank verification was rejected. Correct your bank name or license "
                              "number in Edit profile to re-apply, or contact an admin.")

        curr.execute("""
            INSERT INTO AuditLogs (action_performed, details)
            VALUES (?, ?)
        """, ("bloodbank_verification_update", f"Blood bank {blood_bank_id} ({bank_name}) set to {status}"))

        conn.commit()
        curr.close()
        conn.close()

        return jsonify({"message": "Verification status updated."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500


# =====================================================================
# PROFILES (every role): view and edit your own profile
#   - Everyday fields (name, contact, address ...) save immediately.
#   - Email / password changes need the CURRENT password (re-verification).
#   - Blood bank name / license number are SENSITIVE: changing them sends a
#     verified bank back to 'pending' until an admin re-verifies it.
#   - A member's blood type is not editable here: matching depends on it.
# =====================================================================
COMMON_PROFILE_FIELDS = ("full_name", "email", "contact_number", "address", "barangay", "city")
SENSITIVE_BANK_FIELDS = {"bank_name": "bank name", "license_number": "license number"}


def _clean(value):
    text = "" if value is None else str(value).strip()
    return text or None


def load_profile(curr, user_id):
    """Returns the user's profile as a dict (common fields + role-specific fields), or None."""
    curr.execute("""
        SELECT full_name, email, contact_number, address, barangay, city, role
        FROM Users WHERE user_id = ?
    """, (user_id,))
    u = curr.fetchone()
    if u is None:
        return None

    role = "member" if u[6] in MEMBER_ROLES else u[6]
    profile = {
        "user_id": user_id, "role": role, "full_name": u[0], "email": u[1],
        "contact_number": u[2], "address": u[3], "barangay": u[4], "city": u[5]
    }

    if role == "member":
        curr.execute("SELECT requester_type, affiliated_hospital FROM Requesters WHERE user_id = ?", (user_id,))
        r = curr.fetchone()
        profile["requester_type"] = r[0] if r else "individual"
        profile["affiliated_hospital"] = r[1] if r else None

        curr.execute("""
            SELECT bt.blood_type FROM Donors d
            JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
            WHERE d.user_id = ?
        """, (user_id,))
        d = curr.fetchone()
        profile["blood_type"] = d[0] if d else None

    elif role == "blood_bank":
        curr.execute("""
            SELECT blood_bank_id, bank_name, license_number, operating_hours, verified_status
            FROM BloodBanks WHERE user_id = ?
        """, (user_id,))
        b = curr.fetchone()
        if b:
            profile.update({
                "blood_bank_id": b[0], "bank_name": b[1], "license_number": b[2],
                "operating_hours": b[3], "verified_status": b[4]
            })

    return profile


@app.route("/profile/<int:user_id>", methods=["GET"])
@require_auth(allow=ALLOW_SELF_OR_ADMIN)
def get_profile(user_id):
    conn = None
    try:
        conn = db_connect()
        curr = conn.cursor()
        profile = load_profile(curr, user_id)
        curr.close()
        if profile is None:
            return jsonify({"message": "User not found."}), 404
        return jsonify(profile), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500

    finally:
        if conn:
            conn.close()


@app.route("/profile/<int:user_id>", methods=["PUT"])
@require_auth(allow=ALLOW_SELF)
def update_profile(user_id):
    conn = None
    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        # you can only edit your own profile
        if str(params.get("acting_user_id")) != str(user_id):
            return jsonify({"message": "You can only edit your own profile."}), 403

        conn = db_connect()
        curr = conn.cursor()

        current = load_profile(curr, user_id)
        if current is None:
            return jsonify({"message": "User not found."}), 404
        role = current["role"]

        # any field that wasn't sent keeps its current value
        fields = list(COMMON_PROFILE_FIELDS)
        if role == "member":
            fields += ["requester_type", "affiliated_hospital"]
        elif role == "blood_bank":
            fields += ["bank_name", "license_number", "operating_hours"]
        merged = {f: params[f] if f in params else current.get(f) for f in fields}
        merged["role"] = role

        error = validate_user_common(merged, require_password=False)
        if not error and role == "member":
            error = validate_requester_extra(merged)
        if not error and role == "blood_bank":
            error = validate_bloodbank_extra(merged)
        if error:
            return jsonify({"message": error}), 400

        # ---- re-verification: email / password changes need the current password ----
        new_email = merged["email"].strip()
        email_changed = new_email.lower() != str(current["email"]).lower()
        new_password = str(params.get("new_password") or "").strip()

        if new_password and not password_regex.fullmatch(new_password):
            return jsonify({"message": "New password must be at least 8 characters and include a letter and a number."}), 400

        if email_changed or new_password:
            curr.execute("SELECT password_hash FROM Users WHERE user_id = ?", (user_id,))
            hash_row = curr.fetchone()
            supplied = str(params.get("current_password") or "").strip()
            if not supplied or not check_password_hash(hash_row[0], supplied):
                return jsonify({"message": "Enter your current password to change your email or password."}), 403

        # ---- Users (everyone) ----
        sets = "full_name = ?, email = ?, contact_number = ?, address = ?, barangay = ?, city = ?"
        args = [merged["full_name"].strip(), new_email, merged["contact_number"].strip(),
                _clean(merged["address"]), _clean(merged["barangay"]), _clean(merged["city"])]
        if new_password:
            sets += ", password_hash = ?"
            args.append(generate_password_hash(new_password))
        curr.execute(f"UPDATE Users SET {sets} WHERE user_id = ?", tuple(args) + (user_id,))

        audit = []   # lines for AuditLogs
        if email_changed:
            audit.append(f"email changed ({current['email']} -> {new_email})")
        if new_password:
            audit.append("password changed")

        reverify = False

        # ---- member: requester details ----
        if role == "member":
            curr.execute("SELECT 1 FROM Requesters WHERE user_id = ?", (user_id,))
            if curr.fetchone():
                curr.execute("""
                    UPDATE Requesters SET requester_type = ?, affiliated_hospital = ?
                    WHERE user_id = ?
                """, (merged["requester_type"], _clean(merged["affiliated_hospital"]), user_id))
            else:
                curr.execute("""
                    INSERT INTO Requesters (user_id, requester_type, affiliated_hospital)
                    VALUES (?, ?, ?)
                """, (user_id, merged["requester_type"], _clean(merged["affiliated_hospital"])))

        # ---- blood bank: bank details, with re-verification for sensitive fields ----
        elif role == "blood_bank" and current.get("blood_bank_id"):
            changes = []
            for field, label in SENSITIVE_BANK_FIELDS.items():
                old, new = _clean(current.get(field)), _clean(merged.get(field))
                if old != new:
                    changes.append(f'{label} "{old or "none"}" -> "{new or "none"}"')

            curr.execute("""
                UPDATE BloodBanks SET bank_name = ?, license_number = ?, operating_hours = ?
                WHERE user_id = ?
            """, (merged["bank_name"].strip(), _clean(merged["license_number"]),
                  _clean(merged["operating_hours"]), user_id))

            if changes:
                bank_name = merged["bank_name"].strip()
                if current["verified_status"] == "verified":
                    curr.execute("UPDATE BloodBanks SET verified_status = 'pending' WHERE user_id = ?", (user_id,))
                    reverify = True
                    notify_admins(curr, f"Re-verification needed: {bank_name} changed its {'; '.join(changes)}."[:250])
                    send_notification(curr, user_id,
                                      "You changed your blood bank's sensitive details. It is pending "
                                      "re-verification by an admin, and inventory is read-only until then.")
                    audit.append("sensitive bank edit, verification reset to pending: " + "; ".join(changes))
                elif current["verified_status"] == "rejected":
                    curr.execute("UPDATE BloodBanks SET verified_status = 'pending' WHERE user_id = ?", (user_id,))
                    reverify = True
                    notify_admins(curr, f"Re-application: {bank_name} was rejected and changed its {'; '.join(changes)}. Needs verification."[:250])
                    send_notification(curr, user_id, "Thanks, your corrected details were sent to an admin for review.")
                    audit.append("rejected bank re-applied, verification reset to pending: " + "; ".join(changes))
                else:
                    notify_admins(curr, f"{bank_name} updated its {'; '.join(changes)} (status: {current['verified_status']})."[:250])
                    audit.append("sensitive bank edit: " + "; ".join(changes))

        # ---- admins are told when another admin changes their sign-in details ----
        if role == "admin" and (email_changed or new_password):
            what = " and ".join(x for x in ("email" if email_changed else "", "password" if new_password else "") if x)
            notify_admins(curr, f"Admin {merged['full_name'].strip()} changed their {what}.", exclude_user_id=user_id)

        if audit:
            curr.execute("""
                INSERT INTO AuditLogs (user_id, action_performed, details)
                VALUES (?, ?, ?)
            """, (user_id, "profile_update", "; ".join(audit)[:500]))

        conn.commit()

        message = "Profile updated."
        if reverify:
            message += " An admin must verify your blood bank before you can edit inventory."
        return jsonify({"message": message, "reverification_required": reverify}), 200

    except mariadb.IntegrityError:
        return jsonify({"message": "That email is already in use."}), 400

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500

    finally:
        if conn:
            conn.close()


# =====================================================================
# FORGOT / RESET PASSWORD
#   1. POST /forgot-password {email}      -> emails a one-hour reset link
#   2. POST /reset-password {token, new_password}
#   - The reply never says whether the email has an account.
#   - The link is signed, expires, and stops working once the password changes.
#   - Email goes out through SMTP when BLOODLINK_SMTP_HOST is set; otherwise the
#     link is printed in the server console (fine for development).
#       BLOODLINK_SMTP_HOST / _PORT (587) / _USER / _PASSWORD / _FROM
#       BLOODLINK_APP_URL   where the website lives (default http://localhost:5173)
# =====================================================================
RESET_HOURS = 1
RESET_COOLDOWN_SEC = 60
_reset_serializer = URLSafeTimedSerializer(SECRET_KEY, salt="bloodlink-password-reset")
_reset_last_sent = {}   # email -> time of the last reset email (simple per-process limit)
FORGOT_REPLY = "If that email has an active account, a reset link is on its way. It expires in 1 hour."


def send_email(to, subject, body):
    host = os.environ.get("BLOODLINK_SMTP_HOST")
    if not host:
        print(f"[email] SMTP not configured. Would send to {to}: {subject}\n{body}\n")
        return
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    msg["From"] = os.environ.get("BLOODLINK_SMTP_FROM") or os.environ.get("BLOODLINK_SMTP_USER") or "no-reply@bloodlink.local"
    msg.set_content(body)
    host = host.strip()
    port = int(os.environ.get("BLOODLINK_SMTP_PORT", "587").strip() or "587")
    user = (os.environ.get("BLOODLINK_SMTP_USER") or "").strip()
    password = (os.environ.get("BLOODLINK_SMTP_PASSWORD") or "").replace(" ", "")  # Google shows app passwords with spaces

    # port 465 is "SSL from the start"; 587 (and others) start plain and upgrade with STARTTLS
    if port == 465:
        smtp = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        smtp = smtplib.SMTP(host, port, timeout=20)
    try:
        if port != 465:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
        if user:
            smtp.login(user, password)
        smtp.send_message(msg)
    finally:
        try:
            smtp.quit()
        except Exception:
            pass


@app.route("/forgot-password", methods=["POST"])
def forgot_password():
    conn = None
    try:
        params = request.get_json(silent=True) or {}
        email = str(params.get("email", "")).strip()
        if not email or not email_regex.fullmatch(email):
            return jsonify({"message": "Enter a valid email address."}), 400

        key = email.lower()
        now = time.time()
        if now - _reset_last_sent.get(key, 0) < RESET_COOLDOWN_SEC:
            return jsonify({"message": FORGOT_REPLY}), 200   # same answer, no second email
        _reset_last_sent[key] = now

        conn = db_connect()
        curr = conn.cursor()
        curr.execute("SELECT user_id, full_name, password_hash, account_status FROM Users WHERE email = ?", (email,))
        row = curr.fetchone()

        if row is not None and row[3] == "active":
            token = _reset_serializer.dumps({"uid": int(row[0]), "h": row[2][-12:]})
            base = os.environ.get("BLOODLINK_APP_URL", "http://localhost:5173").rstrip("/")
            link = f"{base}/?reset={token}"
            try:
                send_email(email, "Reset your BloodLink password",
                           f"Hi {row[1]},\n\nUse this link to choose a new password. It expires in {RESET_HOURS} hour.\n\n"
                           f"{link}\n\nIf you didn't ask for this, you can ignore this email; your password stays the same.\n")
            except Exception as e:   # a mail problem must not reveal whether the account exists
                app.logger.error("Could not send reset email (SMTP host=%s port=%s): %s",
                                 os.environ.get("BLOODLINK_SMTP_HOST"), os.environ.get("BLOODLINK_SMTP_PORT", "587"), e)

        return jsonify({"message": FORGOT_REPLY}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/reset-password", methods=["POST"])
def reset_password():
    conn = None
    try:
        params = request.get_json(silent=True) or {}
        token = str(params.get("token", "")).strip()
        new_password = str(params.get("new_password", "")).strip()

        if not password_regex.fullmatch(new_password):
            return jsonify({"message": "Password must be at least 8 characters and include a letter and a number."}), 400

        bad_link = jsonify({"message": "This reset link is invalid or has expired. Please request a new one."}), 400
        try:
            data = _reset_serializer.loads(token, max_age=RESET_HOURS * 3600)
            uid = int(data["uid"])
        except (BadSignature, KeyError, ValueError, TypeError):
            return bad_link

        conn = db_connect()
        curr = conn.cursor()
        curr.execute("SELECT password_hash, account_status FROM Users WHERE user_id = ? FOR UPDATE", (uid,))
        row = curr.fetchone()
        # the link only works while the password is still the one it was made for (single use)
        if row is None or row[1] != "active" or row[0][-12:] != data.get("h"):
            return bad_link

        curr.execute("UPDATE Users SET password_hash = ? WHERE user_id = ?",
                     (generate_password_hash(new_password), uid))
        curr.execute("INSERT INTO AuditLogs (user_id, action_performed, details) VALUES (?, ?, ?)",
                     (uid, "password_reset", "password changed with an emailed reset link"))
        send_notification(curr, uid, "Your password was changed using a reset link. If this wasn't you, contact an admin.")
        conn.commit()
        return jsonify({"message": "Password updated. You can sign in now."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn:
            conn.close()


# =====================================================================
# DONOR PRELIMINARY ASSESSMENT
# This is not medical clearance; blood-bank staff make the final decision.
# =====================================================================
def ALLOW_ASSESSMENT(u, kw):
    donor_id = request.args.get("donor_id") if request.method == "GET" else _body().get("donor_id")
    return _owns_donor(u, donor_id)


@app.route("/donor-assessments", methods=["GET", "POST"])
@require_auth(allow=ALLOW_ASSESSMENT)
def donor_assessments():
    donor_id = request.args.get("donor_id") if request.method == "GET" else _body().get("donor_id")
    conn = None
    try:
        if request.method == "GET":
            row = _one("""SELECT assessment_id, age_at_assessment, weight_kg, has_fever_or_infection,
                                medical_history_disclosed, blood_pressure_review_acknowledged,
                                parental_consent, assessment_result, assessment_note, assessed_at
                        FROM donor_assessments WHERE donor_id = ? ORDER BY assessed_at DESC LIMIT 1""", (donor_id,))
            if not row:
                return jsonify(None), 200
            return jsonify({"assessment_id": row[0], "age": row[1], "weight_kg": float(row[2]),
                "has_fever_or_infection": bool(row[3]), "medical_history_disclosed": bool(row[4]),
                "blood_pressure_review_acknowledged": bool(row[5]), "parental_consent": bool(row[6]),
                "assessment_result": row[7], "assessment_note": row[8], "assessed_at": str(row[9])}), 200

        data = _body()
        try:
            age = int(data.get("age"))
            weight = float(data.get("weight_kg"))
        except (TypeError, ValueError):
            return jsonify({"message": "Enter a valid age and weight."}), 400
        if age < 1 or age > 120 or weight < 1 or weight > 400:
            return jsonify({"message": "Enter a valid age and weight."}), 400
        symptoms = bool(data.get("has_fever_or_infection"))
        history = bool(data.get("medical_history_disclosed"))
        bp_ack = bool(data.get("blood_pressure_review_acknowledged"))
        consent = bool(data.get("parental_consent"))
        if age < 16 or age > 60 or weight < 50 or symptoms:
            result = "not_eligible"
            note = "Based on your answers, do not create a donation post. Contact a qualified blood-bank professional if you need clarification."
        elif age < 18:
            result = "eligible_to_proceed" if consent and history and bp_ack else "not_eligible"
            note = "Donors aged 16–17 require written parent/guardian consent and blood-bank review. This is not medical clearance."
        elif not history or not bp_ack:
            result = "requires_review"
            note = "Complete the medical-history disclosure and blood-pressure screening acknowledgement."
        else:
            result = "eligible_to_proceed"
            note = "Preliminary screening only. Final eligibility is determined by blood-bank staff."
        conn = db_connect(); curr = conn.cursor()
        curr.execute("""INSERT INTO donor_assessments
            (donor_id, age_at_assessment, weight_kg, has_fever_or_infection,
             medical_history_disclosed, blood_pressure_review_acknowledged, parental_consent,
             assessment_result, assessment_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (donor_id, age, weight, int(symptoms), int(history), int(bp_ack), int(consent), result, note))
        conn.commit()
        return jsonify({"assessment_result": result, "assessment_note": note}), 201
    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn: conn.close()


# =====================================================================
# DONOR POSTS: "I can donate" offers
#   A donor posts a short offer that stays open until a date they choose (max 30 days).
#   Requesters, blood banks and admins can browse open offers. Contact details are NOT
#   shown: a requester reaches a donor through the normal match request, so the donor
#   still gets to accept or decline.
# =====================================================================
POST_MAX_DAYS = 30


def _owns_donor_post(u, post_id):
    if _admin(u):
        return True
    return _one("""
        SELECT 1 FROM DonorPosts p JOIN Donors d ON p.donor_id = d.donor_id
        WHERE p.post_id = ? AND d.user_id = ?
    """, (post_id, u["uid"])) is not None


def ALLOW_POST_NEW(u, kw):
    return _owns_donor(u, _body().get("donor_id"))


def ALLOW_POST_MINE(u, kw):
    return _owns_donor(u, request.args.get("donor_id"))


def ALLOW_POST_UPDATE(u, kw):
    return _owns_donor_post(u, kw["post_id"])


@app.route("/donor-posts", methods=["POST"])
@require_auth(allow=ALLOW_POST_NEW)
def create_donor_post():
    conn = None
    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        donor_id = params.get("donor_id")
        note = _clean(params.get("note"))
        if note and len(note) > 255:
            return jsonify({"message": "Keep your note under 255 characters."}), 400

        try:
            until = datetime.strptime(str(params.get("available_until", "")).strip(), "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"message": "Choose the date you can donate until."}), 400
        today = datetime.now().date()
        if until < today:
            return jsonify({"message": "That date has already passed."}), 400
        if (until - today).days > POST_MAX_DAYS:
            return jsonify({"message": f"Posts can stay open for up to {POST_MAX_DAYS} days."}), 400

        conn = db_connect()
        curr = conn.cursor()

        # PHASE 3: also reads last_donation_date so the rest period counts
        curr.execute("""
            SELECT d.user_id, d.eligibility_status, u.full_name, bt.blood_type, d.last_donation_date
            FROM Donors d
            JOIN Users u ON d.user_id = u.user_id
            JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
            WHERE d.donor_id = ?
        """, (donor_id,))
        donor = curr.fetchone()
        if donor is None:
            return jsonify({"message": "Donor profile not found."}), 404
        if effective_eligibility(donor[1], donor[4]) != "eligible":
            nxt = next_eligible_on(donor[4])
            when_text = f" on {nxt.isoformat()}" if nxt and in_rest_period(donor[4]) else ""
            return jsonify({"message": f"You can post once you are eligible to donate again{when_text}."}), 400

        curr.execute("""SELECT assessment_result FROM DonorAssessments
                        WHERE donor_id = ? ORDER BY assessed_at DESC LIMIT 1""", (donor_id,))
        assessment = curr.fetchone()
        if not assessment or assessment[0] != "eligible_to_proceed":
            return jsonify({"message": "Complete the preliminary donor assessment and meet its requirements before creating a post."}), 400

        curr.execute("""
            SELECT 1 FROM DonorPosts
            WHERE donor_id = ? AND status = 'open' AND available_until >= CURDATE() LIMIT 1
        """, (donor_id,))
        if curr.fetchone():
            return jsonify({"message": "You already have an open post. Close it before posting a new one."}), 400

        curr.execute("""
            INSERT INTO DonorPosts (donor_id, note, available_until)
            VALUES (?, ?, ?)
        """, (donor_id, note, until))
        post_id = curr.lastrowid

        # posting an offer means "I'm available"
        curr.execute("UPDATE Donors SET availability_status = 'available' WHERE donor_id = ?", (donor_id,))

        conn.commit()
        return jsonify({"message": "Your offer is posted.", "post_id": post_id}), 201

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/donor-posts", methods=["GET"])
@require_auth(allow=ALLOW_POST_MINE)
def get_my_donor_posts():
    """a donor's own posts, newest first"""
    conn = None
    try:
        conn = db_connect()
        curr = conn.cursor()
        curr.execute("""
            SELECT post_id, note, available_until, status, created_at, approval_status, rejection_reason,
                   (status = 'open' AND available_until >= CURDATE() AND approval_status = 'approved') AS is_live
            FROM DonorPosts WHERE donor_id = ?
            ORDER BY post_id DESC LIMIT 20
        """, (request.args.get("donor_id"),))
        rows = curr.fetchall()
        return jsonify([{
            "post_id": r[0], "note": r[1], "available_until": str(r[2]),
            "status": r[3] if (r[3] != "open" or r[2] >= datetime.now().date()) else "expired",
            "created_at": str(r[4]), "approval_status": r[5], "rejection_reason": r[6], "is_live": bool(r[7])
        } for r in rows]), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn:
            conn.close()


# PHASE 3: donors in their rest period are not listed
@app.route("/donor-posts/open", methods=["GET"])
@require_auth()
def get_open_donor_posts():
    """open offers from donors who are still eligible and available. No contact details."""
    conn = None
    try:
        conn = db_connect()
        curr = conn.cursor()
        curr.execute(f"""
            SELECT p.post_id, u.full_name, bt.blood_type, u.barangay, u.city,
                   p.note, p.available_until, p.created_at, u.user_id
            FROM DonorPosts p
            JOIN Donors d ON p.donor_id = d.donor_id
            JOIN Users u ON d.user_id = u.user_id
            JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
            WHERE p.status = 'open' AND p.approval_status = 'approved' AND p.available_until >= CURDATE()
              AND d.availability_status = 'available' AND d.eligibility_status = 'eligible'
              AND {REST_OK_SQL}
              AND u.account_status = 'active'
            ORDER BY p.post_id DESC LIMIT 100
        """)
        rows = curr.fetchall()
        me = g.user["uid"]
        return jsonify([{
            "post_id": r[0], "donor_name": r[1], "blood_type": r[2],
            "barangay": r[3], "city": r[4], "note": r[5],
            "available_until": str(r[6]), "created_at": str(r[7])
        } for r in rows if r[8] != me]), 200   # your own offer isn't listed back to you

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/donor-posts/<int:post_id>", methods=["PUT"])
@require_auth(allow=ALLOW_POST_UPDATE)
def close_donor_post(post_id):
    """the only change allowed is closing a post"""
    conn = None
    try:
        data = request.get_json(silent=True) or {}
        conn = db_connect()
        curr = conn.cursor()
        if str(data.get("status", "")).strip() == "closed":
            curr.execute("UPDATE DonorPosts SET status='closed' WHERE post_id=?", (post_id,))
            message = "Post closed."
        elif "note" in data or "available_until" in data:
            curr.execute("SELECT donor_id, approval_status FROM DonorPosts WHERE post_id=?", (post_id,))
            existing = curr.fetchone()
            if not existing:
                return jsonify({"message": "Post not found."}), 404
            note = _clean(data.get("note", ""))
            if note and len(note) > 255:
                return jsonify({"message": "Keep your note under 255 characters."}), 400
            try:
                until = datetime.strptime(str(data.get("available_until", "")).strip(), "%Y-%m-%d").date()
            except ValueError:
                return jsonify({"message": "Choose a valid availability date."}), 400
            today = datetime.now().date()
            if until < today or (until - today).days > POST_MAX_DAYS:
                return jsonify({"message": f"Choose a date between today and {POST_MAX_DAYS} days from today."}), 400
            curr.execute("UPDATE DonorPosts SET note=?, available_until=?, approval_status='pending', reviewed_by=NULL, reviewed_at=NULL, rejection_reason=NULL WHERE post_id=?", (note, until, post_id))
            message = "Post updated and sent for approval again."
        else:
            return jsonify({"message": "No supported changes provided."}), 400
        if curr.rowcount == 0:
            return jsonify({"message": "Post not found or unchanged."}), 404
        conn.commit()
        return jsonify({"message": message}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/donor-posts/<int:post_id>", methods=["DELETE"])
@require_auth(allow=ALLOW_POST_UPDATE)
def delete_donor_post(post_id):
    conn=None
    try:
        conn=db_connect(); curr=conn.cursor()
        curr.execute("DELETE FROM DonorPosts WHERE post_id=?", (post_id,))
        if curr.rowcount == 0:
            return jsonify({"message":"Post not found."}),404
        conn.commit()
        return jsonify({"message":"Post deleted."}),200
    except mariadb.Error as e:
        return jsonify({"message":"Database error.","error":_log_db_error(e)}),500
    finally:
        if conn: conn.close()


# =====================================================================
# DONOR POST MODERATION (admin and blood-bank staff)
# =====================================================================
@app.route("/admin/donor-posts", methods=["GET"])
@require_auth("admin", "blood_bank")
def review_donor_posts_queue():
    conn = None
    try:
        conn = db_connect(); curr = conn.cursor()
        curr.execute("""SELECT p.post_id, p.donor_id, p.note, p.available_until, p.status,
                       p.created_at, p.approval_status, p.rejection_reason, u.full_name,
                       bt.blood_type, u.barangay, u.city
                    FROM DonorPosts p JOIN Donors d ON p.donor_id=d.donor_id
                    JOIN Users u ON d.user_id=u.user_id JOIN BloodTypes bt ON d.blood_type_id=bt.blood_type_id
                    WHERE p.approval_status='pending' ORDER BY p.created_at ASC""")
        rows=curr.fetchall()
        return jsonify([{"post_id":r[0],"donor_id":r[1],"note":r[2],"available_until":str(r[3]),
            "status":r[4],"created_at":str(r[5]),"approval_status":r[6],"rejection_reason":r[7],
            "donor_name":r[8],"blood_type":r[9],"barangay":r[10],"city":r[11]} for r in rows]),200
    except mariadb.Error as e:
        return jsonify({"message":"Database error.","error":_log_db_error(e)}),500
    finally:
        if conn: conn.close()

@app.route("/admin/donor-posts/<int:post_id>/review", methods=["PUT"])
@require_auth("admin", "blood_bank")
def review_donor_post(post_id):
    data=_body(); decision=str(data.get("decision", "")).strip().lower()
    reason=_clean(data.get("rejection_reason"))
    if decision not in ("approved", "rejected"):
        return jsonify({"message":"Choose approve or reject."}),400
    if decision == "rejected" and not reason:
        return jsonify({"message":"Please provide a reason when rejecting a post."}),400
    conn=None
    try:
        conn=db_connect(); curr=conn.cursor()
        curr.execute("""UPDATE DonorPosts SET approval_status=?, reviewed_by=?, reviewed_at=NOW(),
                    rejection_reason=? WHERE post_id=? AND approval_status='pending'""",
                    (decision,g.user["uid"],reason if decision=="rejected" else None,post_id))
        if curr.rowcount == 0:
            return jsonify({"message":"Pending post not found; it may already have been reviewed."}),404
        conn.commit()
        return jsonify({"message":f"Donation post {decision} successfully."}),200
    except mariadb.Error as e:
        return jsonify({"message":"Database error.","error":_log_db_error(e)}),500
    finally:
        if conn: conn.close()


# =====================================================================
# NEW: APPOINTMENTS
# =====================================================================
def _fmt_when(dt):
    return dt.strftime("%b %d, %Y at %I:%M %p")


@app.route("/appointments", methods=["POST"])
@require_auth("blood_bank", "admin", allow=ALLOW_BANK_IN_BODY)
def create_appointment():
    conn = None
    try:
        params = request.get_json()
        if not params:
            return jsonify({"message": "No data received."}), 400

        donor_id = params.get("donor_id")
        blood_bank_id = params.get("blood_bank_id")
        raw = str(params.get("scheduled_at", "")).strip().replace("T", " ")
        if not donor_id or not blood_bank_id or not raw:
            return jsonify({"message": "Donor, blood bank and date/time are required."}), 400

        try:
            when = datetime.strptime(raw[:16], "%Y-%m-%d %H:%M")
        except ValueError:
            return jsonify({"message": "Date and time are not valid."}), 400
        if when <= datetime.now():
            return jsonify({"message": "Pick a time in the future."}), 400

        notes = _clean(params.get("notes"))
        notes = notes[:255] if notes else None

        conn = db_connect()
        curr = conn.cursor()

        curr.execute("SELECT bank_name, verified_status FROM BloodBanks WHERE blood_bank_id = ?", (blood_bank_id,))
        bank = curr.fetchone()
        if bank is None:
            return jsonify({"message": "Blood bank not found."}), 404
        if bank[1] != "verified":
            return jsonify({"message": "Appointments can only be booked at a verified blood bank."}), 403

        # PHASE 3: the appointment must fall on or after the donor's next eligible date
        curr.execute("SELECT user_id, last_donation_date FROM Donors WHERE donor_id = ?", (donor_id,))
        donor = curr.fetchone()
        if donor is None:
            return jsonify({"message": "Donor not found."}), 404
        nxt = next_eligible_on(donor[1])
        if nxt and when.date() < nxt:
            return jsonify({"message": f"This donor can donate again on {nxt.isoformat()}. "
                                       f"Pick a date on or after that."}), 400

        curr.execute("""
            SELECT 1 FROM Appointments
            WHERE donor_id = ? AND blood_bank_id = ? AND status = 'scheduled' LIMIT 1
        """, (donor_id, blood_bank_id))
        if curr.fetchone():
            return jsonify({"message": "This donor already has a scheduled appointment here. Cancel it first."}), 400

        curr.execute("""
            INSERT INTO Appointments (donor_id, blood_bank_id, scheduled_at, notes)
            VALUES (?, ?, ?, ?)
        """, (donor_id, blood_bank_id, when, notes))
        appointment_id = curr.lastrowid

        send_notification(curr, donor[0], f"Appointment booked at {bank[0]} on {_fmt_when(when)}.")
        conn.commit()
        return jsonify({"message": "Appointment booked.", "appointment_id": appointment_id}), 201

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn:
            conn.close()


@app.route("/appointments", methods=["GET"])
@require_auth(allow=ALLOW_SCOPED_LIST)
def get_appointments():
    conn = None
    try:
        conn = db_connect()
        curr = conn.cursor()
        query = """
            SELECT a.appointment_id, a.donor_id, u.full_name, bt.blood_type,
                   a.blood_bank_id, bb.bank_name, a.scheduled_at, a.status, a.notes
            FROM Appointments a
            JOIN Donors d ON a.donor_id = d.donor_id
            JOIN Users u ON d.user_id = u.user_id
            JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
            JOIN BloodBanks bb ON a.blood_bank_id = bb.blood_bank_id
        """
        conds, args = [], []
        for arg, col in (("blood_bank_id", "a.blood_bank_id"), ("donor_id", "a.donor_id"), ("status", "a.status")):
            if request.args.get(arg):
                conds.append(f"{col} = ?")
                args.append(request.args.get(arg))
        if conds:
            query += " WHERE " + " AND ".join(conds)
        query += " ORDER BY a.scheduled_at ASC"

        curr.execute(query, tuple(args))
        rows = curr.fetchall()
        curr.close()
        return jsonify([{
            "appointment_id": r[0], "donor_id": r[1], "donor_name": r[2], "blood_type": r[3],
            "blood_bank_id": r[4], "bank_name": r[5], "scheduled_at": str(r[6]),
            "status": r[7], "notes": r[8]
        } for r in rows]), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn:
            conn.close()


# PHASE 3: completing an appointment now records the donation (the bank dashboard already
# sends `units` and says "donation recorded"), which starts the donor's rest period.
@app.route("/appointments/<int:appointment_id>", methods=["PUT"])
@require_auth(allow=ALLOW_APPOINTMENT_UPDATE)
def update_appointment(appointment_id):
    conn = None
    try:
        params = request.get_json(silent=True) or {}
        status = str(params.get("status", "")).strip()
        if status not in ("cancelled", "no_show", "completed"):
            return jsonify({"message": "Status must be cancelled, no_show or completed."}), 400

        units = None
        if status == "completed":
            units = parse_units(params.get("units", ""))
            if units is None:
                return jsonify({"message": "Units collected " + UNIT_RULE_MSG}), 400

        conn = db_connect()
        curr = conn.cursor()
        curr.execute("""
            SELECT a.status, a.scheduled_at, d.user_id, bb.bank_name, a.donor_id, a.blood_bank_id
            FROM Appointments a
            JOIN Donors d ON a.donor_id = d.donor_id
            JOIN BloodBanks bb ON a.blood_bank_id = bb.blood_bank_id
            WHERE a.appointment_id = ?
        """, (appointment_id,))
        row = curr.fetchone()
        if row is None:
            return jsonify({"message": "Appointment not found."}), 404
        if row[0] != "scheduled":
            return jsonify({"message": f"This appointment is already {row[0]}."}), 400

        curr.execute("UPDATE Appointments SET status = ? WHERE appointment_id = ?", (status, appointment_id))

        if status == "cancelled":
            send_notification(curr, row[2], f"Your appointment at {row[3]} on {_fmt_when(row[1])} was cancelled.")

        elif status == "completed":
            curr.execute("""
                INSERT INTO Donations (donor_id, blood_bank_id, volume_ml, status, remarks)
                VALUES (?, ?, ?, 'completed', 'Recorded from appointment')
            """, (row[4], row[5], int(units * UNIT_ML)))
            curr.execute("UPDATE Donors SET last_donation_date = CURDATE() WHERE donor_id = ?", (row[4],))
            send_notification(
                curr, row[2],
                f"Thank you for donating at {row[3]}! You can donate again after "
                f"{(date.today() + timedelta(days=DONATION_INTERVAL_DAYS)).strftime('%b %d, %Y')}."
            )

        conn.commit()
        return jsonify({"message": "Appointment updated."}), 200

    except mariadb.Error as e:
        return jsonify({"message": "Database error.", "error": _log_db_error(e)}), 500
    finally:
        if conn:
            conn.close()


def migrate_to_member_accounts():
    """Runs automatically when the server starts. Safe to run many times:
       it only changes things that still need changing."""
    conn = None
    try:
        conn = db_connect()
        curr = conn.cursor()

        # 1. let Users.role accept 'member' (only if role is an ENUM that lacks it)
        curr.execute("""
            SELECT COLUMN_TYPE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'role'
        """)
        row = curr.fetchone()
        if row and str(row[0]).lower().startswith("enum") and "'member'" not in str(row[0]):
            curr.execute("""
                ALTER TABLE Users
                MODIFY role ENUM('donor','requester','member','blood_bank','admin') NOT NULL
            """)
            print("[migrate] Users.role now accepts 'member'")

        # 2. one donor profile and one requester profile per user
        #    (fails harmlessly if a user has duplicate profile rows; clean those up first)
        for table, index in (("Donors", "uq_donors_user"), ("Requesters", "uq_requesters_user")):
            try:
                curr.execute(f"ALTER TABLE {table} ADD UNIQUE INDEX IF NOT EXISTS {index} (user_id)")
            except mariadb.Error as e:
                print(f"[migrate] could not add unique index on {table}.user_id: {e}")

        # 3. give every existing donor a requester profile
        curr.execute("""
            INSERT INTO Requesters (user_id, requester_type)
            SELECT u.user_id, 'individual'
            FROM Users u
            LEFT JOIN Requesters r ON r.user_id = u.user_id
            WHERE u.role = 'donor' AND r.user_id IS NULL
        """)

        # 4. convert old roles to member
        curr.execute("UPDATE Users SET role = 'member' WHERE role IN ('donor', 'requester')")
        if curr.rowcount:
            print(f"[migrate] converted {curr.rowcount} user(s) to 'member'")

        # 5. allow half units in requests (0.5, 1.5, ...): quantity must be a decimal column
        curr.execute("""
            SELECT DATA_TYPE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BloodRequests'
              AND COLUMN_NAME = 'quantity_needed'
        """)
        row = curr.fetchone()
        if row and str(row[0]).lower() != "decimal":
            curr.execute("ALTER TABLE BloodRequests MODIFY quantity_needed DECIMAL(6,1) NOT NULL")
            print("[migrate] BloodRequests.quantity_needed is now DECIMAL(6,1)")

        # 6. blood bank inventory is counted in the same units (decimal, not integer)
        curr.execute("""
            SELECT DATA_TYPE FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BloodBankInventory'
              AND COLUMN_NAME = 'units_available'
        """)
        row = curr.fetchone()
        if row and str(row[0]).lower() != "decimal":
            curr.execute("ALTER TABLE BloodBankInventory MODIFY units_available DECIMAL(6,1) NOT NULL DEFAULT 0")
            print("[migrate] BloodBankInventory.units_available is now DECIMAL(6,1)")

        # 7. inventory audit log: who changed which stock, old/new values, and when.
        #    No foreign keys on purpose: log rows must survive even if a user or bank is removed.
        curr.execute("""
            CREATE TABLE IF NOT EXISTS InventoryAuditLog (
                audit_id      INT AUTO_INCREMENT PRIMARY KEY,
                blood_bank_id INT NOT NULL,
                blood_type_id INT NOT NULL,
                changed_by    INT NULL,
                old_units     DECIMAL(6,1) NOT NULL,
                new_units     DECIMAL(6,1) NOT NULL,
                change_units  DECIMAL(6,1) NOT NULL,
                reason        VARCHAR(255) NULL,
                source        VARCHAR(30) NOT NULL DEFAULT 'manual',
                changed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_audit_bank_time (blood_bank_id, changed_at),
                INDEX idx_audit_user (changed_by)
            )
        """)

        # 8. NEW: appointments
        curr.execute("""
            CREATE TABLE IF NOT EXISTS Appointments (
                appointment_id INT AUTO_INCREMENT PRIMARY KEY,
                donor_id       INT NOT NULL,
                blood_bank_id  INT NOT NULL,
                scheduled_at   DATETIME NOT NULL,
                status         ENUM('scheduled','completed','cancelled','no_show') NOT NULL DEFAULT 'scheduled',
                notes          VARCHAR(255) NULL,
                created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_appt_bank_time (blood_bank_id, scheduled_at),
                INDEX idx_appt_donor (donor_id)
            )
        """)

        # 9. NEW: donor posts ("I can donate" offers)
        curr.execute("""
            CREATE TABLE IF NOT EXISTS DonorPosts (
                post_id         INT AUTO_INCREMENT PRIMARY KEY,
                donor_id        INT NOT NULL,
                note            VARCHAR(255) NULL,
                available_until DATE NOT NULL,
                status          ENUM('open','closed') NOT NULL DEFAULT 'open',
                created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_post_donor (donor_id, status),
                INDEX idx_post_open (status, available_until)
            )
        """)

        # 9A. Donor preliminary assessment and moderation fields (safe upgrades for existing installs)
        for col, ddl in (
            ("approval_status", "ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'"),
            ("reviewed_by", "INT NULL"),
            ("reviewed_at", "DATETIME NULL"),
            ("rejection_reason", "VARCHAR(500) NULL"),
            ("updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ):
            try:
                curr.execute(f"ALTER TABLE DonorPosts ADD COLUMN IF NOT EXISTS {col} {ddl}")
            except mariadb.Error as e:
                print(f"[migrate] could not add DonorPosts.{col}: {e}")
        try:
            curr.execute("CREATE INDEX idx_donorposts_approval ON DonorPosts (approval_status, created_at)")
        except mariadb.Error:
            pass
        try:
            curr.execute("ALTER TABLE DonorPosts ADD CONSTRAINT fk_donorposts_reviewer FOREIGN KEY (reviewed_by) REFERENCES Users(user_id) ON DELETE SET NULL")
        except mariadb.Error:
            pass
        curr.execute("""
            SELECT 1 FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = DATABASE() 
              AND TABLE_NAME IN ('donor_assessments', 'donorassessments')
        """)
        if not curr.fetchone():
            curr.execute("""
                CREATE TABLE IF NOT EXISTS donor_assessments (
                    assessment_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    donor_id INT NOT NULL,
                    age_at_assessment INT NOT NULL,
                    weight_kg DECIMAL(5,1) NOT NULL,
                    has_fever_or_infection TINYINT(1) NOT NULL,
                    medical_history_disclosed TINYINT(1) NOT NULL,
                    blood_pressure_review_acknowledged TINYINT(1) NOT NULL,
                    parental_consent TINYINT(1) NOT NULL DEFAULT 0,
                    assessment_result ENUM('eligible_to_proceed','requires_review','not_eligible') NOT NULL DEFAULT 'requires_review',
                    assessment_note VARCHAR(500) NULL,
                    assessed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_assessment_donor (donor_id, assessed_at),
                    CONSTRAINT fk_assessment_donor FOREIGN KEY (donor_id) REFERENCES Donors(donor_id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
            """)

        # 10. PHASE 3: emergency (critical) flag needs a human decision
        for col, ddl in (
            ("critical_status", "ENUM('none','pending','confirmed','rejected') NOT NULL DEFAULT 'none'"),
            ("critical_reason", "VARCHAR(255) NULL"),
            ("critical_reviewed_by", "INT NULL"),
            ("critical_reviewed_at", "DATETIME NULL"),
        ):
            try:
                curr.execute(f"ALTER TABLE BloodRequests ADD COLUMN IF NOT EXISTS {col} {ddl}")
            except mariadb.Error as e:
                print(f"[migrate] could not add BloodRequests.{col}: {e}")

        # open requests that were self-labelled critical before review existed go back into the review queue
        curr.execute("""
            UPDATE BloodRequests
            SET urgency_level = 'high', critical_status = 'pending',
                critical_reason = 'Marked critical before review was required'
            WHERE urgency_level = 'critical' AND critical_status = 'none'
              AND status IN ('pending', 'matched')
        """)

        conn.commit()
        curr.close()
    except mariadb.Error as e:
        print(f"[migrate] skipped because of a database error: {e}")
    finally:
        if conn:
            conn.close()


def create_admin_cli():
    """python bloodlink_1.py create-admin   (the only way to create an admin)"""
    print("Create a BloodLink admin account")
    full_name = input("Full name: ").strip()
    email = input("Email: ").strip()
    contact = input("Contact number (09XXXXXXXXX): ").strip()
    password = getpass("Password (min 8, letter + number): ").strip()

    if not name_regex.fullmatch(full_name):
        sys.exit("Invalid name.")
    if not email_regex.fullmatch(email):
        sys.exit("Invalid email.")
    if not contact_regex.fullmatch(contact):
        sys.exit("Invalid contact number.")
    if not password_regex.fullmatch(password):
        sys.exit("Password must be at least 8 characters with a letter and a number.")

    conn = db_connect()
    try:
        curr = conn.cursor()
        curr.execute("""
            INSERT INTO Users (full_name, email, password_hash, contact_number, role, account_status)
            VALUES (?, ?, ?, ?, 'admin', 'active')
        """, (full_name, email, generate_password_hash(password), contact))
        curr.execute("INSERT INTO Admins (user_id, permission_level) VALUES (?, 'staff')", (curr.lastrowid,))
        conn.commit()
        print("Admin created. You can log in now.")
    except mariadb.IntegrityError:
        sys.exit("That email is already registered.")
    finally:
        conn.close()


if __name__ == "__main__":

    if len(sys.argv) > 1 and sys.argv[1] == "create-admin":
        create_admin_cli()
        sys.exit(0)

    migrate_to_member_accounts()

    # debug mode exposes an interactive console: keep it off unless you turn it on yourself
    app.run(
        host=os.environ.get("BLOODLINK_HOST", "127.0.0.1"),
        port=5000,
        debug=os.environ.get("BLOODLINK_DEBUG") == "1"
    )