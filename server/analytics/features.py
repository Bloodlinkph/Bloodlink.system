"""
Shared feature definition for the Blood Request Fulfillment model.

The SAME function builds the features for training (synthetic or DB) and for live
prediction on open requests, so the model never sees a different shape.

Target:  fulfilled_24h = 1  request was fulfilled within 24 hours of being made
         fulfilled_24h = 0  cancelled, fulfilled later than 24 h, or still open after 24 h

SIMPLIFIED VERSION
    The tree only uses the 3 inputs below, so it stays small enough to read at a glance.
    build_features() still calculates everything (the dashboard shows it for each
    request); FEATURES is just the short list the tree is allowed to ask about.
"""
import math

WINDOW_HOURS = 24

# --- the questions the tree is allowed to ask --------------------------------------
FEATURES = [
    "compatible_donors",       # eligible + available + compatible donors right now
    "donors_within_10km",      # how many of them are within 10 km
    "stock_sufficient",        # 1 if compatible stock >= units needed
]

LABELS = {
    "compatible_donors": "Compatible donors",
    "donors_within_10km": "Donors within 10 km",
    "stock_sufficient": "Enough compatible stock",
    # not used by the simplified tree, kept so the dashboard can still name them
    "urgency_rank": "Urgency level",
    "quantity_needed": "Units needed",
    "rh_negative": "Rh-negative type",
    "compatible_stock_units": "Compatible stock (units)",
    "nearest_donor_km": "Nearest donor (km)",
    "critical_confirmed": "Critical confirmed",
    "hour_requested": "Hour requested",
    "is_weekend": "Weekend request",
}

# short question shown inside each decision box of the tree
QUESTIONS = {
    "compatible_donors": "Compatible donors available?",
    "donors_within_10km": "Donors within 10 km?",
    "stock_sufficient": "Enough compatible stock?",
    "urgency_rank": "Urgency level?",
    "quantity_needed": "Units needed?",
    "rh_negative": "Rh-negative type?",
    "compatible_stock_units": "Compatible stock (units)?",
    "nearest_donor_km": "Nearest donor (km)?",
    "critical_confirmed": "Critical confirmed?",
    "hour_requested": "Hour requested?",
    "is_weekend": "Weekend request?",
}

COUNT_FEATURES = {"compatible_donors", "donors_within_10km"}          # whole numbers
BINARY_FEATURES = {                                                    # yes / no
    "stock_sufficient": ("compatible stock is not enough", "compatible stock is enough"),
    "rh_negative": ("blood type is Rh-positive", "blood type is Rh-negative"),
    "critical_confirmed": ("critical status not confirmed", "critical status confirmed"),
    "is_weekend": ("requested on a weekday", "requested on a weekend"),
}

URGENCY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}


def band(p):
    """Traffic-light outlook for a probability of being fulfilled within 24 h."""
    if p >= 0.70:
        return "likely"
    if p >= 0.40:
        return "at_risk"
    return "high_risk"


def split_labels(feature, threshold):
    """Words for the two branches of the split  'feature <= threshold'  (left, right)."""
    if feature in BINARY_FEATURES:
        return "No", "Yes"
    if feature in COUNT_FEATURES:
        k = int(math.floor(threshold))
        return f"≤ {k}", f"≥ {k + 1}"
    return f"≤ {round(threshold, 2):g}", f"> {round(threshold, 2):g}"


def describe_range(feature, lo, hi):
    """Plain-English condition for lo < value <= hi (None = no limit)."""
    label = LABELS.get(feature, feature)
    if feature in BINARY_FEATURES:
        no_text, yes_text = BINARY_FEATURES[feature]
        return yes_text if lo is not None else no_text
    if feature in COUNT_FEATURES:
        low = 0 if lo is None else int(math.floor(lo)) + 1
        if hi is None:
            return f"{label}: {low} or more"
        high = int(math.floor(hi))
        return f"{label}: exactly {high}" if low == high else f"{label}: {low}–{high}"
    if lo is not None and hi is not None:
        return f"{label}: {round(lo, 2):g} to {round(hi, 2):g}"
    if hi is not None:
        return f"{label} ≤ {round(hi, 2):g}"
    return f"{label} > {round(lo, 2):g}"


def build_features(urgency, quantity, blood_type, donor_distances_km,
                   compatible_stock_units, critical_status, requested_at):
    """donor_distances_km: distance (km, or None if unknown) of every eligible,
    available, compatible donor."""
    known = [d for d in donor_distances_km if d is not None]
    qty = float(quantity or 0)
    stock = float(compatible_stock_units or 0)
    return {
        "urgency_rank": URGENCY_RANK.get(str(urgency).lower(), 1),
        "quantity_needed": qty,
        "rh_negative": 1 if str(blood_type).endswith("-") else 0,
        "compatible_stock_units": stock,
        "stock_sufficient": 1 if stock >= qty else 0,
        "compatible_donors": len(donor_distances_km),
        "donors_within_10km": sum(1 for d in known if d <= 10),
        "nearest_donor_km": min(min(known), 100.0) if known else 100.0,
        "critical_confirmed": 1 if critical_status == "confirmed" else 0,
        "hour_requested": requested_at.hour,
        "is_weekend": 1 if requested_at.weekday() >= 5 else 0,
    }