import { useState, useEffect } from "react";
import api from "../api";
import NotificationBell, { NotificationsSection } from "./NotificationBell";
import ProfileSection from "./ProfileSection";
import Overview, { prettify } from "./Overview";
import { UNIT_HINT, UNIT_ERROR, UNIT_ML, formatUnits, formatChange, unitLabel, isValidUnits } from "./units";
import "./dashboard.css";
import Loading from "./Loading";

function BloodBankDashboard({ user, onLogout }) {
  const [active, setActive] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false); // mobile sidebar drawer

  const [profile, setProfile] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [donationHistory, setDonationHistory] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  // only verified banks may edit stock (the server enforces this too)
  const isVerified = profile?.verified_status === "verified";
  const [auditLoading, setAuditLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // log donation form
  const [donorSearch, setDonorSearch] = useState("");
  const [donorResults, setDonorResults] = useState([]);
  const [selectedDonor, setSelectedDonor] = useState(null);
  const [units, setUnits] = useState("1");
  const [donationStatus, setDonationStatus] = useState("completed");
  const [remarks, setRemarks] = useState("");
  const [logging, setLogging] = useState(false);

  // every screen starts at the top
  useEffect(() => {
    window.scrollTo({ top: 0 });
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

  const loadAll = async (bankId) => {
    try {
      const invRes = await api.get(`/bloodbanks/${bankId}/inventory`);
      setInventory(invRes.data);

      const donRes = await api.get(`/donations?blood_bank_id=${bankId}`);
      setDonationHistory(donRes.data);
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

  // silent = refresh in the background without replacing the page with "Loading..."
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

  // refresh the history each time its screen is opened
  useEffect(() => {
    if (active === "audit" && profile) loadAudit(profile.blood_bank_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, profile]);

  const handleInventoryChange = async (blood_type_id, newValue) => {
    if (!isVerified) return;
    if (!isValidUnits(newValue, { allowZero: true })) {
      setError(UNIT_ERROR);
      return;
    }
    setError("");

    try {
      const res = await api.put(`/bloodbanks/${profile.blood_bank_id}/inventory`, {
        blood_type_id,
        units_available: newValue,
        changed_by: user.user_id, // recorded in the audit log
      });
      // clicking in and out of a box without editing it changes nothing
      if (res.data.changed) {
        setMessage("Inventory updated.");
        loadAll(profile.blood_bank_id);
      }
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update inventory.");
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

    if (!selectedDonor) {
      setError("Please select a donor from the search results.");
      return;
    }

    if (!isValidUnits(units)) {
      setError(UNIT_ERROR);
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
      const msg = err.response?.data?.message || "Failed to log donation.";
      setError(msg);
    } finally {
      setLogging(false);
    }
  };

  if (loading) {
    return <div className="db-loading"><p className="db-muted"><Loading label="Loading..." /></p></div>;
  }

  // sidebar items (titles only)
  const sections = [
    { id: "overview", label: "Overview" },
    { id: "profile", label: "Edit Profile" },
    { id: "inventory", label: "Blood Stock Inventory" },
    { id: "audit", label: "Inventory History" },
    { id: "log", label: "Log a Donation" },
    { id: "history", label: "Donation History" },
    { id: "notifications", label: "Notifications" },
  ];
  const current = sections.find((s) => s.id === active) || sections[0];

  // ----- overview data -----
  const LOW_STOCK = 5; // a blood type at or below this many units counts as low
  const totalUnits = inventory.reduce((sum, i) => sum + (Number(i.units_available) || 0), 0);
  const lowTypes = inventory.filter((i) => (Number(i.units_available) || 0) <= LOW_STOCK);
  const completedCount = donationHistory.filter((d) => d.status === "completed").length;

  const overviewAttention = [];
  if (profile && profile.verified_status !== "verified") {
    overviewAttention.push({
      tone: "warn",
      text: `Your blood bank isn't verified yet (status: ${profile.verified_status}). Inventory is read-only until an admin verifies it.`,
    });
  }
  if (lowTypes.length > 0) {
    overviewAttention.push({
      tone: "warn",
      text: `Low stock: ${lowTypes.map((i) => i.blood_type).join(", ")}.`,
      actionLabel: "Update inventory",
      onAction: () => setActive("inventory"),
    });
  }

  const overviewStats = [
    { label: "Total units", value: formatUnits(totalUnits), hint: "Across all blood types (1 unit = 1 bag)", tone: "accent", onClick: () => setActive("inventory") },
    {
      label: "Low stock",
      value: lowTypes.length,
      hint: lowTypes.length > 0 ? lowTypes.map((i) => i.blood_type).join(", ") : `Nothing at or below ${unitLabel(LOW_STOCK)}`,
      tone: lowTypes.length > 0 ? "warn" : "good",
      onClick: () => setActive("inventory"),
    },
    { label: "Donations logged", value: donationHistory.length, onClick: () => setActive("history") },
    { label: "Completed", value: completedCount, tone: "good", onClick: () => setActive("history") },
  ];

  return (
    <div className="db-page db-portal-bloodbank">

      {/* SIDEBAR: brand + section titles only */}
      {menuOpen && <div className="db-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={`db-sidebar ${menuOpen ? "db-sidebar-open" : ""}`}>
        <div className="db-brand">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 1.5s7 7.6 7 12.6A7 7 0 0112 21a7 7 0 01-7-6.9c0-5 7-12.6 7-12.6z" />
          </svg>
          BloodLink
          <button type="button" className="db-sidebar-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <nav className="db-nav" aria-label="Blood bank portal sections">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className="db-nav-item"
              aria-current={s.id === current.id ? "page" : undefined}
              onClick={() => {
                setActive(s.id);
                setMenuOpen(false);
              }}
            >
              <span>{s.label}</span>
              {s.badge > 0 && <span className="db-nav-badge">{s.badge > 9 ? "9+" : s.badge}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {/* MAIN: the selected screen */}
      <main className="db-main">
        <div className="db-header">
          <button type="button" className="db-menu-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <div className="db-title-wrap">
            <div className="db-eyebrow">
              <span className="db-eyebrow-dash" />
              Blood bank portal
            </div>
            <h1 className="db-title">{current.title || current.label}</h1>
            <p className="db-subtitle">
              <strong>{profile?.bank_name}</strong> — {profile?.email}
              {profile?.verified_status !== "verified" && (
                <span className="db-warn">(Verification: {profile?.verified_status})</span>
              )}
            </p>
          </div>
          <div className="db-header-actions">
            <NotificationBell userId={user.user_id} />
            <button onClick={onLogout} className="db-logout-btn">Logout</button>
          </div>
        </div>

        {message && <div className="db-alert db-alert-success">{message}</div>}
        {error && <div className="db-alert db-alert-error">{error}</div>}

        <div className="db-content" key={current.id}>

          {/* OVERVIEW */}
          {active === "overview" && (
            <Overview
              greeting={`Welcome, ${profile?.bank_name || "Blood Bank"}`}
              subtitle="Your blood stock and donations at a glance."
              attention={overviewAttention}
              stats={overviewStats}
              actions={[
                { label: "Log a donation", onClick: () => setActive("log"), primary: true },
                { label: "Update inventory", onClick: () => setActive("inventory") },
              ]}
            />
          )}

          {/* INVENTORY */}
          {active === "inventory" && (
            <div className="db-card">
              {!isVerified && (
                <div className="db-alert db-alert-error">
                  Inventory is read-only until an admin verifies your blood bank (status: {profile?.verified_status}).
                </div>
              )}
              <table className="db-table">
                <thead>
                  <tr>
                    <th>Blood Type</th>
                    <th>Units Available</th>
                    <th>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => (
                    <tr key={item.blood_type_id}>
                      <td data-label="Blood Type">{item.blood_type}</td>
                      <td data-label="Units Available">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          disabled={!isVerified}
                          defaultValue={formatUnits(item.units_available)}
                          onBlur={(e) => handleInventoryChange(item.blood_type_id, e.target.value)}
                          style={{ width: "80px", padding: "6px 8px", border: "1.5px solid #f0e0e1", borderRadius: "6px" }}
                        />
                      </td>
                      <td data-label="Last Updated">{item.last_updated || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="db-subtext">{isVerified ? "Edit a number and click outside the box to save. " : ""}{UNIT_HINT}</p>
            </div>
          )}

          {/* INVENTORY HISTORY (audit log) */}
          {active === "audit" && (
            <div className="db-card">
              {auditLoading ? (
                <p className="db-muted"><Loading label="Loading history..." /></p>
              ) : auditLog.length === 0 ? (
                <p className="db-muted">No inventory changes recorded yet.</p>
              ) : (
                <table className="db-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Blood Type</th>
                      <th>Old (units)</th>
                      <th>New (units)</th>
                      <th>Change</th>
                      <th>Changed By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((a) => (
                      <tr key={a.audit_id}>
                        <td data-label="When">{a.changed_at}</td>
                        <td data-label="Blood Type">{a.blood_type}</td>
                        <td data-label="Old (units)">{formatUnits(a.old_units)}</td>
                        <td data-label="New (units)">{formatUnits(a.new_units)}</td>
                        <td data-label="Change">
                          <span className="db-badge" style={{ backgroundColor: a.change_units > 0 ? "#2e7d32" : "#c62828" }}>
                            {formatChange(a.change_units)}
                          </span>
                        </td>
                        <td data-label="Changed By">{a.changed_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* LOG A DONATION */}
          {active === "log" && (
            <div className="db-card">
              <form onSubmit={handleLogDonation} className="db-form">
                <div className="db-field" style={{ position: "relative" }}>
                  <label>Search Donor (name or email)</label>
                  <input
                    type="text"
                    value={donorSearch}
                    onChange={(e) => handleDonorSearch(e.target.value)}
                    placeholder="Start typing a name or email..."
                  />
                  {donorResults.length > 0 && (
                    <div className="db-search-dropdown">
                      {donorResults.map((d) => (
                        <div
                          key={d.donor_id}
                          onClick={() => {
                            setSelectedDonor(d);
                            setDonorSearch(`${d.full_name} (${d.blood_type})`);
                            setDonorResults([]);
                          }}
                          className="db-search-item"
                        >
                          {d.full_name} — {d.email} — {d.blood_type}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedDonor && (
                  <p className="db-inline-note">
                    Selected: {selectedDonor.full_name} ({selectedDonor.blood_type})
                  </p>
                )}

                <div className="db-form-row">
                  <div className="db-field">
                    <label>Units Donated</label>
                    <input type="number" min="0.5" step="0.5" value={units} onChange={(e) => setUnits(e.target.value)} />
                    <small className="db-subtext">{UNIT_HINT}</small>
                  </div>

                  <div className="db-field">
                    <label>Status</label>
                    <select value={donationStatus} onChange={(e) => setDonationStatus(e.target.value)}>
                      <option value="completed">Completed</option>
                      <option value="deferred">Deferred</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                <div className="db-field">
                  <label>Remarks (optional)</label>
                  <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                </div>

                <div className="db-form-actions">
                  <button type="submit" disabled={logging} className="db-btn">
                    {logging ? "Logging..." : "Log Donation"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* DONATION HISTORY */}
          {active === "history" && (
            <div className="db-card">
              {donationHistory.length === 0 ? (
                <p className="db-muted">No donations logged yet.</p>
              ) : (
                <table className="db-table">
                  <thead>
                    <tr>
                      <th>Donor</th>
                      <th>Units</th>
                      <th>Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donationHistory.map((d) => (
                      <tr key={d.donation_id}>
                        <td data-label="Donor">{d.donor_name}</td>
                        <td data-label="Units">{formatUnits(d.units ?? d.volume_ml / UNIT_ML)}</td>
                        <td data-label="Date">{d.donation_date}</td>
                        <td data-label="Status">{d.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* EDIT PROFILE */}
          {active === "profile" && (
            <ProfileSection userId={user.user_id} onSaved={() => loadProfile(true)} />
          )}

          {/* NOTIFICATIONS */}
          {active === "notifications" && <NotificationsSection userId={user.user_id} />}
        </div>

        <footer className="db-footer">Give blood. Give hope.</footer>
      </main>
    </div>
  );
}

export default BloodBankDashboard;