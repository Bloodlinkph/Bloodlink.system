import { useState, useEffect, useRef } from "react";
import api from "../api";
import NotificationBell, { NotificationsSection } from "./NotificationBell";
import ProfileSection from "./ProfileSection";
import MemberProfile from "./MemberProfile";
import ConfirmDialog from "./ConfirmDialog";
import LocationPicker from "./LocationPicker";
import { unitLabel, formatUnits, UNIT_ML } from "./units";
import "./dashboard.css";
import "./bloodbank-v9.css";

const MATCH_TONE = { proposed: "warn", accepted: "info", declined: "crit", confirmed: "ok" };
const URGENCY_TONE = { medium: "info", high: "warn", critical: "crit" };
const ELIGIBILITY_TONE = { eligible: "ok", temporarily_deferred: "warn" };
const AVAILABILITY_TONE = { available: "ok" };
const DONATION_TONE = { completed: "ok", deferred: "warn" };
const APPT_TONE = { scheduled: "info", completed: "ok", cancelled: "crit", no_show: "warn" };
const POST_TONE = { open: "ok", closed: "", expired: "warn" };

// local date as YYYY-MM-DD (toISOString would shift it to UTC)
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};
const POST_MAX_DAYS = 30; // keep in step with the server

// "2026-11-03 09:30:00" -> "3 Nov 2026, 9:30 am"
const apptDate = (v) => new Date(String(v).replace(" ", "T"));
const fmtWhen = (v) =>
  apptDate(v).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

