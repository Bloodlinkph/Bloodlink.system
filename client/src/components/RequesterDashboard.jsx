import { useState, useEffect, useRef, Fragment } from "react";
import api from "../api";
import NotificationBell, { NotificationsSection } from "./NotificationBell";
import ProfileSection from "./ProfileSection";
import ConfirmDialog from "./ConfirmDialog";
import LocationPicker from "./LocationPicker";
import FieldError from "./FieldError";
import {
  validate, hasErrors, required, optional, when, units as unitsRule, address as addressRule, minLen, maxLen,
  bloodType as bloodTypeRule, lettersOnly, focusFirstError,
} from "../validation";
import { UNIT_HINT, formatUnits, unitLabel } from "./units";
import "./dashboard.css";
import "./bloodbank-v9.css";
import Loading from "./Loading";

const REQUEST_TONE = { pending: "warn", matched: "info", fulfilled: "ok" };
const URGENCY_TONE = { medium: "info", high: "warn", critical: "crit" };
const MATCH_LABEL = { proposed: "Request sent", accepted: "Donor accepted", confirmed: "Confirmed", declined: "Declined", expired: "Not needed" };
// 1 donor gives 1 unit, so 1.5 units needs 2 donors. You may ask a few donors per unit at once
// (backups); the first ones to accept fill the request and the rest are released automatically.
// Must match MAX_ASKS_PER_UNIT on the server.
const MAX_ASKS_PER_UNIT = 3;
const donorsNeeded = (qty) => Math.max(1, Math.ceil(Number(qty) || 0));

const SUBTITLES = {
  post: "Tell nearby donors what blood you need.",
  requests: "Requests you have posted. Tap Find Donor on a request to see its eligible donors.",
  profile: "Personal details and sign-in settings.",
  notifications: "Updates about your requests.",
};

