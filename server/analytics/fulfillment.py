"""
Flask routes for the Blood Request Fulfillment decision tree.

    GET  /analytics/fulfillment/model         tree structure, metrics, feature importance
    GET  /analytics/fulfillment/predictions   fulfilment probability for every OPEN request
    POST /analytics/fulfillment/retrain       (admin) retrain, body: {"source": "synthetic"|"db"}

Registered from bloodlink.py with register_fulfillment_routes(...).
"""
import os, sys, json, subprocess, traceback
from functools import wraps
from datetime import datetime
import joblib
import pandas as pd
from flask import jsonify, request

try:                                    # imported as a package from bloodlink.py
    from .features import (FEATURES, LABELS, QUESTIONS, WINDOW_HOURS, BINARY_FEATURES,
                           COUNT_FEATURES, band, split_labels, build_features)
except ImportError:                     # run as a plain script
    from features import (FEATURES, LABELS, QUESTIONS, WINDOW_HOURS, BINARY_FEATURES,
                      COUNT_FEATURES, band, split_labels, build_features)

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "models", "fulfillment_tree.joblib")
JSON_PATH = os.path.join(HERE, "models", "fulfillment_tree.json")

_cache = {"mtime": None, "clf": None}
TRAIN_SCRIPT = os.path.join(HERE, "train_fulfillment_tree.py")


def _train(source="synthetic"):
    """Runs the trainer with THIS machine's Python / scikit-learn. Returns (ok, output)."""
    res = subprocess.run([sys.executable, TRAIN_SCRIPT, "--source", source],
                         cwd=HERE, capture_output=True, text=True, timeout=180)
    return res.returncode == 0, (res.stderr or res.stdout).strip()


def _load_model():
    """Loads the saved model. If the file is missing, or was saved by a different
    scikit-learn version and cannot be read, it is retrained automatically (once)."""
    for attempt in (1, 2):
        if os.path.exists(MODEL_PATH):
            try:
                m = os.path.getmtime(MODEL_PATH)
                if _cache["mtime"] != m:
                    _cache["clf"], _cache["mtime"] = joblib.load(MODEL_PATH), m
                names = getattr(_cache["clf"], "feature_names_in_", None)
                if names is not None and list(names) != FEATURES:
                    raise ValueError("saved model was trained on different features (old version)")
                return _cache["clf"]
            except Exception as e:                       # incompatible / corrupt file
                print("[analytics] could not read the saved model:", repr(e))
        if attempt == 1:
            print("[analytics] retraining the model on synthetic data ...")
            ok, out = _train()
            if not ok:
                print("[analytics] retrain failed:", out[-500:])
                break
    return None


def _safe(fn):
    """Turns any unexpected error into a readable JSON message (shown in the dashboard)."""
    @wraps(fn)
    def wrapper(*a, **k):
        try:
            return fn(*a, **k)
        except Exception as e:
            traceback.print_exc()
            return jsonify({"message": f"Analytics error: {type(e).__name__}: {e}"}), 500
    return wrapper


def _load_donors(curr):
    curr.execute("""
        SELECT bt.blood_type, d.latitude, d.longitude, d.user_id
        FROM Donors d
        JOIN Users u ON d.user_id = u.user_id
        JOIN BloodTypes bt ON d.blood_type_id = bt.blood_type_id
        WHERE u.account_status = 'active'
          AND d.availability_status = 'available'
          AND d.eligibility_status = 'eligible'
          AND (d.last_donation_date IS NULL
               OR d.last_donation_date <= DATE_SUB(CURDATE(), INTERVAL 56 DAY))
    """)
    return [{"type": r[0],
             "lat": float(r[1]) if r[1] is not None else None,
             "lon": float(r[2]) if r[2] is not None else None,
             "user_id": r[3]} for r in curr.fetchall()]


def _load_stock(curr):
    """Units on hand per exact blood type, verified banks only."""
    curr.execute("""
        SELECT bt.blood_type, COALESCE(SUM(i.units_available), 0)
        FROM BloodBankInventory i
        JOIN BloodBanks b ON i.blood_bank_id = b.blood_bank_id
        JOIN BloodTypes bt ON i.blood_type_id = bt.blood_type_id
        WHERE b.verified_status = 'verified'
        GROUP BY bt.blood_type
    """)
    return {r[0]: float(r[1]) for r in curr.fetchall()}


def _request_features(row, donors, stock, compat, haversine_km):
    """row = (request_id, requester_user_id, blood_type, qty, urgency, lat, lon,
             critical_status, date_requested)"""
    (_, requester_uid, btype, qty, urgency, lat, lon, crit, requested_at) = row
    can_give = [t for t, targets in compat.items() if btype in targets] or [btype]
    dists = []
    for d in donors:
        if d["type"] in can_give and d["user_id"] != requester_uid:
            dists.append(haversine_km(float(lat) if lat is not None else None,
                                      float(lon) if lon is not None else None,
                                      d["lat"], d["lon"]))
    compat_stock = sum(stock.get(t, 0) for t in can_give)       # any compatible type counts
    return build_features(urgency, qty, btype, dists, compat_stock, crit, requested_at)


REQUEST_SQL = """
    SELECT r.request_id, req.user_id, bt.blood_type, r.quantity_needed, r.urgency_level,
           r.latitude, r.longitude, r.critical_status, r.date_requested,
           u.full_name, r.hospital_name, r.status, r.fulfilled_at
    FROM BloodRequests r
    JOIN BloodTypes bt ON r.blood_type_id = bt.blood_type_id
    JOIN Requesters req ON r.requester_id = req.requester_id
    JOIN Users u ON req.user_id = u.user_id
"""