const SUBTITLES = {
  profile: "Your donor details and eligibility.",
  "profile-edit": "Personal details and sign-in settings.",
  matches: "Blood requests waiting for your response.",
  appointments: "Donation visits that blood banks have booked for you.",
  availability: "Post that you are ready to donate, and set when and where you are available.",
  history: "Your past donations.",
  notifications: "Updates about your account.",
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

function DonorDashboard({ user, onLogout, modeSwitch, onSwitchMode }) {
  const [active, setActive] = useState("profile");
  const [menuOpen, setMenuOpen] = useState(false); // mobile sidebar drawer
  const contentRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [donations, setDonations] = useState([]);
  const [matches, setMatches] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [cancelAppt, setCancelAppt] = useState(null); // appointment waiting for "Are you sure?"
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDecline, setConfirmDecline] = useState(null); // the match waiting for "Are you sure?"

  // "I can donate" posts
  const [posts, setPosts] = useState([]);
  const [postNote, setPostNote] = useState("");
  const [postUntil, setPostUntil] = useState(ymd(addDays(7)));
  const [posting, setPosting] = useState(false);
  const [closePost, setClosePost] = useState(null); // post waiting for "Are you sure?"

  // member with no donor profile yet (e.g. an old requester-only account)
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupBlood, setSetupBlood] = useState("");

  // editable fields
  const [availability, setAvailability] = useState("available");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [locationName, setLocationName] = useState(""); // address text, auto-filled from the map

  // the first-screen choice is made once, on the first successful load
  const didPickDefault = useRef(false);

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
  const fetchProfile = async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await api.get(`/donors/profile/${user.user_id}`);
      const data = response.data;
      setNeedsSetup(false);
      setProfile(data);
      setAvailability(data.availability_status);
      setLatitude(data.latitude ?? "");
      setLongitude(data.longitude ?? "");

      const donationsRes = await api.get(`/donations?donor_id=${data.donor_id}`);
      setDonations(donationsRes.data);

      const matchesRes = await api.get(`/matches?donor_id=${data.donor_id}`);
      setMatches(matchesRes.data);

      // appointments load separately so a problem here never hides the rest of the profile
      try {
        const apptRes = await api.get(`/appointments?donor_id=${data.donor_id}`);
        setAppointments(apptRes.data);
      } catch (e) {
        setAppointments([]);
      }

      // same for posts
      try {
        const postRes = await api.get(`/donor-posts?donor_id=${data.donor_id}`);
        setPosts(postRes.data);
      } catch (e) {
        setPosts([]);
      }

      // first load only: open Match Requests if something is waiting, otherwise stay on Profile
      if (!didPickDefault.current) {
        didPickDefault.current = true;
        if (matchesRes.data.some((m) => m.match_status === "proposed")) setActive("matches");
      }
    } catch (err) {
      if (err.response?.status === 404) setNeedsSetup(true);
      else setError("Failed to load your profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSetup = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/donors/setup", { user_id: user.user_id, blood_type: setupBlood });
      setNeedsSetup(false);
      fetchProfile();
    } catch (err) {
      setError(err.response?.data?.message || "Could not create your donor profile.");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      await api.put(`/donors/${profile.donor_id}`, {
        availability_status: availability,
        latitude: latitude === "" ? null : latitude,
        longitude: longitude === "" ? null : longitude,
        eligibility_status: profile.eligibility_status,
        last_donation_date: profile.last_donation_date,
      });
      setMessage("Profile updated successfully.");
      fetchProfile(true);
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to update profile.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

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

  const respondToMatch = async (matchId, newStatus) => {
    setError("");
    setMessage("");
    try {
      await api.put(`/matches/${matchId}`, { match_status: newStatus });
      setMessage(`Match ${newStatus}.`);
      fetchProfile(true);
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to update match.";
      setError(msg);
    }
  };

  const submitPost = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setPosting(true);
    try {
      await api.post("/donor-posts", {
        donor_id: profile.donor_id,
        note: postNote.trim() || null,
        available_until: postUntil,
      });
      setMessage("Your offer is posted. Requesters can now see that you're ready to donate.");
      setPostNote("");
      setAvailability("available");
      fetchProfile(true);
    } catch (err) {
      setError(err.response?.data?.message || "Could not post your offer.");
    } finally {
      setPosting(false);
    }
  };

  const closeMyPost = async (id) => {
    setError("");
    setMessage("");
    try {
      await api.put(`/donor-posts/${id}`, { status: "closed" });
      setMessage("Post closed.");
      fetchProfile(true);
    } catch (err) {
      setError(err.response?.data?.message || "Could not close the post.");
    }
  };

  const cancelAppointment = async (id) => {
    setError("");
    setMessage("");
    try {
      await api.put(`/appointments/${id}`, { status: "cancelled" });
      setMessage("Appointment cancelled. The blood bank has been notified.");
      fetchProfile(true);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to cancel the appointment.");
    }
  };

  if (loading) {
    return (
      <div className="bbv9" style={{ display: "grid", placeItems: "center" }}>
        <p className="muted">Loading your profile...</p>
      </div>
    );
  }

  // one-time setup for members who only had a requester profile
  if (needsSetup) {
    return (
      <div className="bbv9">
        <div className="signed-out">
          <div className="box">
            <h2>Set up your donor profile</h2>
            <p>Choose your blood type to start donating with this same account.</p>
            <form onSubmit={handleSetup} className="form-narrow" style={{ padding: 0 }}>
              <div>
                <label>Blood type</label>
                <select className="in" value={setupBlood} onChange={(e) => setSetupBlood(e.target.value)} required>
                  <option value="">Select blood type</option>
                  <option>A+</option><option>A-</option>
                  <option>B+</option><option>B-</option>
                  <option>O+</option><option>O-</option>
                  <option>AB+</option><option>AB-</option>
                </select>
              </div>
              <button type="submit" className="btn pri">Create donor profile</button>
              {modeSwitch}
              <button type="button" className="btn" onClick={onLogout}>Log out</button>
            </form>
            {error && <p className="msg err" style={{ marginTop: 12, marginBottom: 0 }}>{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bbv9" style={{ display: "grid", placeItems: "center" }}>
        <p className="msg err">{error}</p>
      </div>
    );
  }

  const pendingMatches = matches.filter((m) => m.match_status === "proposed");
  const pastMatches = matches.filter((m) => m.match_status !== "proposed");

  // upcoming first (soonest on top), then everything else (newest on top)
  const isUpcoming = (a) => a.status === "scheduled" && apptDate(a.scheduled_at) >= new Date();
  const upcomingAppts = appointments.filter(isUpcoming);
  const otherAppts = appointments.filter((a) => !isUpcoming(a)).reverse();
  const shownAppts = [...upcomingAppts, ...otherAppts];

  // sidebar groups
  const groups = [
    {
      heading: "Account",
      items: [
        { id: "profile", label: "Profile" },
        { id: "profile-edit", label: "Edit profile" },
      ],
    },
    {
      heading: "Donating",
      items: [
        { id: "matches", label: "Match requests", badge: pendingMatches.length, crit: true },
        { id: "appointments", label: "Appointments", badge: upcomingAppts.length },
        { id: "availability", label: "Post a donation" },
        { id: "history", label: "Donation history" },
      ],
    },
    {
      heading: "System",
      items: [{ id: "notifications", label: "Notifications" }],
    },
  ];
  const flat = groups.flatMap((g) => g.items);
  const current = flat.find((i) => i.id === active) || flat[0];

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
            <div className="brand-fac">Donor portal</div>
          </div>

          <nav className="nav" aria-label="Donor portal sections">
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
                    {item.badge > 0 && (
                      <span className={`cnt${item.crit ? " crit" : ""}`}>{item.badge > 9 ? "9+" : item.badge}</span>
                    )}
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
              {profile.full_name} / <b>{current.label}</b>
            </div>

            <div className="top-r">
              <NotificationBell userId={user.user_id} />
              <span className="vr" />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="avatar">{initials(profile.full_name)}</span>
                <div className="who">
                  <b>{profile.full_name}</b>
                  <span>Donor</span>
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

              {/* PROFILE */}
              {current.id === "profile" && (
                <MemberProfile
                  userId={user.user_id}
                  onEditProfile={() => goTo("profile-edit")}
                  onViewMatches={onSwitchMode ? () => onSwitchMode("requester") : undefined}
                  onChanged={() => fetchProfile(true)}
                />
              )}

              {/* MATCH REQUESTS */}
              {current.id === "matches" && (
                <>
                  <div className="panel">
                    <div className="panel-h">
                      <h3>
                        Pending requests<span className="sub">{pendingMatches.length}</span>
                      </h3>
                    </div>
                    {pendingMatches.length === 0 ? (
                      <div className="empty">No pending match requests right now.</div>
                    ) : (
                      <div className="tw">
                        <table>
                          <thead>
                            <tr>
                              <th>Requester</th>
                              <th>Blood type</th>
                              <th>Units</th>
                              <th>Urgency</th>
                              <th>Location</th>
                              <th className="r">Distance</th>
                              <th>Contact</th>
                              <th className="r">Respond</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pendingMatches.map((m) => (
                              <tr key={m.match_id}>
                                <td>{m.requester_name}</td>
                                <td><span className="grp">{m.blood_type}</span></td>
                                <td className="num">{unitLabel(m.quantity_needed)}</td>
                                <td><Status value={m.urgency_level} tones={URGENCY_TONE} /></td>
                                <td className="wrap">{m.location_needed || "Not specified"}</td>
                                <td className="r num">{m.distance_km != null ? `${m.distance_km} km` : "—"}</td>
                                <td>{m.requester_contact}</td>
                                <td className="r">
                                  <span style={{ display: "inline-flex", gap: 6 }}>
                                    <button type="button" className="btn pri sm" onClick={() => respondToMatch(m.match_id, "accepted")}>
                                      Accept
                                    </button>
                                    <button type="button" className="btn danger sm" onClick={() => setConfirmDecline(m)}>
                                      Decline
                                    </button>
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {pastMatches.length > 0 && (
                    <div className="panel">
                      <div className="panel-h">
                        <h3>Past match responses</h3>
                      </div>
                      <div className="tw">
                        <table>
                          <thead>
                            <tr>
                              <th>Requester</th>
                              <th>Blood type</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pastMatches.map((m) => (
                              <tr key={m.match_id}>
                                <td>{m.requester_name}</td>
                                <td><span className="grp">{m.blood_type}</span></td>
                                <td><Status value={m.match_status} tones={MATCH_TONE} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* APPOINTMENTS */}
              {current.id === "appointments" && (
                <div className="panel">
                  {shownAppts.length === 0 ? (
                    <div className="empty">No appointments yet. When a blood bank books a visit for you, it will show up here.</div>
                  ) : (
                    <div className="tw">
                      <table>
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Blood bank</th>
                            <th>Status</th>
                            <th className="r">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shownAppts.map((a) => (
                            <tr key={a.appointment_id}>
                              <td>{fmtWhen(a.scheduled_at)}{a.notes && <span className="sub">{a.notes}</span>}</td>
                              <td className="wrap">{a.bank_name}</td>
                              <td>
                                {a.status === "scheduled" && !isUpcoming(a)
                                  ? <span className="st warn">Awaiting update</span>
                                  : <Status value={a.status} tones={APPT_TONE} />}
                              </td>
                              <td className="r">
                                {isUpcoming(a) && (
                                  <button type="button" className="btn danger sm" onClick={() => setCancelAppt(a)}>
                                    Cancel
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* POST A DONATION ("I can donate") + AVAILABILITY & LOCATION share one screen */}
              {current.id === "availability" && (
                <>
                  <div className="panel">
                    {profile.eligibility_status !== "eligible" ? (
                      <div className="empty">
                        You can post an offer once you are eligible to donate again. Your status: {pretty(profile.eligibility_status)}.
                      </div>
                    ) : posts.some((p) => p.is_live) ? (
                      <div className="empty">You already have an open post. Close it below if you want to post a new one.</div>
                    ) : (
                      <form onSubmit={submitPost} className="form-narrow">
                        <div>
                          <label>Blood type you are offering</label>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span className="grp">{profile.blood_type}</span>
                            <span className="muted">Taken from your donor profile, so it is always correct. It is shown on your post.</span>
                          </div>
                        </div>
                        <div>
                          <label htmlFor="post-until">I can donate until</label>
                          <input
                            id="post-until"
                            type="date"
                            className="in"
                            value={postUntil}
                            min={ymd(new Date())}
                            max={ymd(addDays(POST_MAX_DAYS))}
                            onChange={(e) => setPostUntil(e.target.value)}
                            required
                          />
                          <small className="muted">Posts stay open for up to {POST_MAX_DAYS} days.</small>
                        </div>
                        <div>
                          <label htmlFor="post-note">Note (optional)</label>
                          <textarea
                            id="post-note"
                            className="in"
                            rows={3}
                            maxLength={255}
                            value={postNote}
                            onChange={(e) => setPostNote(e.target.value)}
                            placeholder="e.g. Free on weekends, can travel to Baliuag."
                          />
                          <small className="muted">
                            Others see your name, blood type ({profile.blood_type}) and area. Your phone number stays private.
                            Requesters reach you through a match request, and you can accept or decline.
                          </small>
                        </div>
                        <div className="actions">
                          <button type="submit" className="btn pri" disabled={posting}>
                            {posting ? "Posting..." : "Post that I can donate"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="panel">
                    <div className="panel-h"><h3>Your posts<span className="sub">{posts.length}</span></h3></div>
                    {posts.length === 0 ? (
                      <div className="empty">You haven't posted yet.</div>
                    ) : (
                      <div className="tw">
                        <table>
                          <thead>
                            <tr>
                              <th>Posted</th>
                              <th>Blood type</th>
                              <th>Open until</th>
                              <th>Note</th>
                              <th>Status</th>
                              <th className="r">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {posts.map((p) => (
                              <tr key={p.post_id}>
                                <td className="num">{String(p.created_at).slice(0, 10)}</td>
                                <td><span className="grp">{profile.blood_type}</span></td>
                                <td className="num">{p.available_until}</td>
                                <td className="wrap">{p.note || "—"}</td>
                                <td><Status value={p.status} tones={POST_TONE} /></td>
                                <td className="r">
                                  {p.is_live && (
                                    <button type="button" className="btn danger sm" onClick={() => setClosePost(p)}>
                                      Close
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* AVAILABILITY & LOCATION */}
              {current.id === "availability" && (
                <div className="panel">
                  <div className="panel-h"><h3>Availability &amp; location<span className="sub">Used to match you with nearby requests</span></h3></div>
                  <form onSubmit={handleSave} className="form-narrow">
                    <div>
                      <label>Availability</label>
                      <select className="in" value={availability} onChange={(e) => setAvailability(e.target.value)}>
                        <option value="available">Available</option>
                        <option value="unavailable">Unavailable</option>
                      </select>
                    </div>

                    <div>
                      <label>Location</label>
                      <input
                        type="text"
                        className="in"
                        value={locationName}
                        onChange={(e) => setLocationName(e.target.value)}
                        placeholder="e.g. Brgy. Poblacion, Baliuag, Bulacan"
                      />
                    </div>

                    <div>
                      <label>Pin your location on the map</label>
                      <LocationPicker
                        latitude={latitude}
                        longitude={longitude}
                        onChange={(la, ln) => { setLatitude(la); setLongitude(ln); }}
                        onAddress={setLocationName}
                      />
                    </div>

                    <div className="actions">
                      <button type="button" className="btn" onClick={useMyLocation}>
                        Use my current location
                      </button>
                      <button type="submit" className="btn pri" disabled={saving}>
                        {saving ? "Saving..." : "Save changes"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* DONATION HISTORY */}
              {current.id === "history" && (
                <div className="panel">
                  {donations.length === 0 ? (
                    <div className="empty">No donations recorded yet.</div>
                  ) : (
                    <div className="tw">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Blood bank</th>
                            <th className="r">Units</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {donations.map((d) => (
                            <tr key={d.donation_id}>
                              <td>{d.donation_date}</td>
                              <td>{d.blood_bank}</td>
                              <td className="r num">{formatUnits(d.units ?? d.volume_ml / UNIT_ML)}</td>
                              <td><Status value={d.status} tones={DONATION_TONE} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* EDIT PROFILE */}
              {current.id === "profile-edit" && (
                <div className="bbv9-embed">
                  <ProfileSection userId={user.user_id} onSaved={() => fetchProfile(true)} />
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
        open={!!closePost}
        title="Close this post?"
        message="Requesters will no longer see that you're ready to donate. You can post again any time."
        confirmLabel="Yes, close it"
        cancelLabel="No, keep it open"
        onCancel={() => setClosePost(null)}
        onConfirm={() => {
          const id = closePost.post_id;
          setClosePost(null);
          closeMyPost(id);
        }}
      />

      <ConfirmDialog
        open={!!confirmDecline}
        title="Decline this request?"
        message={
          confirmDecline
            ? `Decline ${confirmDecline.requester_name}'s request for ${unitLabel(confirmDecline.quantity_needed)} of ${confirmDecline.blood_type} blood? They will be notified, and this can't be undone.`
            : ""
        }
        confirmLabel="Yes, decline"
        cancelLabel="No, go back"
        onCancel={() => setConfirmDecline(null)}
        onConfirm={() => {
          const id = confirmDecline.match_id;
          setConfirmDecline(null);
          respondToMatch(id, "declined");
        }}
      />

      <ConfirmDialog
        open={!!cancelAppt}
        title="Cancel this appointment?"
        message={
          cancelAppt
            ? `Your visit to ${cancelAppt.bank_name} on ${fmtWhen(cancelAppt.scheduled_at)} will be cancelled and the blood bank will be notified.`
            : ""
        }
        confirmLabel="Yes, cancel"
        cancelLabel="No, keep it"
        onCancel={() => setCancelAppt(null)}
        onConfirm={() => {
          const id = cancelAppt.appointment_id;
          setCancelAppt(null);
          cancelAppointment(id);
        }}
      />
    </div>
  );
}

export default DonorDashboard;