    import { useState, useEffect, useCallback } from "react";
    import api from "../api";
    import { formatUnits, UNIT_ML } from "./units";
    import "./memberProfile.css";
    import Loading from "./Loading";
    import FieldError from "./FieldError";
    import { validate, hasErrors, notFuture, maxAge, numberBetween, oneOf, focusFirstError } from "../validation";

    // Profile page for a member (one account = donor + requester).
    //   <MemberProfile
    //     userId={user.user_id}
    //     onEditProfile={() => goTo("profile-edit")}
    //     onViewMatches={() => onSwitchMode("requester")}
    //     onChanged={() => fetchProfile(true)}   // optional: refresh the parent after a change
    //   />
    // Data comes from GET /members/<user_id>/profile-summary.

    // how the backend values are shown to people
    const URGENCY = {
    critical: ["Emergency", "crit"],
    high: ["Urgent", "warn"],
    medium: ["Standard", ""],
    low: ["Scheduled", ""],
    };
    const REQUEST_STATUS = {
    pending: ["Open", "warn"],
    matched: ["Open", "warn"],
    fulfilled: ["Fulfilled", "ok"],
    cancelled: ["Cancelled", ""],
    };
    const GENDER_LABEL = {
    female: "Female",
    male: "Male",
    other: "Other",
    prefer_not_to_say: "Prefer not to say",
    };

    const pretty = (s) => {
    const t = String(s ?? "").replace(/_/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
    };

    const initials = (name) =>
    String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

    // "2026-10-26" or "2026-10-26 14:22:10" -> Date (local, no timezone shift)
    const parseDate = (v) => {
    if (!v) return null;
    const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
    };
    const fmtDate = (v) => {
    const d = parseDate(v);
    return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
    };
    const fmtLongDate = (v) => {
    const d = parseDate(v);
    return d ? d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";
    };
    const fmtMonthYear = (v) => {
    const d = parseDate(v);
    return d ? d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "";
    };
    const fmtPhone = (p) => {
    const s = String(p || "").replace(/\s+/g, "");
    if (!s) return "—";
    return /^09\d{9}$/.test(s) ? `${s.slice(0, 4)} ${s.slice(4, 7)} ${s.slice(7)}` : s;
    };
    const reqRef = (id) => `REQ-${String(id).padStart(4, "0")}`;

    function Pill({ tone = "", dot = false, children }) {
    return <span className={`mp-pill ${tone} ${dot ? "dot" : ""}`}>{children}</span>;
    }

    function MemberProfile({ userId, onEditProfile, onViewMatches, onChanged }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [toggling, setToggling] = useState(false);
    const [extra, setExtra] = useState({ date_of_birth: "", gender: "", weight_kg: "" });
    const [extraErrors, setExtraErrors] = useState({});
    const setExtraField = (key, value) => {
        setExtra((p) => ({ ...p, [key]: value }));
        setExtraErrors((p) => (p[key] ? { ...p, [key]: "" } : p)); // red message goes away when edited
    };
    const [savingExtra, setSavingExtra] = useState(false);

    const load = useCallback(async () => {
        try {
        const res = await api.get(`/members/${userId}/profile-summary`);
        setData(res.data);
        } catch (err) {
        setError("Failed to load your profile.");
        } finally {
        setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        load();
    }, [load]);

    const toggleAvailability = async () => {
        const d = data.donor;
        const next = d.availability_status === "available" ? "unavailable" : "available";
        setToggling(true);
        setError("");
        setMessage("");
        try {
        // same payload shape the Availability screen sends
        await api.put(`/donors/${d.donor_id}`, {
            availability_status: next,
            latitude: d.latitude ?? null,
            longitude: d.longitude ?? null,
            eligibility_status: d.eligibility_status,
            last_donation_date: d.last_donation_date,
        });
        await load();
        if (onChanged) onChanged();
        } catch (err) {
        setError(err.response?.data?.message || "Could not update your availability.");
        } finally {
        setToggling(false);
        }
    };

    const saveExtra = async (e) => {
        e.preventDefault();
        const payload = {};
        Object.entries(extra).forEach(([k, v]) => {
        if (String(v).trim() !== "") payload[k] = v;
        });
        // fields shown in this form (the same ones the inputs below are rendered for)
        const shown = [
        !data?.user?.date_of_birth && "date_of_birth",
        !data?.user?.gender && "gender",
        data?.donor && data.donor.weight_kg == null && "weight_kg",
        ].filter(Boolean);
        let found;
        if (Object.keys(payload).length === 0) {
        // nothing filled in: every field in the form says it is required
        found = {};
        shown.forEach((k) => { found[k] = "This field is required."; });
        } else {
        found = validate(extra, {
            date_of_birth: [notFuture("Date of birth"), maxAge(120, "Date of birth")],
            gender: [oneOf(Object.keys(GENDER_LABEL), "Choose a gender from the list.")],
            weight_kg: [numberBetween(30, 300, "Weight")],
        });
        }
        setExtraErrors(found);
        if (hasErrors(found)) {
        focusFirstError(e.currentTarget);
        return;
        }
        setSavingExtra(true);
        setError("");
        setMessage("");
        try {
        await api.put(`/members/${userId}/personal`, payload);
        setExtra({ date_of_birth: "", gender: "", weight_kg: "" });
        setMessage("Details saved.");
        await load();
        if (onChanged) onChanged();
        } catch (err) {
        setError(err.response?.data?.message || "Could not save your details.");
        } finally {
        setSavingExtra(false);
        }
    };

    if (loading) return <div className="panel"><p className="mp-empty"><Loading label="Loading your profile..." /></p></div>;
    if (!data) return <div className="msg err">{error || "Failed to load your profile."}</div>;

    const { user: u, donor, eligibility_checks: checks, requests, completeness } = data;
    const isDonor = !!donor;
    const roleLine = isDonor ? (data.has_requester ? "Donor and requester" : "Donor") : "Requester";
    const address = [u.address, u.barangay, u.city].filter(Boolean).join(", ");

    // ---- "next eligible" for the stat strip
    let nextLabel = "—";
    let nextTone = "";
    if (isDonor) {
        if (donor.can_donate_now === true) {
        nextLabel = "Today";
        nextTone = "good";
        } else if (donor.next_eligible_date && parseDate(donor.next_eligible_date) > new Date()) {
        nextLabel = fmtDate(donor.next_eligible_date);
        nextTone = "warn";
        }
    }

    // ---- requests
    const activeRequest = requests.find((r) => r.status === "pending" || r.status === "matched");
    const patientOf = (r) => ({
        name: r.patient_name || u.full_name,
        note: r.patient_name
        ? r.patient_relationship ? `Relationship: ${pretty(r.patient_relationship)}` : ""
        : "Self",
    });
    const placeOf = (r) => r.hospital_name || r.location_needed || "—";

    // ---- which details are still missing (drives the small form)
    const needDob = !u.date_of_birth;
    const needGender = !u.gender;
    const needWeight = isDonor && donor.weight_kg == null;
    const showExtra = needDob || needGender || needWeight;

    const missingHint = completeness.missing.length
        ? `Add your ${completeness.missing.slice(0, 2).join(" and ")} to finish your profile.`
        : "Your profile is complete.";

    return (
        <div className="mp-wrap">
        {message && <div className="msg ok" style={{ margin: 0 }}>{message}</div>}
        {error && <div className="msg err" style={{ margin: 0 }}>{error}</div>}

        {/* ---------- HEADER ---------- */}
        <section className="panel" aria-label="Profile summary">
            <div className="mp-hero-top">
            <span className="mp-avatar" aria-hidden="true">{initials(u.full_name)}</span>

            <div className="mp-id">
                <h2>{u.full_name}</h2>
                <p className="muted">
                {roleLine}
                {u.member_since ? ` · Member since ${fmtMonthYear(u.member_since)}` : ""}
                </p>
                {isDonor && (
                <div className="mp-chips">
                    <span className="mp-pill blood">{donor.blood_type}</span>
                    <Pill tone={donor.eligibility_status === "eligible" ? "ok" : "warn"} dot>
                    {pretty(donor.eligibility_status)}
                    </Pill>
                    <Pill tone={donor.availability_status === "available" ? "ok" : ""} dot>
                    {pretty(donor.availability_status)}
                    </Pill>
                </div>
                )}
            </div>

            <div className="mp-complete">
                <div className="mp-complete-row">
                <span className="muted">Profile completeness</span>
                <b>{completeness.percent}%</b>
                </div>
                <div
                className="mp-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={completeness.percent}
                aria-label="Profile completeness"
                >
                <i style={{ width: `${completeness.percent}%` }} />
                </div>
                <p className="muted">{missingHint}</p>
                {onEditProfile && (
                <button type="button" className="btn pri" onClick={onEditProfile}>Edit profile</button>
                )}
            </div>
            </div>

            <dl className="mp-stats">
            <div>
                <dt>Last donation</dt>
                <dd>{isDonor && donor.last_donation_date ? fmtDate(donor.last_donation_date) : "No donations yet"}</dd>
            </div>
            <div>
                <dt>Next eligible</dt>
                <dd className={nextTone}>{nextLabel}</dd>
            </div>
            <div>
                <dt>Total donations</dt>
                <dd>{isDonor ? donor.total_donations : 0}</dd>
            </div>
            <div>
                <dt>Requests posted</dt>
                <dd>{requests.length}</dd>
            </div>
            </dl>
        </section>

        {/* ---------- FINISH YOUR PROFILE (only while something is missing) ---------- */}
        {showExtra && (
            <section className="panel">
            <div className="panel-h">
                <h3>Finish your profile</h3>
                <span className="mp-sub">Used to check if you can donate</span>
            </div>
            <form className="panel-b mp-extra" onSubmit={saveExtra} noValidate>
                {needDob && (
                <div>
                    <label htmlFor="mp-dob">Date of birth</label>
                    <input
                    id="mp-dob"
                    type="date"
                    className="in"
                    max={new Date().toISOString().slice(0, 10)}
                    value={extra.date_of_birth}
                    onChange={(e) => setExtraField("date_of_birth", e.target.value)}
                    aria-invalid={!!extraErrors.date_of_birth}
                    aria-describedby="err-mp-dob"
                    />
                    <FieldError id="err-mp-dob" message={extraErrors.date_of_birth} />
                </div>
                )}
                {needGender && (
                <div>
                    <label htmlFor="mp-gender">Gender</label>
                    <select
                    id="mp-gender"
                    className="in"
                    value={extra.gender}
                    onChange={(e) => setExtraField("gender", e.target.value)}
                    aria-invalid={!!extraErrors.gender}
                    aria-describedby="err-mp-gender"
                    >
                    <option value="">Select</option>
                    {Object.entries(GENDER_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                    ))}
                    </select>
                    <FieldError id="err-mp-gender" message={extraErrors.gender} />
                </div>
                )}
                {needWeight && (
                <div>
                    <label htmlFor="mp-weight">Weight (kg)</label>
                    <input
                    id="mp-weight"
                    type="number"
                    className="in"
                    min="30"
                    max="300"
                    step="0.1"
                    placeholder="e.g. 58"
                    value={extra.weight_kg}
                    onChange={(e) => setExtraField("weight_kg", e.target.value)}
                    aria-invalid={!!extraErrors.weight_kg}
                    aria-describedby="err-mp-weight"
                    />
                    <FieldError id="err-mp-weight" message={extraErrors.weight_kg} />
                </div>
                )}
                <div>
                <button type="submit" className="btn pri" disabled={savingExtra}>
                    {savingExtra ? "Saving..." : "Save details"}
                </button>
                </div>
            </form>
            </section>
        )}

        {/* ---------- DETAILS + ELIGIBILITY ---------- */}
        <div className="mp-cols">
            <section className="panel">
            <div className="panel-h"><h3>Personal details</h3></div>
            <div className="panel-b">
                <dl className="facts">
                <div>
                    <dt>Full name</dt>
                    <dd>{u.full_name}</dd>
                </div>
                <div>
                    <dt>Email</dt>
                    <dd style={{ overflowWrap: "anywhere" }}>{u.email}</dd>
                </div>
                <div>
                    <dt>Mobile number</dt>
                    <dd>{fmtPhone(u.contact_number)}</dd>
                </div>
                <div>
                    <dt>Age and gender</dt>
                    <dd>
                    {u.age != null || u.gender
                        ? [u.age != null ? `${u.age} years old` : null, u.gender ? GENDER_LABEL[u.gender] || pretty(u.gender) : null]
                            .filter(Boolean)
                            .join(" · ")
                        : "Not added yet"}
                    {u.date_of_birth && <span className="mp-small">Born {fmtLongDate(u.date_of_birth)}</span>}
                    </dd>
                </div>
                <div className="full">
                    <dt>Address</dt>
                    <dd className="mp-addr">
                    <span>{address || "Not added yet"}</span>
                    {isDonor && (
                        donor.latitude != null && donor.longitude != null
                        ? <Pill tone="ok" dot>Location pinned</Pill>
                        : <Pill>Location not pinned</Pill>
                    )}
                    </dd>
                </div>
                </dl>
            </div>
            </section>

            {isDonor && (
            <section className="panel">
                <div className="panel-h">
                <h3>Donation eligibility</h3>
                <span className="mp-sub">Checked automatically</span>
                </div>
                <div className="panel-b">
                <ul className="mp-checks">
                    {checks.map((c) => (
                    <li key={c.key}>
                        <span
                        className={`mp-tick ${c.ok === true ? "ok" : c.ok === false ? "no" : "unk"}`}
                        aria-hidden="true"
                        >
                        {c.ok === true ? "✓" : c.ok === false ? "✕" : "–"}
                        </span>
                        <div>
                        <b>{c.title}</b>
                        <span className="muted">{c.detail}</span>
                        </div>
                    </li>
                    ))}
                </ul>

                <div className="mp-avail">
                    <div>
                    <b id="mp-avail-label">Available to donate</b>
                    <span className="muted">Turn off while travelling or unwell</span>
                    </div>
                    <button
                    type="button"
                    className="mp-switch"
                    role="switch"
                    aria-checked={donor.availability_status === "available"}
                    aria-labelledby="mp-avail-label"
                    onClick={toggleAvailability}
                    disabled={toggling}
                    />
                </div>
                </div>
            </section>
            )}
        </div>

        {/* ---------- HEALTH ---------- */}
        {isDonor && (
            <section className="panel">
            <div className="panel-h"><h3>Health and screening</h3></div>
            <div className="panel-b">
                <dl className="mp-health">
                <div>
                    <dt className="mp-label">Blood type</dt>
                    <dd className="blood">{donor.blood_type}</dd>
                    <span className="mp-small">Locked after sign-up</span>
                </div>
                <div>
                    <dt className="mp-label">Weight</dt>
                    <dd>{donor.weight_kg != null ? `${formatUnits(donor.weight_kg)} kg` : "Not added yet"}</dd>
                    {donor.weight_kg != null && <span className="mp-small">Self-reported</span>}
                </div>
                <div>
                    <dt className="mp-label">Last donation date</dt>
                    <dd>{donor.last_donation_date ? fmtDate(donor.last_donation_date) : "No donations yet"}</dd>
                </div>
                <div>
                    <dt className="mp-label">Eligibility status</dt>
                    <dd className={donor.eligibility_status === "eligible" ? "good" : "warn"}>
                    {pretty(donor.eligibility_status)}
                    </dd>
                </div>
                </dl>
            </div>
            </section>
        )}

        {/* ---------- AS A REQUESTER ---------- */}
        <div className="mp-section-h">
            <h2>As a requester</h2>
            <span className="muted">Used when you ask for blood for yourself or a family member</span>
        </div>

        <section className="panel">
            <div className="panel-h">
            <h3>Active request</h3>
            {activeRequest && (
                <span className="mp-sub">
                {reqRef(activeRequest.request_id)} · posted {fmtDate(activeRequest.date_requested)}
                </span>
            )}
            </div>
            {!activeRequest ? (
            <p className="mp-empty">You have no open blood request.</p>
            ) : (
            <div className="panel-b">
                <dl className="mp-req">
                <div>
                    <dt className="mp-label">Patient</dt>
                    <dd>
                    {patientOf(activeRequest).name}
                    {patientOf(activeRequest).note && (
                        <span className="mp-small">{patientOf(activeRequest).note}</span>
                    )}
                    </dd>
                </div>
                <div>
                    <dt className="mp-label">Blood needed</dt>
                    <dd>
                    <span className="grp">{activeRequest.blood_type}</span> · {formatUnits(activeRequest.quantity_needed)}{" "}
                    {Number(activeRequest.quantity_needed) === 1 ? "unit" : "units"}
                    <span className="mp-small">1 unit = 1 bag ({UNIT_ML} mL)</span>
                    </dd>
                </div>
                <div>
                    <dt className="mp-label">Urgency</dt>
                    <dd>
                    <Pill tone={(URGENCY[activeRequest.urgency_level] || [])[1]}>
                        {(URGENCY[activeRequest.urgency_level] || [pretty(activeRequest.urgency_level)])[0]}
                    </Pill>
                    </dd>
                </div>
                {onViewMatches && (
                    <div className="act">
                    <button type="button" className="btn" onClick={onViewMatches}>View matches</button>
                    </div>
                )}
                <div className="wide">
                    <dt className="mp-label">Hospital / clinic and ward</dt>
                    <dd>{placeOf(activeRequest)}</dd>
                </div>
                <div>
                    <dt className="mp-label">Status</dt>
                    <dd>
                    <Pill tone={(REQUEST_STATUS[activeRequest.status] || [])[1]}>
                        {(REQUEST_STATUS[activeRequest.status] || [pretty(activeRequest.status)])[0]}
                    </Pill>{" "}
                    <span className="muted" style={{ fontWeight: 400 }}>
                        {activeRequest.matched_donors} donor{activeRequest.matched_donors === 1 ? "" : "s"} matched
                    </span>
                    </dd>
                </div>
                </dl>
            </div>
            )}
        </section>

        <section className="panel">
            <div className="panel-h">
            <h3>Request history</h3>
            <span className="mp-sub">{requests.length} request{requests.length === 1 ? "" : "s"}</span>
            </div>
            {requests.length === 0 ? (
            <p className="mp-empty">Requests you post will show up here.</p>
            ) : (
            <div className="tw">
                <table>
                <thead>
                    <tr>
                    <th>Ref</th>
                    <th>Patient</th>
                    <th>Blood</th>
                    <th className="r">Units</th>
                    <th>Hospital</th>
                    <th>Urgency</th>
                    <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {requests.map((r) => {
                    const p = patientOf(r);
                    const urg = URGENCY[r.urgency_level] || [pretty(r.urgency_level), ""];
                    const st = REQUEST_STATUS[r.status] || [pretty(r.status), ""];
                    return (
                        <tr key={r.request_id}>
                        <td className="mono">{reqRef(r.request_id)}</td>
                        <td>
                            {p.name}
                            {p.note && <span className="mp-small">{p.note.replace("Relationship: ", "")}</span>}
                        </td>
                        <td><span className="grp">{r.blood_type}</span></td>
                        <td className="r num">{formatUnits(r.quantity_needed)}</td>
                        <td>{placeOf(r)}</td>
                        <td><Pill tone={urg[1]}>{urg[0]}</Pill></td>
                        <td><Pill tone={st[1]}>{st[0]}</Pill></td>
                        </tr>
                    );
                    })}
                </tbody>
                </table>
            </div>
            )}
        </section>
        </div>
    );
    }

    export default MemberProfile;