import { useState, useEffect, useRef } from "react";
import api from "../api";
import NotificationBell, { NotificationsSection } from "./NotificationBell";
import ProfileSection from "./ProfileSection";
import ConfirmDialog from "./ConfirmDialog";
import LocationPicker from "./LocationPicker";
import { UNIT_HINT, UNIT_ERROR, formatUnits, unitLabel, isValidUnits } from "./units";
import "./dashboard.css";
import "./bloodbank-v9.css";

const REQUEST_TONE = { pending: "warn", matched: "info", fulfilled: "ok" };
const URGENCY_TONE = { medium: "info", high: "warn", critical: "crit" };
const MATCH_TONE = { proposed: "warn", accepted: "info", confirmed: "ok", declined: "crit" };
const MATCH_LABEL = { proposed: "Request sent", accepted: "Donor accepted", confirmed: "Confirmed" };
// a match that is still alive; a declined one frees the request to find another donor
const ACTIVE_MATCH = ["proposed", "accepted", "confirmed"];

const SUBTITLES = {
  post: "Tell nearby donors what blood you need.",
  requests: "Requests you have posted.",
  matches: "Eligible donors for the selected request.",
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

  // the first-screen choice is made once, on the first successful load
  const didPickDefault = useRef(false);

  // matched donors view
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [matchedDonors, setMatchedDonors] = useState([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [cancelReq, setCancelReq] = useState(null); // request waiting for "Are you sure?"

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

    if (!isValidUnits(quantity)) {
      setError(UNIT_ERROR);
      return;
    }
    if (urgency === "critical" && !urgencyReason.trim()) {
      setError("Tell us why this is critical so a blood bank can verify it.");
      return;
    }
    setSubmitting(true);

    try {
      await api.post("/requests", {
        requester_id: profile.requester_id,
        blood_type: bloodType,
        quantity_needed: quantity,
        urgency_level: urgency, // "critical" is only a claim; the server saves it as pending verification
        urgency_reason: urgency === "critical" ? urgencyReason.trim() : null,
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

  const viewMatches = async (requestId) => {
    setMessage("");
    setError("");
    setSelectedRequestId(requestId);
    setActive("matches"); // open the Matched Donors screen
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

  // the live (not declined) match of a request, if any
  const activeMatchFor = (requestId) =>
    matches.find((m) => m.request_id === requestId && ACTIVE_MATCH.includes(m.match_status));

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
      if (err.response?.status === 409) loadEverything(true);
      else setError(err.response?.data?.message || "Failed to create match.");
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

  const selectedRequest = myRequests.find((r) => r.request_id === selectedRequestId);

  if (loading) {
    return (
      <div className="bbv9" style={{ display: "grid", placeItems: "center" }}>
        <p className="muted">Loading...</p>
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
        { id: "matches", label: "Matched donors" },
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
                  <form onSubmit={handleSubmitRequest} className="form-narrow">
                    <div className="form-grid">
                      <div>
                        <label>Blood type needed</label>
                        <select className="in" value={bloodType} onChange={(e) => setBloodType(e.target.value)} required>
                          <option value="">Select blood type</option>
                          <option>A+</option><option>A-</option>
                          <option>B+</option><option>B-</option>
                          <option>O+</option><option>O-</option>
                          <option>AB+</option><option>AB-</option>
                        </select>
                      </div>

                      <div>
                        <label>Units needed</label>
                        <input
                          type="number"
                          className="in"
                          min="0.5"
                          step="0.5"
                          value={quantity}
                          onChange={(e) => setQuantity(e.target.value)}
                          placeholder="e.g. 1 or 1.5"
                          required
                        />
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
                          onChange={(e) => setPatientName(e.target.value)}
                          placeholder="Leave blank if it's for you"
                          maxLength={100}
                        />
                      </div>
                      <div>
                        <label>Relationship to you</label>
                        <select
                          className="in"
                          value={patientRelationship}
                          onChange={(e) => setPatientRelationship(e.target.value)}
                          disabled={!patientName.trim()}
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
                      </div>
                    </div>

                    <div>
                      <label>Urgency level</label>
                      <select className="in" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
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
                          onChange={(e) => setUrgencyReason(e.target.value)}
                          placeholder="e.g. Surgery tomorrow 8 am, diagnosis, hospital"
                          maxLength={255}
                          required
                        />
                        <small className="muted">
                          A blood bank or admin will verify this. Until then your request shows as High.
                        </small>
                      </div>
                    )}

                    <div>
                      <label>Hospital / clinic and ward (optional)</label>
                      <input
                        type="text"
                        className="in"
                        value={hospitalName}
                        onChange={(e) => setHospitalName(e.target.value)}
                        placeholder="e.g. Baliuag District Hospital, Ward 3"
                        maxLength={150}
                      />
                    </div>

                    <div>
                      <label>Location needed</label>
                      <input
                        type="text"
                        className="in"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g. Baliuag District Hospital"
                      />
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
                            const live = activeMatchFor(r.request_id);
                            return (
                              <tr key={r.request_id}>
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
                                    {open && live ? (
                                      <>
                                        {/* a request was sent: the Find Donor button is replaced by its status */}
                                        <span className={`st ${MATCH_TONE[live.match_status] || ""}`}>{MATCH_LABEL[live.match_status]}</span>
                                        <button type="button" className="btn sm" onClick={() => viewMatches(r.request_id)}>
                                          Matched Donors
                                        </button>
                                      </>
                                    ) : open ? (
                                      /* no match yet, or the donor declined: Find Donor is back */
                                      <button type="button" className="btn pri sm" onClick={() => viewMatches(r.request_id)}>
                                        Find Donor
                                      </button>
                                    ) : null}
                                    {open && (
                                      <button type="button" className="btn danger sm" onClick={() => setCancelReq(r)}>
                                        Cancel
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
              )}

              {/* MATCHED DONORS */}
              {current.id === "matches" && (
                <div className="panel">
                  {!selectedRequestId ? (
                    <div className="empty">
                      Open <b>My blood requests</b> and choose “View matched donors” on a request to see its matches here.
                    </div>
                  ) : (
                    <>
                      <div className="panel-h">
                        <h3>
                          Request #{selectedRequestId}
                          {selectedRequest && (
                            <span className="sub">
                              {unitLabel(selectedRequest.quantity_needed)} of {selectedRequest.blood_type}
                            </span>
                          )}
                        </h3>
                      </div>
                      {matchLoading ? (
                        <div className="empty">Searching for eligible donors...</div>
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
                                <th className="r">Distance (km)</th>
                                <th className="r">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {matchedDonors.map((d) => {
                                const live = activeMatchFor(selectedRequestId);
                                const past = matchFor(selectedRequestId, d.donor_id); // already asked this donor before
                                const clicked = sending.has(`${selectedRequestId}:${d.donor_id}`);
                                // once clicked (or already asked, even if declined) the button is disabled for good
                                const locked = clicked || !!past;
                                return (
                                  <tr key={d.donor_id}>
                                    <td>{d.full_name}</td>
                                    <td><span className="grp">{d.blood_type}</span></td>
                                    <td>{d.contact_number}</td>
                                    <td className="r num">{d.distance_km ?? "N/A"}</td>
                                    <td className="r">
                                      <button
                                        type="button"
                                        className="btn pri sm"
                                        disabled={locked || !!live}
                                        title={live && !locked ? "This request already has a donor" : undefined}
                                        onClick={() => requestMatch(d.donor_id, d.distance_km)}
                                      >
                                        {past
                                          ? past.match_status === "declined" ? "Declined" : MATCH_LABEL[past.match_status] || "Request sent"
                                          : clicked ? "Request sent" : "Request match"}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
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