def fetch_training_rows(curr, compat, haversine_km):
    """
    Training table from requests whose 24-hour outcome is already known:
      fulfilled, with fulfilled_at         -> 1 if fulfilled_at - date_requested <= 24 h, else 0
      cancelled                            -> 0
      still open but older than 24 hours   -> 0
    Fulfilled rows with no fulfilled_at (made before that column existed) are skipped.
    CAVEAT: donor supply and stock are measured NOW, not when the request was made, so
    this is an approximation. Saving a snapshot at request time would give a cleaner dataset.
    """
    donors, stock = _load_donors(curr), _load_stock(curr)
    curr.execute(REQUEST_SQL)
    now, rows = datetime.now(), []
    for r in curr.fetchall():
        requested, status, done = r[8], r[11], r[12]
        if status == "fulfilled":
            if done is None:
                continue
            label = 1 if (done - requested).total_seconds() <= WINDOW_HOURS * 3600 else 0
        elif status == "cancelled":
            label = 0
        elif (now - requested).total_seconds() > WINDOW_HOURS * 3600:
            label = 0
        else:
            continue                      # open and still inside its window: outcome unknown
        f = _request_features(r[:9], donors, stock, compat, haversine_km)
        f["fulfilled_24h"] = label
        rows.append(f)
    return pd.DataFrame(rows, columns=FEATURES + ["fulfilled_24h"])


def _explain(clf, x_row):
    """Readable decision path for one request, plus the node ids to highlight."""
    t = clf.tree_
    X = pd.DataFrame([x_row], columns=FEATURES)
    node_ids = clf.decision_path(X).indices.tolist()
    steps = []
    for nid in node_ids:
        if t.children_left[nid] == t.children_right[nid]:
            continue
        f = FEATURES[t.feature[nid]]
        val, thr = x_row[f], float(t.threshold[nid])
        went_left = val <= thr
        left_lbl, right_lbl = split_labels(f, thr)
        if f in BINARY_FEATURES:
            no_text, yes_text = BINARY_FEATURES[f]
            text = f"{LABELS[f]}: {'Yes' if val else 'No'}"
        elif f in COUNT_FEATURES:
            text = f"{LABELS[f]}: {int(val)}  ({left_lbl if went_left else right_lbl})"
        else:
            text = f"{LABELS[f]}: {round(float(val), 2)}  ({left_lbl if went_left else right_lbl})"
        steps.append({
            "node_id": int(nid), "label": LABELS[f], "value": round(float(val), 2),
            "threshold": round(thr, 2),
            "went": "left" if went_left else "right",
            "text": text,
        })
    return node_ids, steps


def risk_band(p):
    return band(p)


def register_fulfillment_routes(app, require_auth, db_connect, COMPATIBILITY,
                                haversine_km, log_db_error):
    import mariadb

    @app.route("/analytics/fulfillment/model", methods=["GET"])
    @require_auth("admin", "blood_bank")
    @_safe
    def fulfillment_model():
        stale = False
        if os.path.exists(JSON_PATH):
            try:
                with open(JSON_PATH, encoding="utf-8") as f:
                    stale = json.load(f).get("features") != FEATURES
            except Exception:
                stale = True
        if stale or not os.path.exists(JSON_PATH):
            ok, out = _train()
            if not ok:
                return jsonify({"message": "Model not trained yet and automatic training failed: "
                                           + out[-250:]}), 500
        with open(JSON_PATH, encoding="utf-8") as f:
            return jsonify(json.load(f)), 200

    @app.route("/analytics/fulfillment/predictions", methods=["GET"])
    @require_auth("admin", "blood_bank")
    @_safe
    def fulfillment_predictions():
        clf = _load_model()
        if clf is None:
            return jsonify({"message": "The prediction model could not be loaded or trained. "
                                       "Check the Flask window for the [analytics] message."}), 500
        conn = None
        try:
            conn = db_connect()
            curr = conn.cursor()
            donors, stock = _load_donors(curr), _load_stock(curr)
            curr.execute(REQUEST_SQL + " WHERE r.status IN ('pending', 'matched') "
                                       "ORDER BY r.date_requested DESC")
            out = []
            for r in curr.fetchall():
                x = _request_features(r[:9], donors, stock, COMPATIBILITY, haversine_km)
                prob = float(clf.predict_proba(pd.DataFrame([x], columns=FEATURES))[0][1])
                node_ids, steps = _explain(clf, x)
                out.append({
                    "request_id": r[0], "blood_type": r[2], "quantity_needed": float(r[3]),
                    "urgency_level": r[4], "requester_name": r[9], "hospital_name": r[10],
                    "status": r[11], "date_requested": str(r[8]),
                    "probability": round(prob, 3), "risk_pct": round((1 - prob) * 100),
                    "risk": risk_band(prob),
                    "features": x, "path_nodes": node_ids, "path": steps,
                })
            out.sort(key=lambda r: r["probability"])      # most at-risk first
            return jsonify(out), 200
        except mariadb.Error as e:
            return jsonify({"message": "Database error.", "error": log_db_error(e)}), 500
        finally:
            if conn:
                conn.close()

    @app.route("/analytics/fulfillment/retrain", methods=["POST"])
    @require_auth("admin")
    @_safe
    def fulfillment_retrain():
        source = (request.get_json(silent=True) or {}).get("source", "synthetic")
        if source not in ("synthetic", "db"):
            return jsonify({"message": "source must be 'synthetic' or 'db'."}), 400
        try:
            res = subprocess.run(
                [sys.executable, os.path.join(HERE, "train_fulfillment_tree.py"), "--source", source],
                cwd=HERE, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return jsonify({"message": "Training took too long."}), 500
        if res.returncode != 0:
            return jsonify({"message": (res.stderr or res.stdout).strip()[-300:]}), 400
        return jsonify({"message": "Model retrained.", "source": source}), 200