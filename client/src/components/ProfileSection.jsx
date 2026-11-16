import { useState, useEffect } from "react";
import api from "../api";
import ConfirmDialog from "./ConfirmDialog";
import SuccessPopup from "./SuccessPopup";
import LocationPicker from "./LocationPicker";
import FieldError from "./FieldError";
import {
  validate, hasErrors, required, optional, fullName, email as emailRule, password as passwordRule,
  contact as contactRule, address as addressRule, lettersOnly, bankName, license, focusFirstError,
} from "../validation";
import "./dashboard.css";

// "Edit Profile" screen shared by every portal (donor/requester member, blood bank, admin).
//   <ProfileSection userId={user.user_id} onSaved={() => reloadMyHeaderData()} />
//
// - Everyday details save immediately.
// - Email / password changes ask for the CURRENT password (re-verification).
// - Blood bank name / license number are sensitive: a verified bank goes back to
//   "pending" until an admin re-verifies it, so we ask "Are you sure?" first.

const VERIFY_COLOR = { verified: "#2f8a5b", pending: "#b87a0a", rejected: "#c0262d" };

const pretty = (s) => {
  const t = String(s ?? "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function ProfileSection({ userId, onSaved }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [sec, setSec] = useState({ email: "", current_password: "", new_password: "" });
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingSec, setSavingSec] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [popup, setPopup] = useState(null); // centered success pop-up: { title, message }
  const [errors, setErrors] = useState({});    // inline messages for the details form
  const [secErrors, setSecErrors] = useState({}); // inline messages for the sign-in form

  const load = async () => {
    try {
      const res = await api.get(`/profile/${userId}`);
      setData(res.data);
      setForm({
        full_name: res.data.full_name || "",
        contact_number: res.data.contact_number || "",
        address: res.data.address || "",
        barangay: res.data.barangay || "",
        city: res.data.city || "",
        requester_type: res.data.requester_type || "individual",
        affiliated_hospital: res.data.affiliated_hospital || "",
        bank_name: res.data.bank_name || "",
        license_number: res.data.license_number || "",
        operating_hours: res.data.operating_hours || "",
        latitude: res.data.latitude ?? "",
        longitude: res.data.longitude ?? "",
      });
      setSec((s) => ({ ...s, email: res.data.email || "" }));
    } catch (err) {
      setError("Failed to load your profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const change = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    // the red message goes away as soon as the person edits that field
    setErrors((p) => (p[e.target.name] ? { ...p, [e.target.name]: "" } : p));
  };

  const isBank = data?.role === "blood_bank";
  const isMember = data?.role === "member";

  // did the user touch a sensitive blood bank field?
  const norm = (v) => String(v ?? "").trim();
  const sensitiveChanged =
    isBank &&
    (norm(form.bank_name) !== norm(data.bank_name) ||
      norm(form.license_number) !== norm(data.license_number));
  const needsConfirm = sensitiveChanged && data?.verified_status === "verified";

  const save = async (payload, setBusy, popupInfo) => {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const res = await api.put(`/profile/${userId}`, { acting_user_id: userId, ...payload });
      setPopup(popupInfo || { title: "Profile updated!", message: res.data.message || "Your changes were saved." });
      await load();
      if (onSaved) onSaved(res.data);
      return true;
    } catch (err) {
      setError(err.response?.data?.message || "Failed to update profile.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const detailsPayload = () => {
    const p = {
      full_name: form.full_name,
      contact_number: form.contact_number,
      address: form.address,
      barangay: form.barangay,
      city: form.city,
    };
    if (isMember) {
      p.requester_type = form.requester_type;
      p.affiliated_hospital = form.affiliated_hospital;
    }
    if (isBank) {
      p.bank_name = form.bank_name;
      p.license_number = form.license_number;
      p.operating_hours = form.operating_hours;
      p.latitude = form.latitude === "" ? null : form.latitude;
      p.longitude = form.longitude === "" ? null : form.longitude;
    }
    return p;
  };

  const detailsRules = () => ({
    full_name: [required("Full name"), fullName("Full name")],
    contact_number: [required("Contact number"), contactRule],
    address: [optional(addressRule("Address"))],
    barangay: [optional(lettersOnly("Barangay"))],
    city: [optional(lettersOnly("City"))],
    ...(isMember ? { affiliated_hospital: [optional(lettersOnly("Affiliated hospital"))] } : {}),
    ...(isBank
      ? { bank_name: [required("Blood bank name"), bankName], license_number: [optional(license)] }
      : {}),
  });

  const handleDetailsSubmit = (e) => {
    e.preventDefault();
    const found = validate(form, detailsRules());
    setErrors(found);
    if (hasErrors(found)) {
      focusFirstError(e.currentTarget);
      return;
    }
    if (needsConfirm) {
      setConfirmOpen(true);
      return;
    }
    save(detailsPayload(), setSavingProfile);
  };

  const confirmSensitive = () => {
    setConfirmOpen(false);
    save(detailsPayload(), setSavingProfile);
  };

  const handleSecuritySubmit = async (e) => {
    e.preventDefault();
    const emailChanged = norm(sec.email).toLowerCase() !== norm(data.email).toLowerCase();
    const needsCurrent = emailChanged || !!sec.new_password;
    const found = validate(sec, {
      email: [required("Email"), emailRule],
      new_password: [optional(passwordRule)],
      current_password: [(v) => (needsCurrent && !String(v ?? "").trim() ? "Current password is required to confirm it's you." : "")],
    });
    // nothing was changed: say so right under the email field
    if (!found.email && !found.new_password && !emailChanged && !sec.new_password) {
      found.email = "Nothing to update. Change your email or enter a new password.";
    }
    setSecErrors(found);
    if (hasErrors(found)) {
      focusFirstError(e.currentTarget);
      return;
    }
    // say exactly what changed: email, password or both
    const changed = emailChanged && sec.new_password ? "Email and password" : sec.new_password ? "Password" : "Email";
    const ok = await save(
      {
        email: sec.email,
        current_password: sec.current_password,
        new_password: sec.new_password,
      },
      setSavingSec,
      { title: `${changed} updated!`, message: "Your sign-in details were saved." }
    );
    if (ok) setSec((s) => ({ ...s, current_password: "", new_password: "" }));
  };

  if (loading) return <div className="db-scope"><div className="db-card"><p className="db-muted db-empty">Loading your profile...</p></div></div>;
  if (!data) return <div className="db-scope"><div className="db-card"><p className="db-muted db-empty">{error}</p></div></div>;

  const emailChanged = norm(sec.email).toLowerCase() !== norm(data.email).toLowerCase();

  return (
    <div className="db-scope" style={{ display: "grid", gap: 16 }}>
      {message && <div className="db-alert db-alert-success">{message}</div>}
      {error && <div className="db-alert db-alert-error">{error}</div>}

      {/* ---------- DETAILS ---------- */}
      <div className="db-card">
        <h3>Your details</h3>
        <form onSubmit={handleDetailsSubmit} className="db-form" noValidate>
          <div className="db-field">
            <label>Full Name</label>
            <input name="full_name" value={form.full_name} onChange={change} aria-invalid={!!errors.full_name} aria-describedby="err-pf-name" />
            <FieldError id="err-pf-name" message={errors.full_name} />
          </div>

          <div className="db-form-row">
            <div className="db-field">
              <label>Contact Number</label>
              <input name="contact_number" value={form.contact_number} onChange={change} placeholder="09171234567" aria-invalid={!!errors.contact_number} aria-describedby="err-pf-contact" />
              <FieldError id="err-pf-contact" message={errors.contact_number} />
            </div>
            <div className="db-field">
              <label>Address</label>
              <input name="address" value={form.address} onChange={change} aria-invalid={!!errors.address} aria-describedby="err-pf-addr" />
              <FieldError id="err-pf-addr" message={errors.address} />
            </div>
          </div>

          <div className="db-form-row">
            <div className="db-field">
              <label>Barangay</label>
              <input name="barangay" value={form.barangay} onChange={change} aria-invalid={!!errors.barangay} aria-describedby="err-pf-brgy" />
              <FieldError id="err-pf-brgy" message={errors.barangay} />
            </div>
            <div className="db-field">
              <label>City</label>
              <input name="city" value={form.city} onChange={change} aria-invalid={!!errors.city} aria-describedby="err-pf-city" />
              <FieldError id="err-pf-city" message={errors.city} />
            </div>
          </div>

          {isMember && (
            <>
              <div className="db-form-row">
                <div className="db-field">
                  <label>Blood Type</label>
                  <input value={data.blood_type || "Not set"} disabled />
                  <small className="db-subtext">Fixed after sign-up because donor matching depends on it.</small>
                </div>
                <div className="db-field">
                  <label>When requesting, I am a</label>
                  <select name="requester_type" value={form.requester_type} onChange={change}>
                    <option value="individual">Individual / Patient</option>
                    <option value="hospital">Hospital</option>
                    <option value="family_member">Family Member</option>
                  </select>
                </div>
              </div>
              <div className="db-field">
                <label>Affiliated Hospital (optional)</label>
                <input name="affiliated_hospital" value={form.affiliated_hospital} onChange={change} aria-invalid={!!errors.affiliated_hospital} aria-describedby="err-pf-hosp" />
                <FieldError id="err-pf-hosp" message={errors.affiliated_hospital} />
              </div>
            </>
          )}

          {isBank && (
            <>
              <p className="db-inline-note">
                Verification:{" "}
                <span className="db-badge" style={{ "--c": VERIFY_COLOR[data.verified_status] || "#6f7b8c" }}>
                  {pretty(data.verified_status)}
                </span>
                {" "}—{" "}
                {data.verified_status === "rejected"
                  ? <>your bank was rejected. Correct the <strong>bank name</strong> or <strong>license number</strong> and save to send it back to an admin for review.</>
                  : <>changing the <strong>bank name</strong> or <strong>license number</strong> requires an admin to
                re-verify your bank, and inventory is read-only until then.</>}
              </p>
              <div className="db-field">
                <label>Blood Bank Name</label>
                <input name="bank_name" value={form.bank_name} onChange={change} aria-invalid={!!errors.bank_name} aria-describedby="err-pf-bank" />
                <FieldError id="err-pf-bank" message={errors.bank_name} />
              </div>
              <div className="db-form-row">
                <div className="db-field">
                  <label>License Number</label>
                  <input name="license_number" value={form.license_number} onChange={change} aria-invalid={!!errors.license_number} aria-describedby="err-pf-lic" />
                  <FieldError id="err-pf-lic" message={errors.license_number} />
                </div>
                <div className="db-field">
                  <label>Operating Hours</label>
                  <input name="operating_hours" value={form.operating_hours} onChange={change} placeholder="8:00 AM - 5:00 PM" />
                </div>
              </div>
              <div className="db-field">
                <label>Pin your blood bank on the map</label>
                <LocationPicker
                  latitude={form.latitude}
                  longitude={form.longitude}
                  onChange={(la, ln) => setForm((f) => ({ ...f, latitude: la, longitude: ln }))}
                  onAddress={(a) => setForm((f) => (f.address ? f : { ...f, address: a }))}
                />
                <small className="db-subtext">
                  Donors and admins see your bank at this pin. Moving the pin does not need re-verification.
                </small>
              </div>
            </>
          )}

          <div className="db-form-actions">
            <button type="submit" className="db-btn" disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </div>

      {/* ---------- SIGN-IN & SECURITY (re-verification) ---------- */}
      <div className="db-card">
        <h3>Sign-in &amp; security</h3>
        <form onSubmit={handleSecuritySubmit} className="db-form" autoComplete="off" noValidate>
          <div className="db-field">
            <label>Email</label>
            <input type="email" value={sec.email} onChange={(e) => { setSec({ ...sec, email: e.target.value }); setSecErrors((p) => ({ ...p, email: "" })); }} aria-invalid={!!secErrors.email} aria-describedby="err-pf-email" />
            <FieldError id="err-pf-email" message={secErrors.email} />
          </div>

          <div className="db-field">
            <label>New Password (leave blank to keep your current one)</label>
            <input
              type="password"
              value={sec.new_password}
              onChange={(e) => { setSec({ ...sec, new_password: e.target.value }); setSecErrors((p) => ({ ...p, new_password: "" })); }}
              autoComplete="new-password"
              aria-invalid={!!secErrors.new_password}
              aria-describedby="err-pf-newpw"
            />
            <FieldError id="err-pf-newpw" message={secErrors.new_password} />
            {!secErrors.new_password && <small className="db-subtext">Min. 8 characters, at least 1 letter and 1 number.</small>}
          </div>

          {(emailChanged || sec.new_password) && (
            <div className="db-field">
              <label>Current Password (required to confirm it's you)</label>
              <input
                type="password"
                value={sec.current_password}
                onChange={(e) => { setSec({ ...sec, current_password: e.target.value }); setSecErrors((p) => ({ ...p, current_password: "" })); }}
                autoComplete="current-password"
                aria-invalid={!!secErrors.current_password}
                aria-describedby="err-pf-curpw"
              />
              <FieldError id="err-pf-curpw" message={secErrors.current_password} />
            </div>
          )}

          <div className="db-form-actions">
            <button type="submit" className="db-btn-outline" disabled={savingSec}>
              {savingSec ? "Updating..." : "Update sign-in details"}
            </button>
          </div>
        </form>
      </div>

      <SuccessPopup open={!!popup} title={popup?.title} message={popup?.message} onClose={() => setPopup(null)} />

      <ConfirmDialog
        open={confirmOpen}
        title="Re-verification required"
        message="Changing your blood bank's name or license number takes it out of “verified” status until an admin approves it again. You won't be able to edit inventory in the meantime."
        confirmLabel="Save and request re-verification"
        cancelLabel="Go back"
        onConfirm={confirmSensitive}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export default ProfileSection;