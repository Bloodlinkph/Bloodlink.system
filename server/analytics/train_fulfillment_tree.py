"""
Trains the (simplified) Blood Request Fulfillment decision tree and saves:
    models/fulfillment_tree.joblib   the model (used by the API for live predictions)
    models/fulfillment_tree.json     tree structure + metrics + importances (used by the dashboard)

Usage:
    python train_fulfillment_tree.py                  # train on synthetic_requests.csv
    python train_fulfillment_tree.py --source db      # train on closed requests in the database
"""
import os, sys, json, argparse
from datetime import datetime
import numpy as np
import pandas as pd
import joblib
from sklearn.tree import DecisionTreeClassifier, export_text
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.metrics import (accuracy_score, precision_score, recall_score,
                             f1_score, confusion_matrix)

from features import (FEATURES, LABELS, QUESTIONS, band, split_labels, describe_range)

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(HERE, "models")
os.makedirs(MODEL_DIR, exist_ok=True)

MAX_DEPTH = 3          # small on purpose: readable at a glance (at most 8 groups of requests)


def min_leaf_for(n_rows):
    """Every group must contain at least 5% of the requests (never fewer than 10)."""
    return max(10, int(n_rows * 0.05))


def load_synthetic():
    path = os.path.join(HERE, "synthetic_requests.csv")
    if not os.path.exists(path):                       # create it on the fly
        import subprocess
        subprocess.run([sys.executable, os.path.join(HERE, "generate_synthetic_data.py")],
                       cwd=HERE, check=True)
    return pd.read_csv(path), "synthetic"


def load_db():
    # imported here so the synthetic path works without a database
    sys.path.insert(0, os.path.dirname(HERE))
    import bloodlink as bl
    from analytics.fulfillment import fetch_training_rows
    conn = bl.db_connect()
    try:
        df = fetch_training_rows(conn.cursor(), bl.COMPATIBILITY, bl.haversine_km)
    finally:
        conn.close()
    return df, "database"


def node_to_dict(tree, node_id, class_names):
    t = tree
    counts = t.value[node_id][0]
    total = counts.sum()
    # newer scikit-learn stores fractions; use n_node_samples for the real count
    n = int(t.n_node_samples[node_id])
    frac = counts / total if total else counts
    d = {
        "id": int(node_id),
        "samples": n,
        "p_fulfilled": round(float(frac[1]), 3) if len(frac) > 1 else 0.0,
        "prediction": class_names[int(np.argmax(counts))],
    }
    if t.children_left[node_id] != t.children_right[node_id]:
        f = FEATURES[t.feature[node_id]]
        d.update({
            "feature": f,
            "label": LABELS[f],
            "question": QUESTIONS.get(f, LABELS[f] + "?"),
            "threshold": round(float(t.threshold[node_id]), 2),
            "left_label": split_labels(f, float(t.threshold[node_id]))[0],
            "right_label": split_labels(f, float(t.threshold[node_id]))[1],
            "left": node_to_dict(t, t.children_left[node_id], class_names),
            "right": node_to_dict(t, t.children_right[node_id], class_names),
        })
    else:
        d["leaf"] = True
    return d


def plain_rules(node, bounds=None, out=None):
    """Turns every leaf of the tree into one sentence-style rule a non-technical reader can follow."""
    bounds = bounds or {}
    out = [] if out is None else out
    if node.get("leaf"):
        conds = [describe_range(f, lo, hi) for f, (lo, hi) in bounds.items()]
        out.append({"conditions": conds or ["All requests"],
                    "p_fulfilled": node["p_fulfilled"],
                    "band": band(node["p_fulfilled"]),
                    "samples": node["samples"]})
        return out
    f, thr = node["feature"], node["threshold"]
    lo, hi = bounds.get(f, (None, None))
    plain_rules(node["left"], {**bounds, f: (lo, thr if hi is None else min(hi, thr))}, out)
    plain_rules(node["right"], {**bounds, f: (thr if lo is None else max(lo, thr), hi)}, out)
    return out


FLAG_BELOW = 0.70      # same cut-off as the green / orange boundary on the dashboard


