import { useState, useEffect, useRef } from "react";
import api from "../api";
import NotificationBell, { NotificationsSection } from "./NotificationBell";
import ProfileSection from "./ProfileSection";
import AuditLogs from "./AuditLogs";
import LoginHistory from "./LoginHistory";
import DemandForecast from "./DemandForecast";
import ConfirmDialog from "./ConfirmDialog";
import CriticalReview from "./CriticalReview";
import UserFormModal from "./UserFormModal";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatUnits, formatChange, UNIT_ML } from "./units";
import "./dashboard.css";
import "./bloodbank-v9.css";
import Loading from "./Loading";

const USER_TONE = { active: "ok", pending: "warn", disabled: "crit" };
const VERIFY_TONE = { verified: "ok", pending: "warn", rejected: "crit" };
const REQUEST_TONE = { pending: "warn", matched: "info", fulfilled: "ok" };
const URGENCY_TONE = { medium: "info", high: "warn", critical: "crit" };

const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const gtxt = (g) => String(g || "").replace("-", "−");
const isOpenReq = (r) => r.status === "pending" || r.status === "matched";

const SUBTITLES = {
  overview: "What is happening across all of BloodLink.",
  users: "Add, edit, activate or disable accounts.",
  bloodbanks: "Review blood banks and verify their licenses.",
  requests: "All blood requests posted in the system (read-only).",
  audit: "Every inventory change made by blood banks and admins.",
  auditlogs: "Account, verification and security actions recorded by the system.",
  loginhistory: "Every sign-in attempt, with the time, device and result.",
  reports: "Totals, monthly trends and downloadable CSV files.",
  analytics: "How much blood will be requested in the coming weeks, and how long the stock of all verified banks will last.",
  profile: "Your details and sign-in settings.",
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

// ---------- helpers for reports ----------
const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
// cols = [[key, "Header"], ...]
const downloadCsv = (name, cols, rows) => {
  const head = cols.map((c) => csvCell(c[1])).join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(r[c[0]])).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + head + "\n" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bloodlink-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const monthKey = (v) => {
  const d = new Date(v);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

// ---------- line chart: units collected (solid) vs issued (dashed) per month ----------
// rows = [{ label: "May", collected: 318, issued: 301 }, ...]; a label ending in "*" is month to date
const LINE_COLLECTED = "#86111a";
const LINE_ISSUED = "#5b6b7e";

const niceMax = (v) => {
  if (v <= 0) return 10;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / step) * step;
};

function TrendChart({ rows = [] }) {
  const W = 520, H = 200;
  const pad = { l: 36, r: 14, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const max = niceMax(Math.max(0, ...rows.flatMap((r) => [r.collected, r.issued])));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const x = (i) => pad.l + (rows.length > 1 ? (i / (rows.length - 1)) * iw : iw / 2);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const path = (key) => rows.map((r, i) => `${i ? "L" : "M"}${x(i)},${y(r[key])}`).join(" ");
  const empty = rows.every((r) => r.collected === 0 && r.issued === 0);

  return (
    <div className="chart">
      <div className="legend">
        <span><i className="sw" style={{ background: LINE_COLLECTED }} />Collected</span>
        <span><i className="sw" style={{ background: LINE_ISSUED }} />Issued</span>
        <span className="muted">* month to date</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Units collected and issued per month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eceef2" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="ct">{t}</text>
          </g>
        ))}
        {rows.map((r, i) => (
          <text key={r.label} x={x(i)} y={H - 8} textAnchor="middle" className="ct">{r.label}</text>
        ))}

        <path d={path("issued")} fill="none" stroke={LINE_ISSUED} strokeWidth="2.5" strokeDasharray="6 4" strokeLinejoin="round" />
        <path d={path("collected")} fill="none" stroke={LINE_COLLECTED} strokeWidth="2.5" strokeLinejoin="round" />

        {rows.map((r, i) => (
          <g key={r.label}>
            <circle cx={x(i)} cy={y(r.issued)} r="4.5" fill="#fff" stroke={LINE_ISSUED} strokeWidth="2">
              <title>{`${r.label}: ${r.issued} issued`}</title>
            </circle>
            <circle cx={x(i)} cy={y(r.collected)} r="4.5" fill="#fff" stroke={LINE_COLLECTED} strokeWidth="2">
              <title>{`${r.label}: ${r.collected} collected`}</title>
            </circle>
          </g>
        ))}

        {empty && (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="ct">No donations or fulfilled requests in the last 6 months.</text>
        )}
      </svg>
    </div>
  );
}

// ---------- bar chart: units donated (green) vs requested (red) per blood group ----------
// rows = [{ g: "A+", donated: 4, requested: 6 }, ...]
const LINE_DONATED = "#2e7d32";
const LINE_REQUESTED = "#c62828";

function BloodTypeBars({ rows = [] }) {
  const W = 520, H = 230;
  const pad = { l: 36, r: 16, t: 16, b: 30 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  let max = Math.max(0, ...rows.flatMap((r) => [r.donated, r.requested]));
  max = Math.max(4, Math.ceil(max / 4) * 4); // multiple of 4 so every tick is a whole unit
  const ticks = [0, 1, 2, 3, 4].map((f) => (max / 4) * f);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const slot = iw / Math.max(rows.length, 1);
  const barW = Math.min(18, slot * 0.34);
  const gap = 3;
  const cx = (i) => pad.l + slot * i + slot / 2;
  const empty = rows.every((r) => r.donated === 0 && r.requested === 0);

  const Bar = ({ x, v, color, label }) => (
    <g>
      <rect x={x} y={y(v)} width={barW} height={Math.max(0, pad.t + ih - y(v))} fill={color} rx="2">
        <title>{label}</title>
      </rect>
      {v > 0 && <text x={x + barW / 2} y={y(v) - 4} textAnchor="middle" className="ct">{formatUnits(v)}</text>}
    </g>
  );

  return (
    <div className="chart">
      <div className="legend">
        <span><i className="sw" style={{ background: LINE_DONATED }} />Donated</span>
        <span><i className="sw" style={{ background: LINE_REQUESTED }} />Requested</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Units donated and requested per blood group">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#eceef2" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="ct">{t}</text>
          </g>
        ))}
        {rows.map((r, i) => (
          <g key={r.g}>
            <Bar x={cx(i) - barW - gap / 2} v={r.donated} color={LINE_DONATED} label={`${gtxt(r.g)}: ${formatUnits(r.donated)} donated`} />
            <Bar x={cx(i) + gap / 2} v={r.requested} color={LINE_REQUESTED} label={`${gtxt(r.g)}: ${formatUnits(r.requested)} requested`} />
            <text x={cx(i)} y={H - 10} textAnchor="middle" className="cv">{gtxt(r.g)}</text>
          </g>
        ))}
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" className="ct">Nothing recorded yet.</text>}
      </svg>
    </div>
  );
}