// "temporarily_deferred" -> "Temporarily deferred"
const pretty = (s) => {
  const t = String(s ?? "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// colored status dot + label
function Status({ value, tones = {} }) {
  return <span className={`st ${tones[value] || ""}`}>{pretty(value)}</span>;
}

const initials = (name) =>
  String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

function RequesterDashboard({ user, onLogout, modeSwitch }) {
  const [active, setActive] = useState("post");
  const [menuOpen, setMenuOpen] = useState(false); // mobile sidebar drawer
  const contentRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [myRequests, setMyRequests] = useState([]);
  const [matches, setMatches] = useState([]); // every match on my requests (decides the buttons)
  const [sending, setSending] = useState(() => new Set()); // "requestId:donorId" already clicked
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // new request form
  const [bloodType, setBloodType] = useState("");
  const [quantity, setQuantity] = useState("");
  const [urgency, setUrgency] = useState("medium");
  const [urgencyReason, setUrgencyReason] = useState(""); // required when asking for "critical"
  const [location, setLocation] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientRelationship, setPatientRelationship] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fe, setFe] = useState({}); // inline messages for the new-request form
  const clearFe = (key) => setFe((p) => (p[key] ? { ...p, [key]: "" } : p)); // red message goes away when edited
  const [editErrors, setEditErrors] = useState({}); // inline messages for the edit-request dialog

  // the first-screen choice is made once, on the first successful load
  const didPickDefault = useRef(false);

  // matched donors view
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [matchedDonors, setMatchedDonors] = useState([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [cancelReq, setCancelReq] = useState(null); // request waiting for "Are you sure?"
  const [fulfilReq, setFulfilReq] = useState(null);   // request waiting for "Mark as fulfilled?"
  const [editReq, setEditReq] = useState(null);       // request being edited
  const [edit, setEdit] = useState({ quantity: "", urgency: "medium", hospital: "", location: "" });

  // switching screens clears old banners
  const goTo = (id) => {
    setMessage("");
    setError("");
    setActive(id);
    setMenuOpen(false);
  };

  // every screen starts at the top
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [active]);

  // mobile drawer: Esc closes it, and the page behind it doesn't scroll while it's open
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  // silent = refresh in the background without replacing the page with "Loading..."
  const loadEverything = async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const profileRes = await api.get(`/requesters/profile/${user.user_id}`);
      setProfile(profileRes.data);

      const requestsRes = await api.get(`/requests?requester_id=${profileRes.data.requester_id}`);
      setMyRequests(requestsRes.data);

      // matches load separately so a problem here never hides the requests.
      // (assumes GET /matches?requester_id=... returns rows with request_id, donor_id, match_status)
      try {
        const matchesRes = await api.get(`/matches?requester_id=${profileRes.data.requester_id}`);
        setMatches(matchesRes.data);
      } catch (e) {
        setMatches([]);
      }

      // first load only: returning users see their requests, new users see the form
      if (!didPickDefault.current) {
        didPickDefault.current = true;
        if (requestsRes.data.length > 0) setActive("requests");
      }
    } catch (err) {
      setError("Failed to load your profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(7));
        setLongitude(pos.coords.longitude.toFixed(7));
      },
      () => setError("Could not get your location. Please enter it manually.")
    );
  };

  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    const isCritical = (all) => all.urgency === "critical";
    const found = validate(
      {
        bloodType, quantity, urgency, urgencyReason, hospitalName, location, patientName, patientRelationship,
      },
      {
        bloodType: [required("Blood type"), bloodTypeRule],
        quantity: [required("Units needed"), unitsRule("Units needed")],
        patientName: [optional(lettersOnly("Patient name")), maxLen(100, "Patient name")],
        patientRelationship: [when((all) => String(all.patientName || "").trim() !== "", required("Relationship"))],
        urgencyReason: [
          when(isCritical, required("Reason")),
          when(isCritical, minLen(10, "Reason")),
        ],
        hospitalName: [when(isCritical, required("Hospital or clinic")), maxLen(150, "Hospital or clinic")],
        location: [optional(addressRule("Location needed"))],
      }
    );
    setFe(found);
    if (hasErrors(found)) {
      focusFirstError(e.currentTarget);
      return;
    }
    setSubmitting(true);

    try {
      await api.post("/requests", {
        requester_id: profile.requester_id,
        blood_type: bloodType,
        quantity_needed: quantity,
        urgency_level: urgency, // "critical" is only a claim; the server saves it as pending verification
        // SPRINT 2 FIX: the server reads critical_claim / critical_reason (it used to get "urgency_reason" and rejected it)
        critical_claim: urgency === "critical",
        critical_reason: urgency === "critical" ? urgencyReason.trim() : null,
        location_needed: location,
        latitude: latitude === "" ? null : latitude,
        longitude: longitude === "" ? null : longitude,
        patient_name: patientName.trim() || null,
        patient_relationship: patientName.trim() ? patientRelationship || null : null,
        hospital_name: hospitalName.trim() || null,
      });
      setMessage(
        urgency === "critical"
          ? "Blood request posted. It shows as High until a blood bank or admin verifies that it is critical."
          : "Blood request posted successfully."
      );
      setBloodType(""); setQuantity(""); setUrgency("medium"); setUrgencyReason("");
      setLocation(""); setLatitude(""); setLongitude("");
      setPatientName(""); setPatientRelationship(""); setHospitalName("");
      loadEverything(true);
      setActive("requests"); // show the new request in its list
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to post request.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // opens the donor list right under the request; tapping again (or another request) switches/closes it
  const viewMatches = async (requestId) => {
    setMessage("");
    setError("");
    if (selectedRequestId === requestId) {
      setSelectedRequestId(null);
      setMatchedDonors([]);
      return;
    }
    setSelectedRequestId(requestId);
    setMatchLoading(true);
    setMatchedDonors([]);
    try {
      const res = await api.get(`/requests/${requestId}/find-donors`);
      setMatchedDonors(res.data);
    } catch (err) {
      setError("Failed to load matched donors.");
    } finally {
      setMatchLoading(false);
    }
  };

  // how full a request is: donors needed, donors who said yes, donors still deciding
  const capacityFor = (r) => {
    const mine = matches.filter((m) => m.request_id === r.request_id);
    const needed = donorsNeeded(r.quantity_needed);
    const filled = mine.filter((m) => m.match_status === "accepted" || m.match_status === "confirmed").length;
    const waiting = mine.filter((m) => m.match_status === "proposed").length;
    const maxOpen = needed * MAX_ASKS_PER_UNIT;
    return { needed, filled, waiting, maxOpen, full: filled >= needed, canAsk: filled < needed && filled + waiting < maxOpen };
  };

  // take back an unanswered request so you can ask someone else
  const withdrawMatch = async (matchId) => {
    setMessage("");
    setError("");
    try {
      await api.put(`/matches/${matchId}`, { match_status: "expired" });
      setMessage("Request to that donor withdrawn.");
      loadEverything(true);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to withdraw the request.");
      loadEverything(true);
    }
  };

  // "Request match" can be clicked only once per donor and request
  const requestMatch = async (donorId, distance) => {
    const key = `${selectedRequestId}:${donorId}`;
    if (sending.has(key)) return; // ignores double clicks
    setSending((s) => new Set(s).add(key));
    setMessage("");
    setError("");
    try {
      await api.post("/matches", {
        request_id: selectedRequestId,
        donor_id: donorId,
        distance_km: distance,
      });
      setMessage("Match request sent to donor.");
      loadEverything(true); // the buttons now show the status instead
    } catch (err) {
      // the button stays disabled for good, even if this failed (reload the page to try again)
      setError(err.response?.data?.message || "Failed to create match.");
      if (err.response?.status === 409) loadEverything(true);
    }
  };

  // any match ever made between this request and this donor (including declined ones)
  const matchFor = (requestId, donorId) =>
    matches.find((m) => m.request_id === requestId && m.donor_id === donorId);

  const cancelRequest = async (requestId) => {
    setMessage("");
    setError("");
    try {
      await api.put(`/requests/${requestId}`, { status: "cancelled" });
      setMessage("Request cancelled. Donors who were matched to it have been told.");
      if (selectedRequestId === requestId) { setSelectedRequestId(null); setMatchedDonors([]); }
      loadEverything(true);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to cancel the request.");
    }
  };

  // SPRINT 2 FIX: the requester closes a request once a donor accepted it
  const markFulfilled = async (requestId) => {
    setMessage("");
    setError("");
    try {
      await api.put(`/requests/${requestId}`, { status: "fulfilled" });
      setMessage("Request marked as fulfilled. Thank you!");
      if (selectedRequestId === requestId) { setSelectedRequestId(null); setMatchedDonors([]); }
      loadEverything(true);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to mark the request as fulfilled.");
    }
  };

  // SPRINT 2 FIX: edit an open request (blood type stays locked)
  const openEdit = (r) => {
    setEdit({
      quantity: String(r.quantity_needed ?? ""),
      urgency: r.urgency_level === "critical" ? "critical" : (r.urgency_level || "medium"),
      hospital: r.hospital_name || "",
      location: r.location_needed || "",
    });
    setEditErrors({});
    setEditReq(r);
  };
  const saveEdit = async () => {
    const r = editReq;
    const found = validate(edit, {
      quantity: [required("Units needed"), unitsRule("Units needed")],
      hospital: [maxLen(150, "Hospital or clinic")],
      location: [optional(addressRule("Location needed"))],
    });
    setEditErrors(found);
    if (hasErrors(found)) return; // keep the dialog open so the messages are visible
    setEditReq(null);
    setMessage("");
    setError("");
    try {
      const body = {
        quantity_needed: edit.quantity,
        hospital_name: edit.hospital.trim(),
        location_needed: edit.location.trim(),
      };
      if (r.critical_status !== "confirmed") body.urgency_level = edit.urgency;
      await api.put(`/requests/${r.request_id}/details`, body);
      setMessage("Request updated. Donors with a live match were told.");
      loadEverything(true);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update the request.");
    }
  };


  if (loading) {
    return (
      <div className="bbv9" style={{ display: "grid", placeItems: "center" }}>
        <p className="muted"><Loading label="Loading..." /></p>
      </div>
    );
  }

  // sidebar groups
  const groups = [
    {
      heading: "Requests",
      items: [
        { id: "post", label: "Post a blood request" },
        { id: "requests", label: "My blood requests" },
      ],
    },
    {
      heading: "Account",
      items: [{ id: "profile", label: "Edit profile" }],
    },
    {
      heading: "System",
      items: [{ id: "notifications", label: "Notifications" }],
    },
  ];
  const flat = groups.flatMap((g) => g.items);
  const current = flat.find((i) => i.id === active) || flat[0];
  const displayName = profile?.full_name || "Requester";

  return (
    <div className="bbv9">
      <div className="app">
        {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

        {/* SIDEBAR */}
        <aside className={`side ${menuOpen ? "open" : ""}`}>
          <div className="brand">
            <div className="brand-name">
              Blood<span>Link</span>
            </div>
            <div className="brand-fac">Requester portal</div>
          </div>

          <nav className="nav" aria-label="Requester portal sections">
            {groups.map((g) => (
              <div key={g.heading}>
                <div className="nav-h">{g.heading}</div>
                {g.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === current.id ? "on" : ""}
                    aria-current={item.id === current.id ? "page" : undefined}
                    onClick={() => goTo(item.id)}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="side-foot">
            <b>Switch mode</b>
            <p>One account, two roles.</p>
            {modeSwitch}
          </div>
        </aside>

        {/* MAIN */}
        <div className="main">
          <header className="top">
            <button type="button" className="top-btn menu-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <div className="crumbs">
              {displayName} / <b>{current.label}</b>
            </div>

            <div className="top-r">
              <NotificationBell userId={user.user_id} />
              <span className="vr" />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="avatar">{initials(displayName)}</span>
                <div className="who">
                  <b>{displayName}</b>
                  <span>Requester</span>
                </div>
              </div>
              <button type="button" className="top-btn" onClick={onLogout}>Log out</button>
            </div>
          </header>

          <div id="content" ref={contentRef}>
            <div className="tab" key={current.id}>
              <div className="page-h">
                <div>
                  <h1>{current.label}</h1>
                  <p>{SUBTITLES[current.id]}</p>
                </div>
              </div>

              {message && <div className="msg ok">{message}</div>}
              {error && <div className="msg err">{error}</div>}

              {/* POST A BLOOD REQUEST */}
              {current.id === "post" && (
                <div className="panel">
                  <form onSubmit={handleSubmitRequest} className="form-narrow" noValidate>
                    <div className="form-grid">
                      <div>
                        <label>Blood type needed</label>
                        <select className="in" value={bloodType} onChange={(e) => { setBloodType(e.target.value); clearFe("bloodType"); }} aria-invalid={!!fe.bloodType} aria-describedby="err-rq-bt">
                          <option value="">Select blood type</option>
                          <option>A+</option><option>A-</option>
                          <option>B+</option><option>B-</option>
                          <option>O+</option><option>O-</option>
                          <option>AB+</option><option>AB-</option>
                        </select>
                        <FieldError id="err-rq-bt" message={fe.bloodType} />
                      </div>

                      <div>
                        <label>Units needed</label>
                        <input
                          type="number"
                          className="in"
                          min="0.5"
                          step="0.5"
                          value={quantity}
                          onChange={(e) => { setQuantity(e.target.value); clearFe("quantity"); }}
                          placeholder="e.g. 1 or 1.5"
                          aria-invalid={!!fe.quantity}
                          aria-describedby="err-rq-units"
                        />
                        <FieldError id="err-rq-units" message={fe.quantity} />
                      </div>

                      <div className="full">
                        <span className="field-note">{UNIT_HINT}</span>
                      </div>
                    </div>

                    <div className="form-grid">
                      <div>
                        <label>Patient name (optional)</label>
                        <input
                          type="text"
                          className="in"
                          value={patientName}
                          onChange={(e) => { setPatientName(e.target.value); clearFe("patientName"); clearFe("patientRelationship"); }}
                          placeholder="Leave blank if it's for you"
                          maxLength={100}
                          aria-invalid={!!fe.patientName}
                          aria-describedby="err-rq-patient"
                        />
                        <FieldError id="err-rq-patient" message={fe.patientName} />
                      </div>
                      <div>
                        <label>Relationship to you</label>
                        <select
                          className="in"
                          value={patientRelationship}
                          onChange={(e) => { setPatientRelationship(e.target.value); clearFe("patientRelationship"); }}
                          disabled={!patientName.trim()}
                          aria-invalid={!!fe.patientRelationship}
                          aria-describedby="err-rq-rel"
                        >
                          <option value="">Select</option>
                          <option value="mother">Mother</option>
                          <option value="father">Father</option>
                          <option value="spouse">Spouse</option>
                          <option value="child">Child</option>
                          <option value="sibling">Sibling</option>
                          <option value="relative">Other relative</option>
                          <option value="friend">Friend</option>
                          <option value="other">Other</option>
                        </select>
                        <FieldError id="err-rq-rel" message={fe.patientRelationship} />
                      </div>
                    </div>

                    <div>
                      <label>Urgency level</label>
                      <select className="in" value={urgency} onChange={(e) => { setUrgency(e.target.value); clearFe("urgencyReason"); clearFe("hospitalName"); }}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical (needs verification)</option>
                      </select>
                    </div>

                    {urgency === "critical" && (
                      <div>
                        <label>Why is it critical?</label>
                        <input
                          type="text"
                          className="in"
                          value={urgencyReason}
                          onChange={(e) => { setUrgencyReason(e.target.value); clearFe("urgencyReason"); }}
                          placeholder="e.g. Surgery tomorrow 8 am, diagnosis, hospital"
                          maxLength={255}
                          aria-invalid={!!fe.urgencyReason}
                          aria-describedby="err-rq-reason"
                        />
                        <FieldError id="err-rq-reason" message={fe.urgencyReason} />
                        <small className="muted">
                          A blood bank or admin will verify this. Until then your request shows as High.
                        </small>
                      </div>
                    )}

                    <div>
                      <label>Hospital / clinic and ward{urgency === "critical" ? " (required for critical)" : " (optional)"}</label>
                      <input
                        type="text"
                        className="in"
                        value={hospitalName}
                        onChange={(e) => { setHospitalName(e.target.value); clearFe("hospitalName"); }}
                        placeholder="e.g. Nueva Vizcaya Provincial Hospital, Ward 3"
                        maxLength={150}
                        aria-invalid={!!fe.hospitalName}
                        aria-describedby="err-rq-hosp"
                      />
                      <FieldError id="err-rq-hosp" message={fe.hospitalName} />
                    </div>

                    <div>
                      <label>Location needed</label>
                      <input
                        type="text"
                        className="in"
                        value={location}
                        onChange={(e) => { setLocation(e.target.value); clearFe("location"); }}
                        placeholder="e.g. Nueva Vizcaya Provincial Hospital"
                        aria-invalid={!!fe.location}
                        aria-describedby="err-rq-loc"
                      />
                      <FieldError id="err-rq-loc" message={fe.location} />
                    </div>

                    <div>
                      <label>Pin the location on the map</label>
                      <LocationPicker
                        latitude={latitude}
                        longitude={longitude}
                        onChange={(la, ln) => { setLatitude(la); setLongitude(ln); }}
                        onAddress={setLocation}
                      />
                    </div>

                    <div className="actions">
                      <button type="button" className="btn" onClick={useMyLocation}>
                        Use my current location
                      </button>
                      <button type="submit" className="btn pri" disabled={submitting}>
                        {submitting ? "Posting..." : "Post request"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* MY REQUESTS */}
              {current.id === "requests" && (
                <div className="panel">
                  {myRequests.length === 0 ? (
                    <div className="empty">You haven't posted any requests yet.</div>
                  ) : (
                    <div className="tw">
                      <table>
                        <thead>
                          <tr>
                            <th>Blood type</th>
                            <th className="r">Units</th>
                            <th>Urgency</th>
                            <th>Status</th>
                            <th className="r">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {myRequests.map((r) => {
                            const open = r.status === "pending" || r.status === "matched";
                            const cap = capacityFor(r);
                            const asked = cap.filled + cap.waiting > 0;
                            return (
                              <Fragment key={r.request_id}>
                              <tr className={selectedRequestId === r.request_id ? "row-open" : ""}>
                                <td><span className="grp">{r.blood_type}</span></td>
                                <td className="r num">{formatUnits(r.quantity_needed)}</td>
                                <td>
                                  <Status value={r.urgency_level} tones={URGENCY_TONE} />
                                  {r.critical_status === "pending" && <span className="sub">Critical claim awaiting verification</span>}
                                  {r.critical_status === "rejected" && <span className="sub">Critical claim was not verified</span>}
                                </td>
                                <td><Status value={r.status} tones={REQUEST_TONE} /></td>
                                <td className="r">
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    {open && asked ? (
                                      <>
                                        {/* donors were asked: show how many said yes out of how many are needed */}
                                        <span className={`st ${cap.full ? "ok" : cap.filled ? "info" : "warn"}`}>
                                          {cap.filled}/{cap.needed} donor{cap.needed > 1 ? "s" : ""}
                                          {cap.waiting > 0 && !cap.full ? `, ${cap.waiting} waiting` : ""}
                                        </span>
                                        <button type="button" className="btn sm" onClick={() => viewMatches(r.request_id)}>
                                          {selectedRequestId === r.request_id ? "Hide donors" : "View donors"}
                                        </button>
                                      </>
                                    ) : open ? (
                                      /* no match yet, or the donor declined: Find Donor is back */
                                      <button type="button" className="btn pri sm" onClick={() => viewMatches(r.request_id)}>
                                        {selectedRequestId === r.request_id ? "Hide donors" : "Find Donor"}
                                      </button>
                                    ) : null}
                                    {open && (
                                      <button type="button" className="btn sm" onClick={() => openEdit(r)}>
                                        Edit
                                      </button>
                                    )}
                                    {r.status === "matched" && (
                                      <button type="button" className="btn pri sm" onClick={() => setFulfilReq(r)}>
                                        Mark fulfilled
                                      </button>
                                    )}
                                    {open && (
                                      <button type="button" className="btn danger sm" onClick={() => setCancelReq(r)}>
                                        Cancel
                                      </button>
                                    )}
                                  </span>
                                </td>
                              </tr>
                              {selectedRequestId === r.request_id && (
                                <tr className="donor-row">
                                  <td colSpan={5} style={{ padding: 0, whiteSpace: "normal", background: "var(--bg, #fafafa)" }}>
                                    <div style={{ padding: "10px 12px" }}>
                                      <div className="muted" style={{ marginBottom: 8, fontSize: 13 }}>
                                        Eligible donors for <b>{unitLabel(r.quantity_needed)} of {r.blood_type}</b>
                                        {" "}· you need <b>{cap.needed}</b> donor{cap.needed > 1 ? "s" : ""} (1 donor = 1 unit)
                                        {" "}· <b>{cap.filled}</b> accepted, <b>{cap.waiting}</b> waiting
                                      </div>
                                      {cap.full ? (
                                        <div className="msg ok" style={{ marginBottom: 8, fontSize: 13 }}>
                                          This request has all the donors it needs. Other donors you asked were told they are no longer needed.
                                        </div>
                                      ) : !cap.canAsk ? (
                                        <div className="msg err" style={{ marginBottom: 8, fontSize: 13 }}>
                                          You have asked {cap.maxOpen} donors at once, the most allowed for {unitLabel(r.quantity_needed)}. Wait for an answer, or withdraw one to ask someone else.
                                        </div>
                                      ) : (
                                        <div className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
                                          You can ask up to {cap.maxOpen} donors at once. The first {cap.needed > 1 ? `${cap.needed} to accept fill` : "one to accept fills"} the request; anyone else still waiting is released automatically.
                                        </div>
                                      )}
                      {matchLoading ? (
                        <div className="empty"><Loading label="Searching for eligible donors..." /></div>
                      ) : matchedDonors.length === 0 ? (
                        <div className="empty">No available compatible donors found nearby.</div>
                      ) : (
                        <div className="tw">
                          <table>
                            <thead>
                              <tr>
                                <th>Name</th>
                                <th>Blood type</th>
                                <th>Contact</th>
                                <th>Location</th>
                                <th className="r">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {matchedDonors.map((d) => {
                                const past = matchFor(r.request_id, d.donor_id)
                                  || (d.match_status ? { match_status: d.match_status } : null); // already asked this donor before
                                const clicked = sending.has(`${r.request_id}:${d.donor_id}`);
                                // once clicked (or already asked, even if declined) the button is disabled for good
                                const locked = clicked || !!past;
                                return (
                                  <tr key={d.donor_id}>
                                    <td>{d.full_name}</td>
                                    <td><span className="grp">{d.blood_type}</span></td>
                                    <td>{d.contact_number}</td>
                                    <td className="wrap">{d.location || "Not specified"}</td>
                                    <td className="r">
                                      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                                        <button
                                          type="button"
                                          className="btn pri sm"
                                          disabled={locked || !cap.canAsk}
                                          title={!locked && cap.full ? "This request already has all the donors it needs"
                                            : !locked && !cap.canAsk ? `You can ask up to ${cap.maxOpen} donors at once` : undefined}
                                          onClick={() => requestMatch(d.donor_id, d.distance_km)}
                                        >
                                          {past
                                            ? MATCH_LABEL[past.match_status] || "Request sent"
                                            : clicked ? "Request sent" : "Request match"}
                                        </button>
                                        {past?.match_status === "proposed" && past.match_id && (
                                          <button type="button" className="btn sm" onClick={() => withdrawMatch(past.match_id)}>
                                            Withdraw
                                          </button>
                                        )}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* EDIT PROFILE */}
              {current.id === "profile" && (
                <div className="bbv9-embed">
                  <ProfileSection userId={user.user_id} onSaved={() => loadEverything(true)} />
                </div>
              )}

              {/* NOTIFICATIONS */}
              {current.id === "notifications" && (
                <div className="bbv9-embed">
                  <NotificationsSection userId={user.user_id} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!fulfilReq}
        title="Mark this request as fulfilled?"
        message={fulfilReq ? `Confirm that you received the ${fulfilReq.blood_type} blood you asked for. The request will be closed and can't be reopened.` : ""}
        confirmLabel="Yes, it's fulfilled"
        cancelLabel="Not yet"
        danger={false}
        onCancel={() => setFulfilReq(null)}
        onConfirm={() => { const id = fulfilReq.request_id; setFulfilReq(null); markFulfilled(id); }}
      />

      <ConfirmDialog
        open={!!editReq}
        title={editReq ? `Edit request #${editReq.request_id}` : "Edit request"}
        message="Blood type can't be changed because donors were matched on it. Donors with a live match will be told."
        confirmLabel="Save changes"
        cancelLabel="Close"
        danger={false}
        onCancel={() => setEditReq(null)}
        onConfirm={saveEdit}
      >
        {editReq && (
          <div style={{ display: "grid", gap: 10, margin: "12px 0" }}>
            <div>
              <label>Units needed</label>
              <input className="in" value={edit.quantity} onChange={(e) => { setEdit({ ...edit, quantity: e.target.value }); setEditErrors((p) => ({ ...p, quantity: "" })); }} placeholder="e.g. 1 or 1.5" aria-invalid={!!editErrors.quantity} aria-describedby="err-ed-units" />
              <FieldError id="err-ed-units" message={editErrors.quantity} />
            </div>
            <div>
              <label>Urgency level</label>
              {editReq.critical_status === "confirmed" ? (
                <input className="in" value="Critical (confirmed, can't be lowered)" disabled />
              ) : (
                <select className="in" value={edit.urgency === "critical" ? "high" : edit.urgency} onChange={(e) => setEdit({ ...edit, urgency: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              )}
            </div>
            <div>
              <label>Hospital / clinic</label>
              <input className="in" value={edit.hospital} maxLength={150} onChange={(e) => { setEdit({ ...edit, hospital: e.target.value }); setEditErrors((p) => ({ ...p, hospital: "" })); }} aria-invalid={!!editErrors.hospital} aria-describedby="err-ed-hosp" />
              <FieldError id="err-ed-hosp" message={editErrors.hospital} />
            </div>
            <div>
              <label>Location needed</label>
              <input className="in" value={edit.location} onChange={(e) => { setEdit({ ...edit, location: e.target.value }); setEditErrors((p) => ({ ...p, location: "" })); }} aria-invalid={!!editErrors.location} aria-describedby="err-ed-loc" />
              <FieldError id="err-ed-loc" message={editErrors.location} />
            </div>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!cancelReq}
        title="Cancel this request?"
        message={
          cancelReq
            ? `Your request for ${unitLabel(cancelReq.quantity_needed)} of ${cancelReq.blood_type} blood will be cancelled and any donors matched to it will be told. This can't be undone.`
            : ""
        }
        confirmLabel="Yes, cancel request"
        cancelLabel="No, keep it"
        onCancel={() => setCancelReq(null)}
        onConfirm={() => {
          const id = cancelReq.request_id;
          setCancelReq(null);
          cancelRequest(id);
        }}
      />
    </div>
  );
}

export default RequesterDashboard;