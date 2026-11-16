"""
Creates SIMULATED blood-request history so the decision tree has something to learn
from. The real database only has a handful of requests, which is far too few.

!!  Say this in the presentation: the data is synthetic (simulated).  !!
The outcome (fulfilled / not) is drawn from a made-up probability that depends on
donor supply, distance, stock, urgency, etc., plus random noise. It demonstrates
the pipeline; it is NOT proof of real-world accuracy. Retrain on real data once
enough closed requests exist (python train_fulfillment_tree.py --source db).

Usage:  python generate_synthetic_data.py [rows]      (default 1500)
"""
import sys, os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(42)

N = int(sys.argv[1]) if len(sys.argv) > 1 else 1500

# rough PH-like blood group frequencies; Rh-negative is rare
types = ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"]
probs = [0.44, 0.23, 0.23, 0.05, 0.016, 0.012, 0.012, 0.01]  # PH-like, Rh-negative oversampled a little so the tree sees some
bt = rng.choice(types, N, p=probs)
rh_neg = np.array([1 if t.endswith("-") else 0 for t in bt])

urgency = rng.choice([0, 1, 2, 3], N, p=[0.15, 0.45, 0.28, 0.12])
qty = np.clip(np.round(rng.gamma(2.0, 1.0, N) * 2) / 2, 0.5, 8)

# donor supply: fewer donors for Rh-negative types
lam = np.where(rh_neg == 1, 2.0, 7.0)
compat = rng.poisson(lam)
within10 = np.array([rng.binomial(c, 0.35) for c in compat])
nearest = np.where(compat > 0,
                   np.clip(rng.gamma(2.0, 4.0, N) / np.sqrt(np.maximum(compat, 1)), 0.3, 100),
                   100.0).round(2)
# compatible units on the shelf of verified banks. Realistic for a small provincial network:
# often only a few units, and Rh-negative stock is frequently empty.
cstock = np.round(np.clip(np.where(rh_neg == 1, rng.gamma(0.8, 2.5, N), rng.gamma(1.6, 4.0, N)), 0, 60) * 2) / 2
stock_ok = (cstock >= qty).astype(int)
crit_conf = ((urgency == 3) & (rng.random(N) < 0.7)).astype(int)
_w = np.array([1,1,1,1,1,2,3,5,6,6,6,6,5,5,5,5,5,5,4,4,3,2,2,1], dtype=float)
hour = rng.choice(range(24), N, p=_w / _w.sum())
weekend = (rng.random(N) < 2 / 7).astype(int)

# hidden "true" fulfilment probability
z = (-3.0
     + 2.2 * stock_ok                       # step 1: enough compatible stock = can be issued today
     + 0.03 * np.minimum(cstock, 30)
     + 0.22 * np.minimum(compat, 12)        # step 2: are there donors who can help?
     + 0.80 * (within10 > 0)
     - 0.03 * np.minimum(nearest, 40)       # step 3: can they reach in time?
     - 0.35 * np.maximum(qty - 2, 0)
     + 0.35 * (urgency >= 2)
     + 0.60 * crit_conf
     - 0.30 * rh_neg
     - 0.25 * weekend
     + rng.normal(0, 0.6, N))
p = 1 / (1 + np.exp(-z))
fulfilled = (rng.random(N) < p).astype(int)

df = pd.DataFrame({
    "blood_type": bt,
    "urgency_rank": urgency,
    "quantity_needed": qty,
    "rh_negative": rh_neg,
    "compatible_donors": compat,
    "donors_within_10km": within10,
    "nearest_donor_km": nearest,
    "compatible_stock_units": cstock,
    "stock_sufficient": stock_ok,
    "critical_confirmed": crit_conf,
    "hour_requested": hour,
    "is_weekend": weekend,
    "fulfilled_24h": fulfilled,
})
out = os.path.join(HERE, "synthetic_requests.csv")
df.to_csv(out, index=False)
print(f"Wrote {len(df)} rows -> {out}")
print(f"Fulfilled-within-24h rate: {df.fulfilled_24h.mean():.1%}")