// ---------- read-only map: blood banks (red) and open blood requests (amber / orange) ----------
const PH_BOUNDS = [[4.2, 116.0], [21.5, 127.0]];
const PH_CENTER = [12.8797, 121.774];
const MAP_RED = "#c62828";
const MAP_AMBER = "#f9a825";
const MAP_ORANGE = "#e65100";

const toNum = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};
const inPH = (la, ln) => la >= 4.2 && la <= 21.5 && ln >= 116 && ln <= 127;

// tooltip content built with textContent so names can never inject HTML
const tip = (title, sub) => {
  const el = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = title;
  el.appendChild(b);
  if (sub) {
    const s = document.createElement("div");
    s.textContent = sub;
    s.style.fontSize = "12px";
    s.style.color = "#555";
    el.appendChild(s);
  }
  return el;
};

function AdminMap({ banks = [], requests = [], height = 420 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  // create the map once
  useEffect(() => {
    const map = L.map(containerRef.current, {
      minZoom: 5,
      maxBounds: PH_BOUNDS,
      maxBoundsViscosity: 1.0,
    }).setView(PH_CENTER, 6);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize({ pan: false }), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  const bankPoints = banks
    .map((b) => ({ b, la: toNum(b.latitude), ln: toNum(b.longitude) }))
    .filter((p) => p.la !== null && p.ln !== null && inPH(p.la, p.ln));
  const reqPoints = requests
    .map((r) => ({ r, la: toNum(r.latitude), ln: toNum(r.longitude) }))
    .filter((p) => p.la !== null && p.ln !== null && inPH(p.la, p.ln));

  // only redraw (and re-zoom) when the points really change, not on every re-render of the dashboard
  const pointsKey = JSON.stringify([
    bankPoints.map((p) => [p.b.blood_bank_id, p.la, p.ln]),
    reqPoints.map((p) => [p.r.request_id, p.la, p.ln, p.r.urgency_level]),
  ]);

  // draw the markers whenever the data changes
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const pts = [];

    reqPoints.forEach(({ r, la, ln }) => {
      const critical = String(r.urgency_level).toLowerCase() === "critical";
      L.circleMarker([la, ln], {
        radius: critical ? 8 : 6,
        color: "#fff",
        weight: 1.5,
        fillColor: critical ? MAP_ORANGE : MAP_AMBER,
        fillOpacity: 0.95,
      })
        .bindTooltip(
          tip(
            `Request #${r.request_id} · ${gtxt(r.blood_type)}`,
            `${r.requester_name || ""} · ${r.urgency_level || ""}${r.location_needed ? " · " + r.location_needed : ""}`
          )
        )
        .addTo(layer);
      pts.push([la, ln]);
    });

    bankPoints.forEach(({ b, la, ln }) => {
      L.circleMarker([la, ln], {
        radius: 10,
        color: "#fff",
        weight: 2,
        fillColor: MAP_RED,
        fillOpacity: 1,
      })
        .bindTooltip(tip(b.bank_name, b.address || b.location || ""))
        .addTo(layer);
      pts.push([la, ln]);
    });

    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 12 });
    else if (pts.length === 1) map.setView(pts[0], 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey]);

  const legendRow = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#333" };
  const dot = (c, s) => ({ width: s, height: s, borderRadius: "50%", background: c, border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,0.25)", flexShrink: 0 });

  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid #e3e3e3" }}>
      <div ref={containerRef} style={{ height, width: "100%", zIndex: 0 }} />
      <div
        style={{
          position: "absolute", left: 10, bottom: 22, zIndex: 500, background: "rgba(255,255,255,0.95)",
          borderRadius: 10, padding: "8px 12px", boxShadow: "0 2px 10px rgba(0,0,0,0.18)", display: "grid", gap: 5,
        }}
      >
        <div style={legendRow}>
          <span style={dot(MAP_RED, 14)} />
          Blood banks ({bankPoints.length} of {banks.length} on the map)
        </div>
        <div style={legendRow}>
          <span style={dot(MAP_AMBER, 10)} />
          Open requests ({reqPoints.length} of {requests.length})
        </div>
        <div style={legendRow}>
          <span style={dot(MAP_ORANGE, 12)} />
          Critical request
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ user, onLogout }) {
  const [active, setActive] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false); // mobile sidebar drawer
  const contentRef = useRef(null);

  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [searchInput, setSearchInput] = useState(""); // what is typed in the search box
  const [search, setSearch] = useState("");           // the search that is applied (after pressing Search)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [bloodbanks, setBloodbanks] = useState([]);
  const [bbLoading, setBbLoading] = useState(true);

  // "Are you sure?" for destructive actions: { title, message, confirmLabel, onConfirm }
  const [confirm, setConfirm] = useState(null);

  // add / edit user dialog: null (closed) or { mode: "add" | "edit", initial }
  const [userForm, setUserForm] = useState(null);

  const openEditUser = async (u) => {
    setMessage("");
    setError("");
    try {
      const res = await api.get(`/profile/${u.user_id}`); // full details (address, bank name ...)
      setUserForm({ mode: "edit", initial: { ...res.data, password: "" } });
    } catch (err) {
      setError(err.response?.data?.message || "Could not load that user.");
    }
  };

  const onUserSaved = (msg) => {
    setUserForm(null);
    setMessage(msg);
    fetchUsers(filter);
    fetchBloodbanks();
    loadOverview();
  };

  const [auditLog, setAuditLog] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditBank, setAuditBank] = useState(""); // "" = all blood banks

  // overview / reports data (everything in one place)
  const [ov, setOv] = useState(null);
  const [ovLoading, setOvLoading] = useState(true);
  const [ovUpdated, setOvUpdated] = useState(null);
  const [reqFilter, setReqFilter] = useState("open");

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

  const fetchUsers = async (statusFilter) => {
    setLoading(true);
    setError("");
    try {
      const url = statusFilter ? `/admin/users?status=${statusFilter}` : "/admin/users";
      const response = await api.get(url);
      setUsers(response.data);
    } catch (err) {
      setError("Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  const fetchBloodbanks = async () => {
    setBbLoading(true);
    try {
      const response = await api.get("/admin/bloodbanks");
      setBloodbanks(response.data);
    } catch (err) {
      setError("Failed to load blood banks.");
    } finally {
      setBbLoading(false);
    }
  };

  // loads everything the overview and reports need. Each source can fail on its own without breaking the page.
  const loadOverview = async () => {
    setOvLoading(true);
    const failed = new Set();
    const get = async (label, url) => {
      try {
        return (await api.get(url)).data;
      } catch {
        failed.add(label);
        return null;
      }
    };
    const [u, b, d, r, dn, au] = await Promise.all([
      get("users", "/admin/users"),
      get("blood banks", "/admin/bloodbanks"),
      get("donors", "/donors"),
      get("requests", "/requests"),
      get("donations", "/donations"),
      get("recent activity", "/admin/inventory-audit?limit=8"),
    ]);
    setOv({
      users: u || [],
      banks: b || [],
      donors: d || [],
      requests: r || [],
      donations: dn || [],
      audit: au || [],
      failed: [...failed],
    });
    setOvUpdated(new Date());
    setOvLoading(false);
  };

  useEffect(() => {
    fetchUsers(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    fetchBloodbanks();
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // inventory audit log: reload when the screen opens or the bank filter changes
  useEffect(() => {
    if (active !== "audit") return;
    let cancelled = false;
    (async () => {
      setAuditLoading(true);
      try {
        const q = auditBank ? `?blood_bank_id=${auditBank}&limit=200` : "?limit=200";
        const res = await api.get(`/admin/inventory-audit${q}`);
        if (!cancelled) setAuditLog(res.data);
      } catch (err) {
        if (!cancelled) setError("Failed to load inventory audit log.");
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, auditBank]);

  const updateStatus = async (userId, newStatus) => {
    setMessage("");
    setError("");
    try {
      await api.put(`/admin/users/${userId}/status`, { account_status: newStatus });
      setMessage(`Account updated to "${newStatus}".`);
      fetchUsers(filter);
      loadOverview();
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to update account.";
      setError(msg);
    }
  };

  const updateBloodbankVerification = async (blood_bank_id, newStatus) => {
    setMessage("");
    setError("");
    try {
      await api.put(`/admin/bloodbanks/${blood_bank_id}/verify`, { verified_status: newStatus });
      const accountNote =
        newStatus === "verified" ? " Its login account is now active."
        : newStatus === "rejected" ? " Its login stays active so it can correct its details and re-apply."
        : "";
      setMessage(`Blood bank verification updated to "${newStatus}".${accountNote}`);
      fetchBloodbanks();
      fetchUsers(filter); // the account status changed too
      loadOverview();
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to update verification.";
      setError(msg);
    }
  };

  const downloadAudit = async () => {
    setError("");
    try {
      const res = await api.get("/admin/inventory-audit?limit=1000");
      downloadCsv(
        "inventory-audit",
        [["changed_at", "When"], ["bank_name", "Blood bank"], ["blood_type", "Blood type"], ["old_units", "Old units"], ["new_units", "New units"], ["change_units", "Change"], ["changed_by_name", "Changed by"]],
        res.data
      );
    } catch (err) {
      setError("Could not download the inventory audit log.");
    }
  };

  const pendingBanks = bloodbanks.filter((bb) => bb.verified_status === "pending").length;
  const pendingCritical = (ov?.requests || []).filter(
    (r) => r.critical_status === "pending" && (r.status === "pending" || r.status === "matched")
  ).length;
  // user search: name, email, contact number, role or status
  const visibleUsers = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [u.full_name, u.email, u.contact_number, u.role, u.account_status]
      .some((v) => String(v ?? "").toLowerCase().includes(q));
  });
  // filters live: results show from the first letter typed, no need to press Search
  const onUserSearchChange = (value) => {
    setSearchInput(value);
    setSearch(value);
    if (value.trim() && filter !== "") setFilter(""); // search across all statuses
  };
  const runUserSearch = (e) => e.preventDefault(); // Enter / Search button: the list is already filtered
  const clearUserSearch = () => {
    setSearchInput("");
    setSearch("");
  };

  const pendingUsers = ov ? ov.users.filter((u) => u.account_status === "pending").length : 0;

  // sidebar groups
  const groups = [
    {
      heading: "Overview",
      items: [
        { id: "overview", label: "Dashboard", title: "System overview" },
        { id: "reports", label: "Reports" },
        { id: "analytics", label: "Predictive analytics", title: "Predictive analytics" },
      ],
    },
    {
      heading: "Management",
      items: [
        { id: "users", label: "User accounts", title: "Manage users", badge: pendingUsers },
        { id: "bloodbanks", label: "Blood bank verification", badge: pendingBanks, crit: true },
      ],
    },
    {
      heading: "Records",
      items: [
        { id: "requests", label: "Blood requests", badge: pendingCritical, crit: true },
        { id: "audit", label: "Inventory audit" },
        { id: "auditlogs", label: "Audit logs" },
        { id: "loginhistory", label: "Login history" },
      ],
    },
    {
      heading: "System",
      items: [
        { id: "notifications", label: "Notifications" },
        { id: "profile", label: "Edit profile" },
      ],
    },
  ];
  const flat = groups.flatMap((g) => g.items);
  const current = flat.find((i) => i.id === active) || flat[0];
  const title = current.title || current.label;
  const displayName = user?.full_name || "Admin";

  // ---------- numbers for the dashboard and reports ----------
  let o = null;
  if (ov) {
    const members = ov.users.filter((u) => ["member", "donor", "requester"].includes(u.role)).length;
    const verifiedBanks = ov.banks.filter((b) => b.verified_status === "verified");
    const pendingBankList = ov.banks.filter((b) => b.verified_status === "pending");
    const pendingUserList = ov.users.filter((u) => u.account_status === "pending");
    const openReqs = ov.requests.filter(isOpenReq);
    const critOpen = openReqs.filter((r) => String(r.urgency_level).toLowerCase() === "critical");

    // fulfilled requests (cancelled ones are not counted against the rate)
    const fulfilled = ov.requests.filter((r) => r.status === "fulfilled");
    const countable = ov.requests.filter((r) => r.status !== "cancelled").length;
    const rate = countable ? Math.round((fulfilled.length / countable) * 100) : 0;
    const matchedReqs = ov.requests.filter((r) => r.status === "matched").length;
    const pendingReqs = ov.requests.filter((r) => r.status === "pending").length;
    const fulfilledUnits = fulfilled.reduce((s, r) => s + (Number(r.quantity_needed) || 0), 0);

    // donations: find each donor's blood type even if the donation row doesn't have it
    const donorById = Object.fromEntries(ov.donors.map((d) => [d.donor_id, d]));
    const donorByName = Object.fromEntries(ov.donors.map((d) => [String(d.full_name || "").toLowerCase(), d]));
    const bloodOf = (dn) =>
      dn.blood_type ||
      donorById[dn.donor_id]?.blood_type ||
      donorByName[String(dn.donor_name || "").toLowerCase()]?.blood_type ||
      "";
    const unitsOf = (dn) => Number(dn.units ?? (dn.volume_ml ? dn.volume_ml / UNIT_ML : 0)) || 0;
    const done = ov.donations.filter((d) => d.status === "completed");
    const unitsDonated = done.reduce((s, d) => s + unitsOf(d), 0);

    // top donors (completed donations only)
    const byDonor = {};
    done.forEach((d) => {
      const key = d.donor_id ?? d.donor_name;
      if (key === undefined || key === null) return;
      if (!byDonor[key]) {
        byDonor[key] = {
          key,
          name: d.donor_name || donorById[d.donor_id]?.full_name || "Unknown",
          blood: bloodOf(d),
          count: 0,
          units: 0,
          last: "",
        };
      }
      const e = byDonor[key];
      e.count += 1;
      e.units += unitsOf(d);
      if (String(d.donation_date || "") > e.last) e.last = String(d.donation_date || "");
    });
    const topDonors = Object.values(byDonor)
      .sort((a, b) => b.count - a.count || b.units - a.units)
      .slice(0, 5);

    // blood type: donated vs requested (in units)
    const donated = Object.fromEntries(GROUPS.map((g) => [g, 0]));
    done.forEach((d) => {
      const g = bloodOf(d);
      if (g in donated) donated[g] += unitsOf(d);
    });
    const requested = Object.fromEntries(GROUPS.map((g) => [g, 0]));
    ov.requests
      .filter((r) => r.status !== "cancelled")
      .forEach((r) => {
        if (r.blood_type in requested) requested[r.blood_type] += Number(r.quantity_needed) || 0;
      });
    const typeRows = GROUPS.map((g) => ({ g, donated: donated[g], requested: requested[g] }));
    const maxDonated = Math.max(0, ...typeRows.map((r) => r.donated));
    const maxRequested = Math.max(0, ...typeRows.map((r) => r.requested));
    const topDonatedType = maxDonated > 0 ? typeRows.find((r) => r.donated === maxDonated).g : null;
    const topRequestedType = maxRequested > 0 ? typeRows.find((r) => r.requested === maxRequested).g : null;

    // things the admin has to act on
    const attention = [];
    if (pendingBankList.length) {
      attention.push({ n: pendingBankList.length, cls: "warn", t: "Blood banks waiting for verification", s: "Check their license, then verify or reject.", tab: "bloodbanks" });
    }
    if (pendingUserList.length) {
      attention.push({ n: pendingUserList.length, cls: "warn", t: "Accounts waiting for approval", s: "New registrations that cannot log in yet.", tab: "users", setFilter: "pending" });
    }
    if (critOpen.length) {
      attention.push({ n: critOpen.length, cls: "crit", t: "Critical blood requests still open", s: critOpen.slice(0, 3).map((r) => `#${r.request_id} ${gtxt(r.blood_type)}`).join(", "), tab: "requests", setReqFilter: "open" });
    }

    // monthly trend for the reports tab
    const months = {};
    const bump = (key, field, amount = 1) => {
      if (!key) return;
      if (!months[key]) months[key] = { requests: 0, fulfilled: 0, donations: 0, units: 0 };
      months[key][field] += amount;
    };
    ov.requests.forEach((r) => {
      const k = monthKey(r.date_requested);
      bump(k, "requests");
      if (r.status === "fulfilled") bump(k, "fulfilled");
    });
    done.forEach((d) => {
      const k = monthKey(d.donation_date);
      bump(k, "donations");
      bump(k, "units", unitsOf(d));
    });
    const monthRows = Object.entries(months)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 12);

    // last 6 months for the line chart: units collected (completed donations) vs issued (fulfilled requests)
    // "issued" is grouped by the month the request was made (there is no fulfilled-date field)
    const trend = [];
    const nowD = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(nowD.getFullYear(), nowD.getMonth() - i, 1);
      trend.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-GB", { month: "short" }) + (i === 0 ? "*" : ""),
        collected: 0,
        issued: 0,
      });
    }
    const trendByKey = Object.fromEntries(trend.map((t) => [t.key, t]));
    done.forEach((d) => {
      const t = trendByKey[monthKey(d.donation_date)];
      if (t) t.collected += unitsOf(d);
    });
    fulfilled.forEach((r) => {
      const t = trendByKey[monthKey(r.date_requested)];
      if (t) t.issued += Number(r.quantity_needed) || 0;
    });

    o = {
      members, verifiedBanks, openReqs, critOpen, fulfilled, countable, rate, fulfilledUnits, matchedReqs, pendingReqs,
      done, unitsDonated, topDonors, typeRows, maxDonated, maxRequested, topDonatedType, topRequestedType,
      attention, monthRows, trend, bloodOf, unitsOf,
      availableDonors: ov.donors.filter((d) => d.availability_status === "available" && d.eligibility_status === "eligible").length,
    };
  }

  const reqTabs = ov
    ? [
        { id: "open", label: "Open", list: ov.requests.filter(isOpenReq) },
        { id: "fulfilled", label: "Fulfilled", list: ov.requests.filter((r) => r.status === "fulfilled") },
        { id: "cancelled", label: "Cancelled", list: ov.requests.filter((r) => r.status === "cancelled") },
        { id: "all", label: "All", list: ov.requests },
      ]
    : [];
  const shownReqs = (reqTabs.find((t) => t.id === reqFilter) || reqTabs[0] || { list: [] }).list;


  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // CSV downloads available in the Reports tab
  const downloads = o
    ? [
        {
          id: "requests", label: "Blood requests", count: ov.requests.length,
          run: () => downloadCsv("requests",
            [["request_id", "Ref"], ["requester_name", "Requester"], ["blood_type", "Blood type"], ["quantity_needed", "Units"], ["urgency_level", "Urgency"], ["status", "Status"], ["location_needed", "Location"], ["date_requested", "Requested"]],
            ov.requests),
        },
        {
          id: "donations", label: "Donations", count: ov.donations.length,
          run: () => downloadCsv("donations",
            [["donation_id", "Ref"], ["donor_name", "Donor"], ["blood_type", "Blood type"], ["blood_bank", "Blood bank"], ["units", "Units"], ["status", "Status"], ["donation_date", "Date"]],
            ov.donations.map((d) => ({ ...d, blood_type: o.bloodOf(d), blood_bank: d.blood_bank ?? d.bank_name ?? "", units: o.unitsOf(d) }))),
        },
        {
          id: "donors", label: "Donors", count: ov.donors.length,
          run: () => downloadCsv("donors",
            [["full_name", "Name"], ["blood_type", "Blood type"], ["contact_number", "Contact"], ["email", "Email"], ["availability_status", "Availability"], ["eligibility_status", "Eligibility"], ["last_donation_date", "Last donation"]],
            ov.donors),
        },
        {
          id: "banks", label: "Blood banks", count: ov.banks.length,
          run: () => downloadCsv("blood-banks",
            [["bank_name", "Blood bank"], ["email", "Email"], ["license_number", "License #"], ["verified_status", "Verification"]],
            ov.banks),
        },
        {
          id: "users", label: "User accounts", count: ov.users.length,
          run: () => downloadCsv("users",
            [["full_name", "Name"], ["email", "Email"], ["contact_number", "Contact"], ["role", "Role"], ["account_status", "Status"]],
            ov.users),
        },
        { id: "audit", label: "Inventory audit (latest 1000)", count: null, run: downloadAudit },
      ]
    : [];

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
            <div className="brand-fac">Admin portal</div>
          </div>

          <nav className="nav" aria-label="Admin portal sections">
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
              Admin / <b>{title}</b>
            </div>

            <div className="top-r">
              <NotificationBell userId={user?.user_id} />
              <span className="vr" />
              <button type="button" className="top-btn" onClick={() => goTo("profile")} title="Edit profile" aria-label="Edit profile" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="avatar">{initials(displayName)}</span>
                <span className="who">
                  <b>{displayName}</b>
                  <span>Administrator</span>
                </span>
              </button>
              <button type="button" className="top-btn" onClick={onLogout}>Log out</button>
            </div>
          </header>

          <div id="content" ref={contentRef}>
            <div className="tab" key={current.id}>
              <div className="page-h">
                <div>
                  <h1>{title}</h1>
                  <p>
                    {SUBTITLES[current.id]}
                    {current.id === "overview" && ` ${today}`}
                  </p>
                </div>
                {current.id === "users" && (
                  <div className="actions">
                    <button type="button" className="btn pri" onClick={() => setUserForm({ mode: "add", initial: {} })}>
                      + Add user
                    </button>
                  </div>
                )}
                {(current.id === "overview" || current.id === "reports") && (
                  <div className="actions">
                    {ovUpdated && (
                      <span className="muted">
                        Updated {ovUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                    <button type="button" className="btn" onClick={loadOverview} disabled={ovLoading}>
                      {ovLoading ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                )}
              </div>

              {message && <div className="msg ok">{message}</div>}
              {error && <div className="msg err">{error}</div>}

              {(current.id === "overview" || current.id === "reports") && ovLoading && !o && (
                <div className="panel"><div className="empty"><Loading label="Loading..." /></div></div>
              )}
              {(current.id === "overview" || current.id === "reports") && o && ov.failed.length > 0 && (
                <div className="msg err">
                  Some data could not be loaded: {ov.failed.join(", ")}. The numbers that depend on it may be incomplete.
                </div>
              )}

              {/* ============ PREDICTIVE ANALYTICS ============ */}
              {current.id === "analytics" && <DemandForecast />}

              {/* ============ OVERVIEW ============ */}
              {current.id === "overview" && o && (
                <>
                  <div className="grid-2">
                    <div className="supply">
                      <div>
                        <div className="lbl">Requests fulfilled</div>
                        <div className="big-row">
                          <span className="big">{o.fulfilled.length}</span>
                          <span className="unit">of {o.countable} requests · {o.rate}%</span>
                        </div>
                      </div>
                      <div>
                        <div className="mix" role="img" aria-label={`${o.fulfilled.length} fulfilled, ${o.matchedReqs} matched, ${o.pendingReqs} pending`}>
                          {o.fulfilled.length > 0 && (
                            <span className="seg-ok" style={{ flex: `${o.fulfilled.length} 1 0` }} title={`Fulfilled: ${o.fulfilled.length}`}>{o.fulfilled.length}</span>
                          )}
                          {o.matchedReqs > 0 && (
                            <span className="seg-matched" style={{ flex: `${o.matchedReqs} 1 0` }} title={`Matched (not yet fulfilled): ${o.matchedReqs}`}>{o.matchedReqs}</span>
                          )}
                          {o.pendingReqs > 0 && (
                            <span className="seg-pending" style={{ flex: `${o.pendingReqs} 1 0` }} title={`Pending (not yet fulfilled): ${o.pendingReqs}`}>{o.pendingReqs}</span>
                          )}
                          {o.countable === 0 && <span className="seg-pending" style={{ flex: "1 1 0" }} />}
                        </div>
                        <div className="mix-key">
                          <span><i className="sw seg-ok" />Fulfilled ({o.fulfilled.length})</span>
                          <span><i className="sw seg-matched" />Matched ({o.matchedReqs})</span>
                          <span><i className="sw seg-pending" />Pending ({o.pendingReqs})</span>
                        </div>
                        <div className="mix-l">
                          {formatUnits(o.fulfilledUnits)} units delivered · cancelled requests are not counted
                        </div>
                      </div>
                      <div className="stats">
                        <div className="stat"><div className="k">Members</div><div className="v">{o.members}</div></div>
                        <div className="stat"><div className="k">Blood banks</div><div className="v">{o.verifiedBanks.length}</div></div>
                        <div className="stat"><div className="k">Donors ready</div><div className="v">{o.availableDonors}</div></div>
                        <div className="stat"><div className="k">Open requests</div><div className="v">{o.openReqs.length}</div></div>
                      </div>
                    </div>

                    <div className="panel">
                      <div className="panel-h"><h3>Needs attention</h3></div>
                      <ul className="attn">
                        {o.attention.length === 0 && <li className="ok-row">Nothing needs attention right now.</li>}
                        {o.attention.map((a, i) => (
                          <li key={i}>
                            <button
                              type="button"
                              onClick={() => {
                                if (a.setFilter) setFilter(a.setFilter);
                                if (a.setReqFilter) setReqFilter(a.setReqFilter);
                                goTo(a.tab);
                              }}
                            >
                              <span className="t"><b>{a.t}</b><span>{a.s}</span></span>
                              <span className={`n ${a.cls}`}>{a.n}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* CHARTS: monthly trend + donated vs requested by blood group */}
                  <div className="grid-auto">
                    <div className="panel">
                      <div className="panel-h">
                        <h3>Collections and issues<span className="sub">Units per month</span></h3>
                      </div>
                      <TrendChart rows={o.trend} />
                    </div>
                    <div className="panel">
                      <div className="panel-h">
                        <h3>Blood groups<span className="sub">Donated and requested, all time</span></h3>
                      </div>
                      <BloodTypeBars rows={o.typeRows} />
                    </div>
                  </div>

                  {/* MAP */}
                  <div className="panel">
                    <div className="panel-h">
                      <h3>Map<span className="sub">Verified blood banks and open blood requests</span></h3>
                    </div>
                    <div className="panel-b map-b">
                      <AdminMap banks={o.verifiedBanks} requests={o.openReqs} />
                    </div>
                  </div>

                  <div className="grid-auto wide">
                    {/* TOP DONORS */}
                    <div className="panel">
                      <div className="panel-h">
                        <h3>Top donors<span className="sub">Most completed donations</span></h3>
                      </div>
                      <div className="tw">
                        <table>
                          <thead><tr><th>#</th><th>Donor</th><th>Group</th><th className="r">Donations</th><th className="r">Units</th></tr></thead>
                          <tbody>
                            {o.topDonors.length === 0 && <tr><td colSpan="5" className="empty">No completed donations yet.</td></tr>}
                            {o.topDonors.map((d, i) => (
                              <tr key={d.key}>
                                <td className="num">{i + 1}</td>
                                <td className="wrap"><b>{d.name}</b>{i === 0 && <span className="muted"> · top donor</span>}</td>
                                <td>{d.blood ? <b className="grp">{gtxt(d.blood)}</b> : "—"}</td>
                                <td className="r num"><b>{d.count}</b></td>
                                <td className="r num">{formatUnits(d.units)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* URGENT OPEN REQUESTS */}
                    <div className="panel">
                      <div className="panel-h">
                        <h3>Urgent open requests</h3>
                        <button type="button" className="link" onClick={() => { setReqFilter("open"); goTo("requests"); }}>View all</button>
                      </div>
                      <div className="tw">
                        <table>
                          <thead><tr><th>Requester</th><th>Group</th><th className="r">Units</th><th>Urgency</th></tr></thead>
                          <tbody>
                            {o.openReqs.length === 0 && <tr><td colSpan="4" className="empty">No open requests.</td></tr>}
                            {[...o.openReqs]
                              .sort((a, b) => {
                                const rank = { critical: 0, high: 1, medium: 2, low: 3 };
                                return (rank[String(a.urgency_level).toLowerCase()] ?? 4) - (rank[String(b.urgency_level).toLowerCase()] ?? 4);
                              })
                              .slice(0, 5)
                              .map((q) => (
                                <tr key={q.request_id}>
                                  <td className="wrap">{q.requester_name}</td>
                                  <td><b className="grp">{gtxt(q.blood_type)}</b></td>
                                  <td className="r num">{formatUnits(q.quantity_needed)}</td>
                                  <td><Status value={q.urgency_level} tones={URGENCY_TONE} /></td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* RECENT INVENTORY ACTIVITY */}
                    <div className="panel">
                      <div className="panel-h">
                        <h3>Recent inventory activity</h3>
                        <button type="button" className="link" onClick={() => goTo("audit")}>View all</button>
                      </div>
                      <div className="tw">
                        <table>
                          <thead><tr><th>Blood bank</th><th>Group</th><th>Change</th><th>When</th></tr></thead>
                          <tbody>
                            {ov.audit.length === 0 && <tr><td colSpan="4" className="empty">No recent changes.</td></tr>}
                            {ov.audit.slice(0, 5).map((a) => (
                              <tr key={a.audit_id}>
                                <td className="wrap">{a.bank_name}</td>
                                <td><b className="grp">{gtxt(a.blood_type)}</b></td>
                                <td>
                                  <span className={`st ${a.change_units > 0 ? "ok" : "crit"} num`}>{formatChange(a.change_units)}</span>
                                </td>
                                <td className="num">{a.changed_at}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ============ REPORTS ============ */}
              {current.id === "reports" && o && (
                <>
                  <div className="panel">
                    <div className="panel-h"><h3>Summary<span className="sub">All time</span></h3></div>
                    <div className="panel-b">
                      <dl className="facts">
                        <div><dt>Total requests</dt><dd>{ov.requests.length}</dd></div>
                        <div><dt>Requests fulfilled</dt><dd>{o.fulfilled.length} ({o.rate}%)</dd></div>
                        <div><dt>Open requests</dt><dd>{o.openReqs.length}</dd></div>
                        <div><dt>Units delivered</dt><dd>{formatUnits(o.fulfilledUnits)}</dd></div>
                        <div><dt>Donations completed</dt><dd>{o.done.length}</dd></div>
                        <div><dt>Units donated</dt><dd>{formatUnits(o.unitsDonated)}</dd></div>
                        <div><dt>Most donated group</dt><dd>{o.topDonatedType ? gtxt(o.topDonatedType) : "—"}</dd></div>
                        <div><dt>Most requested group</dt><dd>{o.topRequestedType ? gtxt(o.topRequestedType) : "—"}</dd></div>
                        <div><dt>Top donor</dt><dd>{o.topDonors[0] ? `${o.topDonors[0].name} (${o.topDonors[0].count})` : "—"}</dd></div>
                        <div><dt>Verified blood banks</dt><dd>{o.verifiedBanks.length}</dd></div>
                        <div><dt>Donor profiles</dt><dd>{ov.donors.length}</dd></div>
                        <div><dt>Registered members</dt><dd>{o.members}</dd></div>
                      </dl>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-h"><h3>Monthly trend<span className="sub">Latest 12 months with activity</span></h3></div>
                    <div className="tw">
                      <table>
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th className="r">Requests</th>
                            <th className="r">Fulfilled</th>
                            <th className="r">Donations</th>
                            <th className="r">Units donated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.monthRows.length === 0 && <tr><td colSpan="5" className="empty">No dated activity yet.</td></tr>}
                          {o.monthRows.map(([key, m]) => (
                            <tr key={key}>
                              <td>{monthLabel(key)}</td>
                              <td className="r num">{m.requests}</td>
                              <td className="r num">{m.fulfilled}</td>
                              <td className="r num">{m.donations}</td>
                              <td className="r num">{formatUnits(m.units)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-h"><h3>Download reports<span className="sub">CSV files that open in Excel</span></h3></div>
                    <div className="tw">
                      <table>
                        <thead><tr><th>Report</th><th className="r">Rows</th><th className="r">Download</th></tr></thead>
                        <tbody>
                          {downloads.map((d) => (
                            <tr key={d.id}>
                              <td>{d.label}</td>
                              <td className="r num">{d.count ?? "—"}</td>
                              <td className="r">
                                <button type="button" className="btn sm" onClick={d.run}>Download CSV</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {/* USER ACCOUNT MANAGEMENT */}
              {current.id === "users" && (
                <div className="panel">
                  <div className="toolbar">
                    <label htmlFor="user-filter" className="muted">Filter by status</label>
                    <select id="user-filter" className="in sel" value={filter} onChange={(e) => setFilter(e.target.value)}>
                      <option value="">All</option>
                      <option value="pending">Pending</option>
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                    </select>
                    <form onSubmit={runUserSearch} style={{ display: "inline-flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
                      <input
                        type="search"
                        className="in"
                        placeholder="Search name, email, contact or role"
                        aria-label="Search users"
                        value={searchInput}
                        onChange={(e) => onUserSearchChange(e.target.value)}
                        style={{ minWidth: 240 }}
                      />
                      <button type="submit" className="btn pri sm">Search</button>
                      {(search || searchInput) && (
                        <button type="button" className="btn sm" onClick={clearUserSearch}>Clear</button>
                      )}
                    </form>
                  </div>

                  {loading ? (
                    <div className="empty"><Loading label="Loading users..." /></div>
                  ) : visibleUsers.length === 0 ? (
                    <div className="empty">
                      {search.trim() ? `No users match "${search.trim()}".` : "No users found for this filter."}
                    </div>
                  ) : (
                    <div className="tw">
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Contact</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th className="r">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleUsers.map((u) => (
                            <tr key={u.user_id}>
                              <td>{u.full_name}</td>
                              <td>{u.email}</td>
                              <td>{u.contact_number}</td>
                              <td>{pretty(u.role)}</td>
                              <td><Status value={u.account_status} tones={USER_TONE} /></td>
                              <td className="r">
                                <span style={{ display: "inline-flex", gap: 6 }}>
                                  <button type="button" className="btn sm" onClick={() => openEditUser(u)}>
                                    Edit
                                  </button>
                                  {u.account_status !== "active" && (
                                    <button type="button" className="btn pri sm" onClick={() => updateStatus(u.user_id, "active")}>
                                      Activate
                                    </button>
                                  )}
                                  {u.account_status !== "disabled" && (
                                    <button
                                      type="button"
                                      className="btn danger sm"
                                      onClick={() =>
                                        setConfirm({
                                          title: "Disable this account?",
                                          message: `${u.full_name} (${u.email}) won't be able to log in until you activate the account again.`,
                                          confirmLabel: "Yes, disable",
                                          onConfirm: () => updateStatus(u.user_id, "disabled"),
                                        })
                                      }
                                    >
                                      Disable
                                    </button>
                                  )}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* BLOOD BANK VERIFICATION */}
              {current.id === "bloodbanks" && (
                <div className="panel">
                  {bbLoading ? (
                    <div className="empty"><Loading label="Loading blood banks..." /></div>
                  ) : bloodbanks.length === 0 ? (
                    <div className="empty">No blood banks registered yet.</div>
                  ) : (
                    <div className="tw">
                      <table>
                        <thead>
                          <tr>
                            <th>Bank name</th>
                            <th>Email</th>
                            <th>License #</th>
                            <th>Status</th>
                            <th className="r">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bloodbanks.map((bb) => (
                            <tr key={bb.blood_bank_id}>
                              <td>{bb.bank_name}</td>
                              <td>{bb.email}</td>
                              <td className="mono">{bb.license_number || "—"}</td>
                              <td><Status value={bb.verified_status} tones={VERIFY_TONE} /></td>
                              <td className="r">
                                <span style={{ display: "inline-flex", gap: 6 }}>
                                  {bb.verified_status !== "verified" && (
                                    <button
                                      type="button"
                                      className="btn pri sm"
                                      onClick={() => updateBloodbankVerification(bb.blood_bank_id, "verified")}
                                    >
                                      Verify
                                    </button>
                                  )}
                                  {bb.verified_status !== "rejected" && (
                                    <button
                                      type="button"
                                      className="btn danger sm"
                                      onClick={() =>
                                        setConfirm({
                                          title: "Reject this blood bank?",
                                          message: `${bb.bank_name} will be rejected and its login account disabled. The bank will be notified.`,
                                          confirmLabel: "Yes, reject",
                                          onConfirm: () => updateBloodbankVerification(bb.blood_bank_id, "rejected"),
                                        })
                                      }
                                    >
                                      Reject
                                    </button>
                                  )}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* BLOOD REQUESTS (read-only) */}
              {current.id === "requests" && (
                <div className="panel">
                  {ovLoading && !ov ? (
                    <div className="empty"><Loading label="Loading requests..." /></div>
                  ) : (
                    <>
                      <CriticalReview requests={ov.requests} onReviewed={loadOverview} />
                      <div className="tabs">
                        {reqTabs.map((t) => (
                          <button key={t.id} type="button" className={reqFilter === t.id ? "on" : ""} onClick={() => setReqFilter(t.id)}>
                            {t.label}<span className="c">{t.list.length}</span>
                          </button>
                        ))}
                      </div>
                      <div className="tw">
                        <table>
                          <thead>
                            <tr>
                              <th>Ref</th>
                              <th>Requester</th>
                              <th>Group</th>
                              <th className="r">Units</th>
                              <th>Urgency</th>
                              <th>Location</th>
                              <th>Requested</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {shownReqs.length === 0 && <tr><td colSpan="8" className="empty">Nothing here.</td></tr>}
                            {shownReqs.map((q) => (
                              <tr key={q.request_id}>
                                <td className="mono">#{q.request_id}</td>
                                <td className="wrap">{q.requester_name}</td>
                                <td><b className="grp">{gtxt(q.blood_type)}</b></td>
                                <td className="r num">{formatUnits(q.quantity_needed)}</td>
                                <td><Status value={q.urgency_level} tones={URGENCY_TONE} /></td>
                                <td className="wrap">{q.location_needed || "—"}</td>
                                <td>{q.date_requested}</td>
                                <td><Status value={q.status} tones={REQUEST_TONE} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* INVENTORY AUDIT LOG */}
              {current.id === "audit" && (
                <div className="panel">
                  <div className="toolbar">
                    <label htmlFor="audit-bank" className="muted">Filter by blood bank</label>
                    <select id="audit-bank" className="in sel" style={{ width: 220 }} value={auditBank} onChange={(e) => setAuditBank(e.target.value)}>
                      <option value="">All blood banks</option>
                      {bloodbanks.map((bb) => (
                        <option key={bb.blood_bank_id} value={bb.blood_bank_id}>{bb.bank_name}</option>
                      ))}
                    </select>
                  </div>

                  {auditLoading ? (
                    <div className="empty"><Loading label="Loading audit log..." /></div>
                  ) : auditLog.length === 0 ? (
                    <div className="empty">No inventory changes recorded yet.</div>
                  ) : (
                    <div className="tw">
                      <table>
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Blood bank</th>
                            <th>Blood type</th>
                            <th className="r">Old (units)</th>
                            <th className="r">New (units)</th>
                            <th>Change</th>
                            <th>Changed by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditLog.map((a) => (
                            <tr key={a.audit_id}>
                              <td className="num">{a.changed_at}</td>
                              <td>{a.bank_name}</td>
                              <td><span className="grp">{gtxt(a.blood_type)}</span></td>
                              <td className="r num">{formatUnits(a.old_units)}</td>
                              <td className="r num">{formatUnits(a.new_units)}</td>
                              <td>
                                <span className={`st ${a.change_units > 0 ? "ok" : "crit"} num`}>
                                  {formatChange(a.change_units)}
                                </span>
                              </td>
                              <td>
                                {a.changed_by_name}
                                {a.changed_by_role === "admin" && <span className="muted"> (admin)</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* AUDIT LOGS */}
              {current.id === "auditlogs" && <AuditLogs />}

              {/* LOGIN HISTORY */}
              {current.id === "loginhistory" && <LoginHistory />}

              {/* EDIT PROFILE */}
              {current.id === "profile" && (
                <div className="bbv9-embed">
                  <ProfileSection userId={user?.user_id} />
                </div>
              )}

              {/* NOTIFICATIONS */}
              {current.id === "notifications" && (
                <div className="bbv9-embed">
                  <NotificationsSection userId={user?.user_id} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        cancelLabel="No, go back"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const run = confirm.onConfirm;
          setConfirm(null);
          run();
        }}
      />

      {userForm && (
        <UserFormModal
          key={userForm.initial?.user_id ?? "new"}
          mode={userForm.mode}
          initial={userForm.initial}
          onClose={() => setUserForm(null)}
          onSaved={onUserSaved}
        />
      )}
    </div>
  );
}

export default AdminDashboard;