def risk_flag_metrics(y_true, p_fulfilled):
    y = np.asarray(y_true)
    flagged = np.asarray(p_fulfilled) < FLAG_BELOW
    failed = y == 0
    caught = int((flagged & failed).sum())
    return {
        "threshold": FLAG_BELOW,
        "failed": int(failed.sum()),
        "caught": caught,                                      # failed and flagged
        "missed": int((~flagged & failed).sum()),              # failed but shown green
        "false_alarms": int((flagged & ~failed).sum()),        # flagged but was fulfilled
        "fine": int((~flagged & ~failed).sum()),               # green and fulfilled
        "catch_rate": round(caught / failed.sum(), 3) if failed.sum() else 0.0,
        "flag_precision": round(caught / flagged.sum(), 3) if flagged.sum() else 0.0,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["synthetic", "db"], default="synthetic")
    args = ap.parse_args()

    df, source = load_synthetic() if args.source == "synthetic" else load_db()
    if len(df) < 60 or df["fulfilled_24h"].nunique() < 2:
        sys.exit(f"Only {len(df)} usable rows (need at least 60 with both outcomes). "
                 f"Use synthetic data until more requests are closed.")

    X, y = df[FEATURES], df["fulfilled_24h"]
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

    min_leaf = min_leaf_for(len(X_tr))
    # No class_weight on purpose: the % shown on each leaf is then the REAL share of
    # requests that were fulfilled in that group.
    clf = DecisionTreeClassifier(max_depth=MAX_DEPTH, min_samples_leaf=min_leaf, random_state=42)
    clf.fit(X_tr, y_tr)

    pred = clf.predict(X_te)
    cm = confusion_matrix(y_te, pred, labels=[0, 1])
    cv = cross_val_score(DecisionTreeClassifier(max_depth=MAX_DEPTH, min_samples_leaf=min_leaf,
                                                random_state=42),
                         X, y, cv=StratifiedKFold(5, shuffle=True, random_state=42),
                         scoring="accuracy")

    metrics = {
        "accuracy": round(accuracy_score(y_te, pred), 3),
        "precision": round(precision_score(y_te, pred, zero_division=0), 3),
        "recall": round(recall_score(y_te, pred, zero_division=0), 3),
        "f1": round(f1_score(y_te, pred, zero_division=0), 3),
        "cv_accuracy_mean": round(float(cv.mean()), 3),
        "cv_accuracy_std": round(float(cv.std()), 3),
        "confusion_matrix": {"tn": int(cm[0, 0]), "fp": int(cm[0, 1]),
                             "fn": int(cm[1, 0]), "tp": int(cm[1, 1])},
        # how the dashboard really uses the tree: a request is flagged when its chance is
        # below 70% (orange or red box). These numbers answer "does the flag catch the
        # requests that end up NOT fulfilled in 24 h?"
        "risk_flag": risk_flag_metrics(y_te, clf.predict_proba(X_te)[:, 1]),
        "train_rows": int(len(X_tr)), "test_rows": int(len(X_te)),
        "fulfilled_rate": round(float(y.mean()), 3),
    }
    imp = sorted(({"feature": f, "label": LABELS[f], "importance": round(float(v), 3)}
                  for f, v in zip(FEATURES, clf.feature_importances_) if v > 0),
                 key=lambda r: -r["importance"])

    tree_dict = node_to_dict(clf.tree_, 0, ["Not in 24 h", "Fulfilled 24 h"])
    payload = {
        "name": "Blood Request Fulfillment Prediction",
        "features": FEATURES,
        "algorithm": "Decision Tree (CART, Gini)",
        "data_source": source,
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "max_depth": MAX_DEPTH, "min_samples_leaf": min_leaf,
        "target": "fulfilled within 24 hours (1) vs not (0)",
        "metrics": metrics,
        "feature_importance": imp,
        "rules_text": export_text(clf, feature_names=FEATURES),
        "plain_rules": sorted(plain_rules(tree_dict), key=lambda r: r["p_fulfilled"]),
        "tree": tree_dict,
    }
    joblib.dump(clf, os.path.join(MODEL_DIR, "fulfillment_tree.joblib"))
    with open(os.path.join(MODEL_DIR, "fulfillment_tree.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"Trained on {source} data ({len(df)} rows)")
    print(json.dumps(metrics, indent=2))
    print(payload["rules_text"])


if __name__ == "__main__":
    main()