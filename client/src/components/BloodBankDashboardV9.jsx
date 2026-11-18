import { useState, useEffect } from "react";
    import api from "../api";
    import NotificationBell, { NotificationsSection } from "./NotificationBell";
    import ProfileSection from "./ProfileSection";
import DemandForecast from "./DemandForecast";
import CriticalReview from "./CriticalReview";
import Loading from "./Loading";
    import ConfirmDialog from "./ConfirmDialog";
    import { prettify } from "./Overview";
    import { UNIT_HINT, UNIT_ERROR, UNIT_ML, formatUnits, formatChange, unitLabel, isValidUnits } from "./units";
    import FieldError from "./FieldError";
    import { validate, hasErrors, required, units as unitsRule, unitsOrZero, oneOf, maxLen, focusFirstError } from "../validation";
    import "./dashboard.css"; // still used by ProfileSection / NotificationsSection
    import "./bloodbank-v9.css";

    const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
    // Each group's minimum comes from the server: the bank's own value, or a default based on
    // how common that blood type is (common groups are used more, so they need a bigger reserve).
    // Below the minimum is "Low"; below half of it is "Critical".
    const CRIT_RATIO = 0.5;

    // red blood cell compatibility (same table the landing page uses)
    const CAN_GIVE = {
    "O-": GROUPS,
    "O+": ["O+", "A+", "B+", "AB+"],
    "A-": ["A-", "A+", "AB-", "AB+"],
    "A+": ["A+", "AB+"],
    "B-": ["B-", "B+", "AB-", "AB+"],
    "B+": ["B+", "AB+"],
    "AB-": ["AB-", "AB+"],
    "AB+": ["AB+"],
    };

    const gtxt = (g) => String(g || "").replace("-", "−");
    // one brand-matched colour per blood group (rose = A/B, sand = AB, mauve = O; lighter = positive)
    const GROUP_COLORS = {
        "A+": { bg: "#fde8e4", fg: "#6a1018" }, "A-": { bg: "#f4b6b2", fg: "#6a1018" },
        "B+": { bg: "#e9858d", fg: "#fff" },    "B-": { bg: "#c9525f", fg: "#fff" },
        "AB+": { bg: "#f1cfa0", fg: "#5a3a10" }, "AB-": { bg: "#d3a56f", fg: "#3f2608" },
        "O+": { bg: "#d9c6d2", fg: "#4a1a2a" }, "O-": { bg: "#a98a9a", fg: "#fff" },
    };
    const level = (on, min) => {
    if (!(min > 0)) return "Adequate";
    const r = on / min;
    return r < CRIT_RATIO ? "Critical" : r < 1 ? "Low" : "Adequate";
    };
    const pctTxt = (p) => (p == null ? "—" : p < 1 ? `${p}%` : `${Math.round(p * 10) / 10}%`);
    const lvlCls = (l) => (l === "Critical" ? "crit" : l === "Low" ? "warn" : "ok");
    const prCls = (u) => {
    const v = String(u || "").toLowerCase();
    return v.includes("crit") || v === "high" ? "pr-crit" : v === "medium" ? "pr-urg" : "pr-rtn";
    };
    const isOpenReq = (r) => r.status === "pending" || r.status === "matched";

    function BloodBankDashboardV9({ user, onLogout }) {
    const [active, setActive] = useState("dashboard");
    const [menuOpen, setMenuOpen] = useState(false);

    const [profile, setProfile] = useState(null);
    const [inventory, setInventory] = useState([]);
    const [donationHistory, setDonationHistory] = useState([]);
    const [auditLog, setAuditLog] = useState([]);
    const [auditLoading, setAuditLoading] = useState(false);
    const [donors, setDonors] = useState([]);
    const [requests, setRequests] = useState([]);
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    // filters
    const [reqTab, setReqTab] = useState("open");
    const [donorQ, setDonorQ] = useState("");
    const [donorGroup, setDonorGroup] = useState("");
    const [recipient, setRecipient] = useState("O+");

    // log donation form
    const [donorSearch, setDonorSearch] = useState("");
    const [donorResults, setDonorResults] = useState([]);
    const [selectedDonor, setSelectedDonor] = useState(null);
    const [units, setUnits] = useState("1");
    const [donationStatus, setDonationStatus] = useState("completed");
    const [remarks, setRemarks] = useState("");
    const [logging, setLogging] = useState(false);

    // appointments
    const [apptTab, setApptTab] = useState("upcoming");
    const [cancelAppt, setCancelAppt] = useState(null); // waiting for "Are you sure?"
    const [completeAppt, setCompleteAppt] = useState(null); // asks how many units were collected
    const [completeUnits, setCompleteUnits] = useState("1");
    const [completeErr, setCompleteErr] = useState("");
    const [apptSearch, setApptSearch] = useState("");
    const [apptResults, setApptResults] = useState([]);
    const [apptDonor, setApptDonor] = useState(null);
    const [apptWhen, setApptWhen] = useState("");
    const [apptNotes, setApptNotes] = useState("");
    const [booking, setBooking] = useState(false);

    // inline field messages (key = field); red message goes away when the field is edited
    const [fe, setFe] = useState({});
    const clearFe = (key) => setFe((p) => (p[key] ? { ...p, [key]: "" } : p));
    const [invErrors, setInvErrors] = useState({}); // blood_type_id -> message under that inventory box

    // reports
    const [reportMonths, setReportMonths] = useState(6);

    const isVerified = profile?.verified_status === "verified";

    useEffect(() => {
        window.scrollTo({ top: 0 });
    }, [active]);

    useEffect(() => {
        if (!menuOpen) return;
        const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [menuOpen]);

    // ---------- data ----------
    const loadAll = async (bankId) => {
        try {
        const [inv, don, dnr, req, apt] = await Promise.all([
            api.get(`/bloodbanks/${bankId}/inventory`),
            api.get(`/donations?blood_bank_id=${bankId}`),
            api.get("/donors"),
            api.get("/requests"),
            api.get(`/appointments?blood_bank_id=${bankId}`),
        ]);
        setInventory(inv.data);
        setDonationHistory(don.data);
        setDonors(dnr.data);
        setRequests(req.data);
        setAppointments(apt.data);
        } catch (err) {
        setError("Failed to load blood bank data.");
        }
    };

    const loadAudit = async (bankId) => {
        setAuditLoading(true);
        try {
        const res = await api.get(`/bloodbanks/${bankId}/inventory/audit?limit=100`);
        setAuditLog(res.data);
        } catch (err) {
        setError("Failed to load inventory history.");
        } finally {
        setAuditLoading(false);
        }
    };

    const loadProfile = async (silent = false) => {
        if (!silent) setLoading(true);
        setError("");
        try {
        const res = await api.get(`/bloodbanks/profile/${user.user_id}`);
        setProfile(res.data);
        await loadAll(res.data.blood_bank_id);
        } catch (err) {
        setError("Failed to load your profile.");
        } finally {
        setLoading(false);
        }
    };

    useEffect(() => {
        loadProfile();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (active === "audit" && profile) loadAudit(profile.blood_bank_id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, profile]);

    // ---------- actions ----------
    const go = (id) => {
        setActive(id);
        setMenuOpen(false);
        setMessage("");
        setError("");
    };

    const handleInventoryChange = async (blood_type_id, newValue) => {
        if (!isVerified) return;
        const bad = validate({ v: newValue }, { v: [required("Units"), unitsOrZero("Units")] }).v;
        if (bad) {
        setInvErrors((p) => ({ ...p, [blood_type_id]: bad }));
        return;
        }
        setInvErrors((p) => ({ ...p, [blood_type_id]: "" }));
        setError("");
        try {
        const res = await api.put(`/bloodbanks/${profile.blood_bank_id}/inventory`, {
            blood_type_id,
            units_available: newValue,
            changed_by: user.user_id,
        });
        if (res.data.changed) {
            setMessage("Inventory updated.");
            loadAll(profile.blood_bank_id);
        }
        } catch (err) {
        setError(err.response?.data?.message || "Failed to update inventory.");
        }
    };

    // change one group's minimum; value = null puts it back to the rarity-based default
    const handleMinimumChange = async (item, value) => {
        if (!isVerified) return;
        const key = `min-${item.blood_type_id}`;
        if (value !== null) {
        if (String(value).trim() === "" || Number(value) === Number(item.min_units)) return;
        const bad = validate({ v: value }, { v: [required("Minimum"), unitsOrZero("Minimum")] }).v;
        if (bad) {
            setInvErrors((p) => ({ ...p, [key]: bad }));
            return;
        }
        }
        setInvErrors((p) => ({ ...p, [key]: "" }));
        setError("");
        try {
        await api.put(`/bloodbanks/${profile.blood_bank_id}/inventory/minimum`, {
            blood_type_id: item.blood_type_id,
            min_units: value,
            changed_by: user.user_id,
        });
        setMessage(value === null ? `${gtxt(item.blood_type)} minimum reset to the default.` : `${gtxt(item.blood_type)} minimum updated.`);
        loadAll(profile.blood_bank_id);
        } catch (err) {
        setError(err.response?.data?.message || "Failed to update the minimum.");
        }
    };

    const handleDonorSearch = async (query) => {
        setDonorSearch(query);
        setSelectedDonor(null);
        if (query.trim().length < 2) {
        setDonorResults([]);
        return;
        }
        try {
        const res = await api.get(`/donors/search?q=${encodeURIComponent(query)}`);
        setDonorResults(res.data);
        } catch (err) {
        setDonorResults([]);
        }
    };

    const handleLogDonation = async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");
        const found = validate(
        { donor: selectedDonor ? "ok" : "", units, donationStatus, remarks },
        {
            donor: [(v) => (v ? "" : donorSearch.trim() ? "Pick a donor from the search results." : "Donor is required.")],
            units: [required("Units donated"), unitsRule("Units donated")],
            donationStatus: [required("Status"), oneOf(["completed", "deferred", "cancelled"], "Choose a status from the list.")],
            remarks: [maxLen(255, "Remarks")],
        }
        );
        setFe((p) => ({ ...p, log_donor: found.donor || "", log_units: found.units || "", log_status: found.donationStatus || "", log_remarks: found.remarks || "" }));
        if (hasErrors(found)) {
        focusFirstError(e.currentTarget);
        return;
        }
        setLogging(true);
        try {
        await api.post("/donations", {
            donor_id: selectedDonor.donor_id,
            blood_bank_id: profile.blood_bank_id,
            units,
            status: donationStatus,
            remarks: remarks || null,
        });
        setMessage(`Donation logged for ${selectedDonor.full_name} (${unitLabel(units)}).`);
        setSelectedDonor(null);
        setDonorSearch("");
        setDonorResults([]);
        setUnits("1");
        setDonationStatus("completed");
        setRemarks("");
        loadAll(profile.blood_bank_id);
        } catch (err) {
        setError(err.response?.data?.message || "Failed to log donation.");
        } finally {
        setLogging(false);
        }
    };

    // ----- appointments -----
    const handleApptSearch = async (q) => {
        setApptSearch(q);
        setApptDonor(null);
        if (q.trim().length < 2) {
        setApptResults([]);
        return;
        }
        try {
        const res = await api.get(`/donors/search?q=${encodeURIComponent(q)}`);
        setApptResults(res.data);
        } catch (err) {
        setApptResults([]);
        }
    };

    const handleBook = async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");
        const found = validate(
        { donor: apptDonor ? "ok" : "", when: apptWhen, notes: apptNotes },
        {
            donor: [(v) => (v ? "" : apptSearch.trim() ? "Pick a donor from the search results." : "Donor is required.")],
            when: [
            required("Date and time"),
            (v) => (v && v < nowLocalMin ? "Date and time can't be in the past." : ""),
            ],
            notes: [maxLen(255, "Notes")],
        }
        );
        setFe((p) => ({ ...p, appt_donor: found.donor || "", appt_when: found.when || "", appt_notes: found.notes || "" }));
        if (hasErrors(found)) {
        focusFirstError(e.currentTarget);
        return;
        }
        setBooking(true);
        try {
        await api.post("/appointments", {
            donor_id: apptDonor.donor_id,
            blood_bank_id: profile.blood_bank_id,
            scheduled_at: apptWhen,
            notes: apptNotes || null,
        });
        setMessage(`Appointment booked for ${apptDonor.full_name}.`);
        setApptDonor(null);
        setApptSearch("");
        setApptResults([]);
        setApptWhen("");
        setApptNotes("");
        loadAll(profile.blood_bank_id);
        } catch (err) {
        setError(err.response?.data?.message || "Failed to book appointment.");
        } finally {
        setBooking(false);
        }
    };

    const setApptStatus = async (id, status, extra = {}) => {
        setError("");
        setMessage("");
        try {
        await api.put(`/appointments/${id}`, { status, ...extra });
        setMessage(
            status === "cancelled" ? "Appointment cancelled."
            : status === "no_show" ? "Appointment marked as no-show."
            : "Appointment completed and donation recorded."
        );
        loadAll(profile.blood_bank_id);
        } catch (err) {
        setError(err.response?.data?.message || "Failed to update appointment.");
        }
    };

    if (loading) {
        return (
        <div className="bbv9">
            <p className="muted" style={{ padding: 24 }}><Loading label="Loading..." /></p>
        </div>
        );
    }

    // ---------- derived data ----------
    const stock = Object.fromEntries(inventory.map((i) => [i.blood_type, Number(i.units_available) || 0]));
    const invOf = Object.fromEntries(inventory.map((i) => [i.blood_type, i]));
    const minOf = (g) => Number(invOf[g]?.min_units) || 0;
    // one shared scale for every bar, so the black minimum line sits further right for common groups
    const barScale = Math.max(1, ...GROUPS.map((g) => minOf(g) * 1.5), ...GROUPS.map((g) => stock[g] || 0));
    const barPct = (v) => `${Math.min(100, (v / barScale) * 100)}%`;
    const rows = GROUPS.map((g) => {
        const on = stock[g] || 0;
        const min = minOf(g);
        const lvl = level(on, min);
        return { g, on, min, pct: invOf[g]?.population_pct, custom: !!invOf[g]?.min_is_custom, lvl, cls: lvlCls(lvl) };
    });
    const total = rows.reduce((s, r) => s + r.on, 0);
    const shortRows = rows.filter((r) => r.lvl !== "Adequate");
    const critRows = rows.filter((r) => r.lvl === "Critical");
    const openReqs = requests.filter(isOpenReq);
    const completed = donationHistory.filter((d) => d.status === "completed").length;
    const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const initials = (user.full_name || profile?.bank_name || "BB").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

    // appointments
    const apptTime = (a) => new Date(String(a.scheduled_at).replace(" ", "T"));
    const fmtWhen = (s) => {
        const d = new Date(String(s).replace(" ", "T"));
        return isNaN(d) ? "—" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    };
    const upcoming = appointments.filter((a) => a.status === "scheduled");
    const apptTabs = [
        { id: "upcoming", label: "Scheduled", list: upcoming },
        { id: "completed", label: "Completed", list: appointments.filter((a) => a.status === "completed") },
        { id: "closed", label: "Cancelled / no-show", list: appointments.filter((a) => a.status === "cancelled" || a.status === "no_show") },
        { id: "all", label: "All", list: appointments },
    ];
    const shownAppts = (apptTabs.find((t) => t.id === apptTab) || apptTabs[0]).list;
    const nowLocalMin = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

    // reports (built from this bank's donation records)
    const monthKey = (v) => String(v).slice(0, 7);
    const monthLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    const monthList = Array.from({ length: reportMonths }, (_, i) => {
        const d = new Date();
        d.setDate(1);
        d.setMonth(d.getMonth() - (reportMonths - 1 - i));
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
    const monthly = monthList.map((k) => {
        const list = donationHistory.filter((d) => monthKey(d.donation_date) === k);
        const done = list.filter((d) => d.status === "completed");
        return {
        k,
        label: monthLabel(k),
        collected: done.reduce((s, d) => s + Number(d.units ?? d.volume_ml / UNIT_ML), 0),
        completed: done.length,
        deferred: list.filter((d) => d.status === "deferred").length,
        cancelled: list.filter((d) => d.status === "cancelled").length,
        };
    });
    const maxCollected = Math.max(1, ...monthly.map((m) => m.collected));
    const stockScale = barScale;
    const exportCsv = () => {
        const head = ["Month", "Collected (units)", "Completed donations", "Deferred", "Cancelled"];
        const body = monthly.map((m) => [m.label, formatUnits(m.collected), m.completed, m.deferred, m.cancelled]);
        const csv = "\ufeff" + [head, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `bloodlink-collections-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const attention = [];
    if (!isVerified) {
        attention.push({ n: "!", cls: "warn", t: "Not verified yet", s: `Status: ${profile?.verified_status}. Inventory is read-only until an admin verifies your blood bank.`, tab: "profile" });
    }
    if (shortRows.length) {
        attention.push({ n: shortRows.length, cls: critRows.length ? "crit" : "warn", t: "Groups below minimum", s: shortRows.map((r) => `${gtxt(r.g)} ${r.lvl.toLowerCase()}`).join(", "), tab: "inventory" });
    }
    if (openReqs.length) {
        attention.push({ n: openReqs.length, cls: "warn", t: "Open blood requests", s: `${formatUnits(openReqs.reduce((s, r) => s + Number(r.quantity_needed || 0), 0))} units requested in total`, tab: "requests" });
    }

    const nav = [
        { h: "Operations" },
        { id: "dashboard", label: "Dashboard" },
        { id: "inventory", label: "Inventory" },
        { id: "requests", label: "Requests", cnt: openReqs.length },
        { id: "compat", label: "Compatibility" },
        { id: "analytics", label: "Predictive analytics" },
        { id: "appointments", label: "Appointments", cnt: upcoming.length },
        { h: "Records" },
        { id: "donors", label: "Donors", cnt: donors.length },
        { id: "log", label: "Log a donation" },
        { id: "history", label: "Donation history" },
        { id: "audit", label: "Inventory history" },
        { id: "reports", label: "Reports" },
        { h: "System" },
        { id: "notifications", label: "Notifications" },
        { id: "profile", label: "Edit profile" },
    ];
    const current = nav.find((n) => n.id === active) || nav[1];

    // ---------- screens ----------
    const Pill = ({ children }) => <span className="st">{children}</span>;

    const filteredDonors = donors.filter((d) => {
        const q = donorQ.trim().toLowerCase();
        const hit = !q || [d.full_name, d.email, d.contact_number].some((v) => String(v || "").toLowerCase().includes(q));
        return hit && (!donorGroup || d.blood_type === donorGroup);
    });

    const reqTabs = [
        { id: "open", label: "Open", list: openReqs },
        { id: "fulfilled", label: "Fulfilled", list: requests.filter((r) => r.status === "fulfilled") },
        { id: "cancelled", label: "Cancelled", list: requests.filter((r) => r.status === "cancelled") },
        { id: "all", label: "All", list: requests },
    ];
    const shownReqs = (reqTabs.find((t) => t.id === reqTab) || reqTabs[0]).list;

    const donorsFor = (r) =>
        GROUPS.filter((d) => CAN_GIVE[d].includes(r)).sort((a, b) => (a === r ? -1 : b === r ? 1 : CAN_GIVE[a].length - CAN_GIVE[b].length));

    return (
        <div className="bbv9">
        <div className="app">
            {/* ---------------- SIDEBAR ---------------- */}
            <aside className={`side ${menuOpen ? "open" : ""}`}>
            <div className="brand">
                <div className="brand-name">Blood<span>Link</span></div>
                <div className="brand-fac">{profile?.bank_name}</div>
            </div>
            <nav className="nav" aria-label="Blood bank portal sections">
                {nav.map((n, i) =>
                n.h ? (
                    <div className="nav-h" key={`h${i}`}>{n.h}</div>
                ) : (
                    <button key={n.id} type="button" className={active === n.id ? "on" : ""} aria-current={active === n.id ? "page" : undefined} onClick={() => go(n.id)}>
                    <span>{n.label}</span>
                    {n.cnt > 0 && <span className="cnt">{n.cnt}</span>}
                    </button>
                )
                )}
            </nav>
            </aside>
            {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}

            <div className="main">
            {/* ---------------- TOP BAR ---------------- */}
            <header className="top">
                <button type="button" className="top-btn menu-btn" aria-label="Open menu" onClick={() => setMenuOpen(true)}>Menu</button>
                <div className="crumbs"><span>{profile?.bank_name}</span> / <b>{current.label}</b></div>
                <div className="top-r">
                <NotificationBell userId={user.user_id} />
                <span className="vr" />
                <button type="button" className="top-btn" onClick={() => go("profile")} title="Edit profile" aria-label="Edit profile">
                    <span className="avatar">{initials}</span>
                    <span className="who"><b>{user.full_name || profile?.bank_name}</b><span>Blood bank</span></span>
                </button>
                <button type="button" className="top-btn" onClick={onLogout}>Log out</button>
                </div>
            </header>

            <main id="content">
                {message && <div className="msg ok">{message}</div>}
                {error && <div className="msg err">{error}</div>}

                {/* ============ REQUEST OUTLOOK (decision tree) ============ */}
                {active === "analytics" && (
                <section className="tab">
                    <div className="page-h"><div><h1>Predictive analytics</h1><p>How much blood will be requested in the coming weeks, and how long your stock will last.</p></div></div>
                    {profile?.blood_bank_id ? <DemandForecast bloodBankId={profile.blood_bank_id} /> : <Loading label="Loading..." />}
                </section>
                )}

                {/* ============ DASHBOARD ============ */}
                {active === "dashboard" && (
                <section className="tab">
                    <div className="page-h">
                    <div><h1>Operations overview</h1><p>{today} · {profile?.bank_name}</p></div>
                    <div className="actions">
                        <button type="button" className="btn" onClick={() => go("inventory")}>Open inventory</button>
                        <button type="button" className="btn pri" onClick={() => go("log")}>Log a donation</button>
                    </div>
                    </div>

                    <div className="grid-2">
                    <div className="supply">
                        <div>
                        <div className="lbl">Blood on hand</div>
                        <div className="big-row"><span className="big">{formatUnits(total)}</span><span className="unit">units</span></div>
                        </div>
                        <div>
                        <div className="mix" role="img" aria-label="On hand by blood group">
                            {rows.filter((r) => r.on > 0).map((r) => {
                            const c = GROUP_COLORS[r.g] || { bg: "#fde8e4", fg: "#6a1018" };
                            return (
                                <span key={r.g} style={{ flex: `${r.on} 1 0`, background: c.bg, color: c.fg }} title={`${gtxt(r.g)}: ${formatUnits(r.on)} units`}>
                                {r.on >= total * 0.08 ? gtxt(r.g) : ""}
                                </span>
                            );
                            })}
                        </div>
                        <div className="mix-key">
                            {rows.filter((r) => r.on > 0).map((r) => (
                            <span key={r.g}><i className="sw" style={{ background: (GROUP_COLORS[r.g] || {}).bg }} />{gtxt(r.g)} ({formatUnits(r.on)})</span>
                            ))}
                        </div>
                        <div className="mix-l">On hand by blood group, in proportion</div>
                        </div>
                        <div className="stats">
                        <div className="stat"><div className="k">Groups low</div><div className="v">{shortRows.length}</div></div>
                        <div className="stat"><div className="k">Open requests</div><div className="v">{openReqs.length}</div></div>
                        <div className="stat"><div className="k">Donations logged</div><div className="v">{donationHistory.length}</div></div>
                        <div className="stat"><div className="k">Completed</div><div className="v">{completed}</div></div>
                        </div>
                    </div>

                    <div className="panel">
                        <div className="panel-h"><h3>Needs attention</h3></div>
                        <ul className="attn">
                        {attention.length === 0 && <li className="ok-row">Nothing needs attention right now.</li>}
                        {attention.map((a, i) => (
                            <li key={i}>
                            <button type="button" onClick={() => go(a.tab)}>
                                <span className="t"><b>{a.t}</b><span>{a.s}</span></span>
                                <span className={`n ${a.cls}`}>{a.n}</span>
                            </button>
                            </li>
                        ))}
                        </ul>
                    </div>
                    </div>

                    <div className="panel">
                    <div className="panel-h">
                        <h3>Stock by blood group<span className="sub">Minimum per group is based on how common the blood type is</span></h3>
                        <div className="actions"><button type="button" className="link" onClick={() => go("inventory")}>Open inventory</button></div>
                    </div>
                    <div className="tw">
                        <table>
                        <thead><tr><th>Group</th><th className="r">Population</th><th className="r">On hand</th><th className="r">Minimum</th><th>Stock level</th><th>Status</th></tr></thead>
                        <tbody>
                            {rows.map((r) => (
                            <tr key={r.g}>
                                <td><b className="grp">{gtxt(r.g)}</b></td>
                                <td className="r num muted">{pctTxt(r.pct)}</td>
                                <td className="r num"><b>{formatUnits(r.on)}</b></td>
                                <td className="r num">{formatUnits(r.min)}{r.custom ? " *" : ""}</td>
                                <td><div className={`lvl ${r.cls === "ok" ? "" : r.cls}`} title={`Black line = minimum (${formatUnits(r.min)})`}><i style={{ width: barPct(r.on) }} /><b style={{ left: barPct(r.min) }} /></div></td>
                                <td><span className={`st ${r.cls}`}>{r.lvl}</span></td>
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                    </div>

                    <div className="grid-3">
                    <div className="panel">
                        <div className="panel-h"><h3>Open requests</h3><button type="button" className="link" onClick={() => go("requests")}>View all</button></div>
                        <div className="tw">
                        <table>
                            <thead><tr><th>Requester</th><th>Group</th><th className="r">Units</th><th>Priority</th></tr></thead>
                            <tbody>
                            {openReqs.length === 0 && <tr><td colSpan="4" className="empty">No open requests.</td></tr>}
                            {openReqs.slice(0, 5).map((q) => (
                                <tr key={q.request_id}>
                                <td className="wrap">{q.requester_name}</td>
                                <td><b className="grp">{gtxt(q.blood_type)}</b></td>
                                <td className="r num">{formatUnits(q.quantity_needed)}</td>
                                <td><span className={prCls(q.urgency_level)}>{prettify(q.urgency_level)}</span></td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                        </div>
                    </div>

                    <div className="panel">
                        <div className="panel-h"><h3>Recent donations</h3><button type="button" className="link" onClick={() => go("history")}>View all</button></div>
                        <div className="tw">
                        <table>
                            <thead><tr><th>Donor</th><th className="r">Units</th><th>Date</th><th>Status</th></tr></thead>
                            <tbody>
                            {donationHistory.length === 0 && <tr><td colSpan="4" className="empty">No donations logged yet.</td></tr>}
                            {donationHistory.slice(0, 5).map((d) => (
                                <tr key={d.donation_id}>
                                <td className="wrap">{d.donor_name}</td>
                                <td className="r num">{formatUnits(d.units ?? d.volume_ml / UNIT_ML)}</td>
                                <td>{d.donation_date}</td>
                                <td><Pill>{prettify(d.status)}</Pill></td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                        </div>
                    </div>
                    </div>
                </section>
                )}

                {/* ============ INVENTORY ============ */}
                {active === "inventory" && (
                <section className="tab">
                    <div className="page-h">
                    <div><h1>Inventory</h1><p>Blood on hand and the minimum to keep, by group. Edit a number and click outside the box to save.</p></div>
                    </div>
                    {!isVerified && (
                    <div className="msg err">Inventory is read-only until an admin verifies your blood bank (status: {profile?.verified_status}).</div>
                    )}
                    <div className="panel">
                    <div className="tw">
                        <table>
                        <thead><tr><th>Blood group</th><th className="r">Population</th><th className="r">Units available</th><th className="r">Minimum</th><th>Stock level</th><th>Status</th><th>Last updated</th></tr></thead>
                        <tbody>
                            {inventory.map((item) => {
                            const on = Number(item.units_available) || 0;
                            const min = Number(item.min_units) || 0;
                            const lvl = level(on, min);
                            const c = lvlCls(lvl);
                            return (
                                <tr key={`${item.blood_type_id}-${item.units_available}-${item.min_units}`}>
                                <td><b className="grp">{gtxt(item.blood_type)}</b></td>
                                <td className="r num muted">{pctTxt(item.population_pct)}</td>
                                <td className="r">
                                    <input
                                    className="in"
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    style={{ width: 90 }}
                                    disabled={!isVerified}
                                    defaultValue={formatUnits(item.units_available)}
                                    aria-invalid={!!invErrors[item.blood_type_id]}
                                    aria-describedby={`err-inv-${item.blood_type_id}`}
                                    onChange={() => setInvErrors((p) => (p[item.blood_type_id] ? { ...p, [item.blood_type_id]: "" } : p))}
                                    onBlur={(e) => handleInventoryChange(item.blood_type_id, e.target.value)}
                                    />
                                    <FieldError id={`err-inv-${item.blood_type_id}`} message={invErrors[item.blood_type_id]} />
                                </td>
                                <td className="r">
                                    <input
                                    className="in"
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    style={{ width: 80 }}
                                    disabled={!isVerified}
                                    defaultValue={formatUnits(min)}
                                    aria-label={`Minimum for ${item.blood_type}`}
                                    aria-invalid={!!invErrors[`min-${item.blood_type_id}`]}
                                    aria-describedby={`err-min-${item.blood_type_id}`}
                                    onChange={() => setInvErrors((p) => (p[`min-${item.blood_type_id}`] ? { ...p, [`min-${item.blood_type_id}`]: "" } : p))}
                                    onBlur={(e) => handleMinimumChange(item, e.target.value)}
                                    />
                                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                                    {item.min_is_custom ? (
                                        <button type="button" className="link" style={{ fontSize: 11 }} disabled={!isVerified} onClick={() => handleMinimumChange(item, null)}>
                                        Reset to {formatUnits(item.default_min_units)}
                                        </button>
                                    ) : "Default by rarity"}
                                    </div>
                                    <FieldError id={`err-min-${item.blood_type_id}`} message={invErrors[`min-${item.blood_type_id}`]} />
                                </td>
                                <td><div className={`lvl ${c === "ok" ? "" : c}`} title={`Black line = minimum (${formatUnits(min)})`}><i style={{ width: barPct(on) }} /><b style={{ left: barPct(min) }} /></div></td>
                                <td><span className={`st ${c}`}>{lvl}</span></td>
                                <td>{item.last_updated || "—"}</td>
                                </tr>
                            );
                            })}
                        </tbody>
                        </table>
                    </div>
                    <div className="foot-note"><span>{UNIT_HINT} The black line on each bar is that group&apos;s minimum. Default minimums follow how common each blood type is in the Philippines (O+ most common, Rh-negative under 1%); O− keeps a little extra because it can be given to anyone in an emergency.</span></div>
                    </div>
                </section>
                )}

                {/* ============ REQUESTS ============ */}
                {active === "requests" && (
                <section className="tab">
                    <div className="page-h">
                    <div><h1>Blood requests</h1><p>Requests posted by patients and hospitals. Donor matching is handled by the system.</p></div>
                    </div>
                    {profile?.verified_status === "verified" ? (
                        <CriticalReview requests={requests} onReviewed={() => loadAll(profile.blood_bank_id)} />
                    ) : (
                        <div className="msg err">Only a verified blood bank can confirm emergency requests.</div>
                    )}
                    <div className="panel">
                    <div className="tabs">
                        {reqTabs.map((t) => (
                        <button key={t.id} type="button" className={reqTab === t.id ? "on" : ""} onClick={() => setReqTab(t.id)}>
                            {t.label}<span className="c">{t.list.length}</span>
                        </button>
                        ))}
                    </div>
                    <div className="tw">
                        <table>
                        <thead><tr><th>Ref</th><th>Requester</th><th>Group</th><th className="r">Units</th><th>Priority</th><th>Location</th><th>Requested</th><th>Status</th></tr></thead>
                        <tbody>
                            {shownReqs.length === 0 && <tr><td colSpan="8" className="empty">Nothing here.</td></tr>}
                            {shownReqs.map((q) => (
                            <tr key={q.request_id}>
                                <td className="mono">#{q.request_id}</td>
                                <td className="wrap">{q.requester_name}</td>
                                <td><b className="grp">{gtxt(q.blood_type)}</b></td>
                                <td className="r num">{formatUnits(q.quantity_needed)}</td>
                                <td><span className={prCls(q.urgency_level)}>{prettify(q.urgency_level)}</span></td>
                                <td className="wrap">{q.location_needed || "—"}</td>
                                <td>{q.date_requested}</td>
                                <td><Pill>{prettify(q.status)}</Pill></td>
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                    </div>
                </section>
                )}

                {/* ============ COMPATIBILITY ============ */}
                {active === "compat" && (
                <section className="tab">
                    <div className="page-h">
                    <div><h1>Red cell compatibility</h1><p>ABO and Rh reference for choosing alternative units when the matching group is short.</p></div>
                    </div>
                    <div className="grid-3">
                    <div className="panel">
                        <div className="panel-h">
                        <h3>Compatible donor groups</h3>
                        <label className="muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            Recipient
                            <select className="in sel" style={{ width: 96 }} value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                            {GROUPS.map((g) => <option key={g} value={g}>{gtxt(g)}</option>)}
                            </select>
                        </label>
                        </div>
                        <div className="tw">
                        <table>
                            <thead><tr><th>Donor group</th><th>Preference</th><th className="r">In stock</th><th>Stock status</th></tr></thead>
                            <tbody>
                            {donorsFor(recipient).map((d) => {
                                const on = stock[d] || 0;
                                const lvl = level(on, minOf(d));
                                return (
                                <tr key={d}>
                                    <td><b className="grp">{gtxt(d)}</b></td>
                                    <td>{d === recipient ? "Same group" : d === "O-" ? "Universal donor, keep for emergencies" : "Compatible"}</td>
                                    <td className="r num"><b>{formatUnits(on)}</b></td>
                                    <td><span className={`st ${lvlCls(lvl)}`}>{lvl}</span></td>
                                </tr>
                                );
                            })}
                            </tbody>
                        </table>
                        </div>
                        <div className="foot-note"><span>Reference only. Confirm with crossmatch and follow the hospital transfusion protocol.</span></div>
                    </div>

                    <div className="panel">
                        <div className="panel-h"><h3>Compatibility matrix</h3><span className="muted">Donor (rows) to recipient (columns)</span></div>
                        <div className="tw">
                        <table className="matrix">
                            <thead>
                            <tr><th>Donor</th>{GROUPS.map((r) => <th key={r}>{gtxt(r)}</th>)}</tr>
                            </thead>
                            <tbody>
                            {GROUPS.map((d) => (
                                <tr key={d}>
                                <th><b className="grp">{gtxt(d)}</b></th>
                                {GROUPS.map((r) => (
                                    CAN_GIVE[d].includes(r)
                                    ? <td key={r} className="yes">✓</td>
                                    : <td key={r} className="no">–</td>
                                ))}
                                </tr>
                            ))}
                            </tbody>
                        </table>
                        </div>
                    </div>
                    </div>
                </section>
                )}

                {/* ============ APPOINTMENTS ============ */}
                {active === "appointments" && (
                <section className="tab">
                    <div className="page-h">
                    <div><h1>Appointments</h1><p>Donors scheduled to donate at {profile?.bank_name}.</p></div>
                    </div>
                    {!isVerified && (
                    <div className="msg err">Appointments can only be booked once an admin verifies your blood bank (status: {profile?.verified_status}).</div>
                    )}
                    <div className="grid-3">
                    <div className="panel">
                        <div className="tabs">
                        {apptTabs.map((t) => (
                            <button key={t.id} type="button" className={apptTab === t.id ? "on" : ""} onClick={() => setApptTab(t.id)}>
                            {t.label}<span className="c">{t.list.length}</span>
                            </button>
                        ))}
                        </div>
                        <div className="tw">
                        <table>
                            <thead><tr><th>Donor</th><th>Group</th><th>When</th><th>Status</th><th className="r">Actions</th></tr></thead>
                            <tbody>
                            {shownAppts.length === 0 && <tr><td colSpan="5" className="empty">No appointments here.</td></tr>}
                            {shownAppts.map((a) => {
                                const overdue = a.status === "scheduled" && apptTime(a) < new Date();
                                const tone = a.status === "completed" ? "ok" : a.status === "scheduled" ? (overdue ? "warn" : "info") : a.status === "no_show" ? "warn" : "crit";
                                return (
                                <tr key={a.appointment_id}>
                                    <td className="wrap">{a.donor_name}{a.notes && <span className="sub">{a.notes}</span>}</td>
                                    <td><b className="grp">{gtxt(a.blood_type)}</b></td>
                                    <td>{fmtWhen(a.scheduled_at)}</td>
                                    <td><span className={`st ${tone}`}>{overdue ? "Overdue" : prettify(a.status)}</span></td>
                                    <td className="r">
                                    {a.status === "scheduled" && (
                                        <span style={{ display: "inline-flex", gap: 6 }}>
                                        <button type="button" className="btn pri sm" onClick={() => { setCompleteUnits("1"); setCompleteErr(""); setCompleteAppt(a); }}>Complete</button>
                                        <button type="button" className="btn sm" onClick={() => setApptStatus(a.appointment_id, "no_show")}>No-show</button>
                                        <button type="button" className="btn danger sm" onClick={() => setCancelAppt(a)}>Cancel</button>
                                        </span>
                                    )}
                                    </td>
                                </tr>
                                );
                            })}
                            </tbody>
                        </table>
                        </div>
                    </div>

                    <div className="panel">
                        <div className="panel-h"><h3>Book an appointment</h3></div>
                        <form className="form-narrow" onSubmit={handleBook} noValidate>
                        <div className="search-wrap">
                            <label>Search donor (name or email)</label>
                            <input className="in" type="text" value={apptSearch} onChange={(e) => { handleApptSearch(e.target.value); clearFe("appt_donor"); }} placeholder="Start typing a name or email..." disabled={!isVerified} aria-invalid={!!fe.appt_donor} aria-describedby="err-appt-donor" />
                            <FieldError id="err-appt-donor" message={fe.appt_donor} />
                            {apptResults.length > 0 && (
                            <div className="dd">
                                {apptResults.map((d) => (
                                <button
                                    type="button"
                                    key={d.donor_id}
                                    onClick={() => {
                                    setApptDonor(d);
                                    setApptSearch(`${d.full_name} (${d.blood_type})`);
                                    setApptResults([]);
                                    }}
                                >
                                    {d.full_name} — {d.email} — {gtxt(d.blood_type)}
                                </button>
                                ))}
                            </div>
                            )}
                        </div>
                        <div>
                            <label>Date and time</label>
                            <input className="in" type="datetime-local" min={nowLocalMin} value={apptWhen} onChange={(e) => { setApptWhen(e.target.value); clearFe("appt_when"); }} disabled={!isVerified} aria-invalid={!!fe.appt_when} aria-describedby="err-appt-when" />
                            <FieldError id="err-appt-when" message={fe.appt_when} />
                        </div>
                        <div>
                            <label>Notes (optional)</label>
                            <input className="in" type="text" maxLength={255} value={apptNotes} onChange={(e) => { setApptNotes(e.target.value); clearFe("appt_notes"); }} disabled={!isVerified} aria-invalid={!!fe.appt_notes} aria-describedby="err-appt-notes" />
                            <FieldError id="err-appt-notes" message={fe.appt_notes} />
                        </div>
                        <div>
                            <button type="submit" className="btn pri" disabled={booking || !isVerified}>{booking ? "Booking..." : "Book appointment"}</button>
                        </div>
                        </form>
                    </div>
                    </div>
                </section>
                )}

                {/* ============ DONORS ============ */}
                {active === "donors" && (
                <section className="tab">
                    <div className="page-h">
                    <div><h1>Donors</h1><p>{donors.length} registered donors</p></div>
                    <div className="actions"><button type="button" className="btn pri" onClick={() => go("log")}>Log a donation</button></div>
                    </div>
                    <div className="panel">
                    <div className="toolbar">
                        <input className="in" type="search" placeholder="Name, email or phone" value={donorQ} onChange={(e) => setDonorQ(e.target.value)} aria-label="Search donors" />
                        <select className="in sel" value={donorGroup} onChange={(e) => setDonorGroup(e.target.value)} aria-label="Blood group">
                        <option value="">All groups</option>
                        {GROUPS.map((g) => <option key={g} value={g}>{gtxt(g)}</option>)}
                        </select>
                    </div>
                    <div className="tw tall">
                        <table>
                        <thead><tr><th>Name</th><th>Group</th><th>Contact</th><th>Email</th><th>Last donation</th><th>Availability</th><th>Eligibility</th></tr></thead>
                        <tbody>
                            {filteredDonors.length === 0 && <tr><td colSpan="7" className="empty">No donors match.</td></tr>}
                            {filteredDonors.map((d) => (
                            <tr key={d.donor_id}>
                                <td className="wrap">{d.full_name}</td>
                                <td><b className="grp">{gtxt(d.blood_type)}</b></td>
                                <td>{d.contact_number}</td>
                                <td className="wrap">{d.email}</td>
                                <td>{d.last_donation_date || "—"}</td>
                                <td><span className={`st ${d.availability_status === "available" ? "ok" : ""}`}>{prettify(d.availability_status)}</span></td>
                                <td><span className={`st ${d.eligibility_status === "eligible" ? "ok" : "warn"}`}>{prettify(d.eligibility_status)}</span></td>
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                    <div className="foot-note"><span>Showing {filteredDonors.length} of {donors.length}</span></div>
                    </div>
                </section>
                )}

                {/* ============ LOG A DONATION ============ */}
                {active === "log" && (
                <section className="tab">
                    <div className="page-h"><div><h1>Log a donation</h1><p>Record a donation received at {profile?.bank_name}.</p></div></div>
                    <div className="panel">
                    <form className="form-narrow" onSubmit={handleLogDonation} noValidate>
                        <div className="search-wrap">
                        <label>Search donor (name or email)</label>
                        <input className="in" type="text" value={donorSearch} onChange={(e) => { handleDonorSearch(e.target.value); clearFe("log_donor"); }} placeholder="Start typing a name or email..." aria-invalid={!!fe.log_donor} aria-describedby="err-log-donor" />
                        <FieldError id="err-log-donor" message={fe.log_donor} />
                        {donorResults.length > 0 && (
                            <div className="dd">
                            {donorResults.map((d) => (
                                <button
                                type="button"
                                key={d.donor_id}
                                onClick={() => {
                                    setSelectedDonor(d);
                                    setDonorSearch(`${d.full_name} (${d.blood_type})`);
                                    setDonorResults([]);
                                }}
                                >
                                {d.full_name} — {d.email} — {gtxt(d.blood_type)}
                                </button>
                            ))}
                            </div>
                        )}
                        </div>
                        {selectedDonor && <div className="muted">Selected: <b>{selectedDonor.full_name}</b> ({gtxt(selectedDonor.blood_type)})</div>}
                        <div>
                        <label>Units donated</label>
                        <input className="in" type="number" min="0.5" step="0.5" value={units} onChange={(e) => { setUnits(e.target.value); clearFe("log_units"); }} aria-invalid={!!fe.log_units} aria-describedby="err-log-units" />
                        <FieldError id="err-log-units" message={fe.log_units} />
                        <div className="muted" style={{ marginTop: 4 }}>{UNIT_HINT}</div>
                        </div>
                        <div>
                        <label>Status</label>
                        <select className="in sel" value={donationStatus} onChange={(e) => { setDonationStatus(e.target.value); clearFe("log_status"); }} aria-invalid={!!fe.log_status} aria-describedby="err-log-status">
                            <option value="completed">Completed</option>
                            <option value="deferred">Deferred</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                        <FieldError id="err-log-status" message={fe.log_status} />
                        </div>
                        <div>
                        <label>Remarks (optional)</label>
                        <input className="in" type="text" value={remarks} onChange={(e) => { setRemarks(e.target.value); clearFe("log_remarks"); }} aria-invalid={!!fe.log_remarks} aria-describedby="err-log-remarks" />
                        <FieldError id="err-log-remarks" message={fe.log_remarks} />
                        </div>
                        <div>
                        <button type="submit" className="btn pri" disabled={logging}>{logging ? "Logging..." : "Log donation"}</button>
                        </div>
                    </form>
                    </div>
                </section>
                )}

                {/* ============ DONATION HISTORY ============ */}
                {active === "history" && (
                <section className="tab">
                    <div className="page-h"><div><h1>Donation history</h1><p>Every donation logged by this blood bank.</p></div></div>
                    <div className="panel">
                    <div className="tw tall">
                        <table>
                        <thead><tr><th>Donor</th><th className="r">Units</th><th>Date</th><th>Status</th></tr></thead>
                        <tbody>
                            {donationHistory.length === 0 && <tr><td colSpan="4" className="empty">No donations logged yet.</td></tr>}
                            {donationHistory.map((d) => (
                            <tr key={d.donation_id}>
                                <td className="wrap">{d.donor_name}</td>
                                <td className="r num">{formatUnits(d.units ?? d.volume_ml / UNIT_ML)}</td>
                                <td>{d.donation_date}</td>
                                <td><Pill>{prettify(d.status)}</Pill></td>
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                    </div>
                </section>
                )}

                {/* ============ INVENTORY HISTORY ============ */}
                {active === "audit" && (
                <section className="tab">
                    <div className="page-h"><div><h1>Inventory history</h1><p>Every change to your stock numbers, with who made it.</p></div></div>
                    <div className="panel">
                    <div className="tw tall">
                        <table>
                        <thead><tr><th>When</th><th>Group</th><th className="r">Old</th><th className="r">New</th><th className="r">Change</th><th>Changed by</th></tr></thead>
                        <tbody>
                            {auditLoading && <tr><td colSpan="6" className="empty"><Loading label="Loading history..." /></td></tr>}
                            {!auditLoading && auditLog.length === 0 && <tr><td colSpan="6" className="empty">No inventory changes recorded yet.</td></tr>}
                            {!auditLoading && auditLog.map((a) => (
                            <tr key={a.audit_id}>
                                <td>{a.changed_at}</td>
                                <td><b className="grp">{gtxt(a.blood_type)}</b></td>
                                <td className="r num">{formatUnits(a.old_units)}</td>
                                <td className="r num">{formatUnits(a.new_units)}</td>
                                <td className="r num"><b style={{ color: a.change_units > 0 ? "var(--green)" : "var(--red)" }}>{formatChange(a.change_units)}</b></td>
                                <td>{a.changed_by_name}</td>
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                    </div>
                </section>
                )}

                {/* ============ REPORTS ============ */}
                {active === "reports" && (
                <section className="tab">
                    <div className="page-h">
                    <div><h1>Reports</h1><p>Collections and stock for {profile?.bank_name}, from your donation records.</p></div>
                    <div className="actions">
                        <select className="in sel" style={{ width: 150 }} value={reportMonths} onChange={(e) => setReportMonths(Number(e.target.value))} aria-label="Period">
                        <option value={3}>Last 3 months</option>
                        <option value={6}>Last 6 months</option>
                        <option value={12}>Last 12 months</option>
                        </select>
                        <button type="button" className="btn" onClick={exportCsv}>Export CSV</button>
                        <button type="button" className="btn" onClick={() => window.print()}>Print</button>
                    </div>
                    </div>

                    <div className="grid-eq">
                    <div className="panel">
                        <div className="panel-h"><h3>Collections</h3><span className="muted">Units per month (completed donations)</span></div>
                        <div className="bb-bars">
                        {monthly.map((m) => (
                            <div className="bb-bar" key={m.k}>
                            <div className="bb-col">
                                <div className="bb-stack" style={{ height: `${(m.collected / maxCollected) * 100}%` }}>
                                <span className="v">{formatUnits(m.collected)}</span>
                                </div>
                            </div>
                            <span className="l">{m.label}</span>
                            </div>
                        ))}
                        </div>
                    </div>

                    <div className="panel">
                        <div className="panel-h"><h3>On hand against minimum</h3><span className="muted">Black line = each group&apos;s minimum</span></div>
                        <div className="bb-bars">
                        {rows.map((r) => (
                            <div className="bb-bar" key={r.g}>
                            <div className="bb-col" style={{ position: "relative" }}>
                                <span className="bb-min" style={{ bottom: `${(r.min / stockScale) * 100}%` }} title={`Minimum ${formatUnits(r.min)}`} />
                                <div className={`bb-stack ${r.cls}`} style={{ height: `${(r.on / stockScale) * 100}%` }}>
                                <span className="v">{formatUnits(r.on)}</span>
                                </div>
                            </div>
                            <span className="l">{gtxt(r.g)}</span>
                            </div>
                        ))}
                        </div>
                        <div className="legend">
                        <span><i className="sw" style={{ background: "var(--green)" }} />Adequate</span>
                        <span><i className="sw" style={{ background: "var(--amber)" }} />Low</span>
                        <span><i className="sw" style={{ background: "var(--alert)" }} />Critical</span>
                        </div>
                        <div className="foot-note"><span>Below the group&apos;s minimum is Low; below half of it is Critical.</span></div>
                    </div>
                    </div>

                    <div className="panel">
                    <div className="panel-h"><h3>Monthly summary</h3></div>
                    <div className="tw">
                        <table>
                        <thead>
                            <tr><th>Month</th><th className="r">Collected (units)</th><th className="r">Completed</th><th className="r">Deferred</th><th className="r">Cancelled</th></tr>
                        </thead>
                        <tbody>
                            {[...monthly].reverse().map((m) => (
                            <tr key={m.k}>
                                <td>{m.label}</td>
                                <td className="r num"><b>{formatUnits(m.collected)}</b></td>
                                <td className="r num">{m.completed}</td>
                                <td className="r num">{m.deferred}</td>
                                <td className="r num">{m.cancelled}</td>
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                    <div className="foot-note"><span>Issued units, wastage and hospital figures are not tracked yet.</span></div>
                    </div>
                </section>
                )}

                {/* ============ NOTIFICATIONS ============ */}
                {active === "notifications" && (
                <section className="tab">
                    <div className="page-h"><div><h1>Notifications</h1><p>Updates about your blood bank.</p></div></div>
                    <div className="bbv9-embed"><NotificationsSection userId={user.user_id} /></div>
                </section>
                )}

                {/* ============ EDIT PROFILE ============ */}
                {active === "profile" && (
                <section className="tab">
                    <div className="page-h"><div><h1>Edit profile</h1><p>Blood bank details and sign-in settings.</p></div></div>
                    <div className="bbv9-embed"><ProfileSection userId={user.user_id} onSaved={() => loadProfile(true)} /></div>
                </section>
                )}
            </main>
            </div>
        </div>

        <ConfirmDialog
            open={!!cancelAppt}
            title="Cancel this appointment?"
            message={cancelAppt ? `${cancelAppt.donor_name}'s appointment on ${fmtWhen(cancelAppt.scheduled_at)} will be cancelled and they will be notified.` : ""}
            confirmLabel="Yes, cancel"
            cancelLabel="No, go back"
            onCancel={() => setCancelAppt(null)}
            onConfirm={() => {
            const id = cancelAppt.appointment_id;
            setCancelAppt(null);
            setApptStatus(id, "cancelled");
            }}
        />

        <ConfirmDialog
            open={!!completeAppt}
            danger={false}
            title="Complete this appointment?"
            message={completeAppt ? `This records ${completeAppt.donor_name}'s donation at your blood bank and thanks them in the app.` : ""}
            confirmLabel="Complete and record"
            cancelLabel="Not yet"
            onCancel={() => setCompleteAppt(null)}
            onConfirm={() => {
            if (String(completeUnits).trim() === "") {
                setCompleteErr("Units collected is required.");
                return;
            }
            if (!isValidUnits(completeUnits)) {
                setCompleteErr(UNIT_ERROR);
                return;
            }
            const id = completeAppt.appointment_id;
            const collected = completeUnits;
            setCompleteAppt(null);
            setApptStatus(id, "completed", { units: collected });
            }}
        >
            {/* inline styles: this dialog is portaled outside .bbv9, so scoped classes would not apply */}
            <div style={{ textAlign: "left", margin: "0 0 20px" }}>
            <label htmlFor="complete-units" style={{ display: "block", marginBottom: 6, fontSize: 13, fontWeight: 600, color: "#2b1a1d" }}>
                Units collected
            </label>
            <input
                id="complete-units"
                type="number"
                min="0.5"
                step="0.5"
                value={completeUnits}
                aria-invalid={!!completeErr}
                onChange={(e) => { setCompleteUnits(e.target.value); setCompleteErr(""); }}
                style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 14, fontFamily: "inherit", border: "1.5px solid #ecd9db", borderRadius: 10 }}
            />
            <small style={{ display: "block", marginTop: 6, fontSize: 12, color: "#8a8a92" }}>{UNIT_HINT}</small>
            {completeErr && <p style={{ margin: "8px 0 0", fontSize: 13, color: "#a12a2a" }}>{completeErr}</p>}
            </div>
        </ConfirmDialog>
        </div>
    );
    }

    export default BloodBankDashboardV9;