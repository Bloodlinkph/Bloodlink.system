import { useState } from "react";
import api from "../api";
import logo from "../assets/BloodLink_Mark_Transparent.png";
import FieldError from "./FieldError";
import {
  validate, hasErrors, required, optional, email as emailRule, password as passwordRule, contact as contactRule,
  address as addressRule, lettersOnly, bloodType as bloodTypeRule, notFuture, maxAge, focusFirstError,
} from "../validation";
import "./Login.css";
import "./Register.css";

function Register({ onRegisterSuccess, switchToLogin, switchToLanding }) {
  // sign-up is for members only (one account = donor + requester)
  const role = "member";
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    middle_initial: "",
    email: "",
    password: "",
    contact_number: "",
    date_of_birth: "",
    address: "",
    barangay: "",
    city: "",
    blood_type: "",
    requester_type: "individual",
    affiliated_hospital: "",
  });
  const [error, setError] = useState(""); // only for server problems (e.g. email already registered)
  const [errors, setErrors] = useState({}); // per-field messages
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // today as YYYY-MM-DD (local time), so a future birthday can't be picked
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const handleChange = (e) => {
    let { name, value } = e.target;
    if (name === "middle_initial") value = value.replace(/[^A-Za-z\u00D1\u00F1]/g, "").slice(0, 1);
    setFormData({ ...formData, [name]: value });
    // the red message goes away as soon as the person edits that field
    setErrors((p) => (p[name] ? { ...p, [name]: "" } : p));
  };

  const rules = {
    first_name: [required("First name"), lettersOnly("First name")],
    last_name: [required("Last name"), lettersOnly("Last name")],
    email: [required("Email"), emailRule],
    password: [required("Password"), passwordRule],
    contact_number: [required("Contact number"), contactRule],
    date_of_birth: [required("Birthday"), notFuture("Birthday"), maxAge(120, "Birthday")],
    blood_type: [required("Blood type"), bloodTypeRule],
    affiliated_hospital: [optional(lettersOnly("Hospital"))],
    address: [optional(addressRule("Address"))],
    barangay: [optional(lettersOnly("Barangay"))],
    city: [optional(lettersOnly("City"))],
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const found = validate(formData, rules);
    setErrors(found);
    if (hasErrors(found)) {
      focusFirstError(e.currentTarget);
      return;
    }
    setLoading(true);
    let registered = false;

    try {
      // the server stores one full name: "First M Last" (no period, the name rule allows letters only)
      const { first_name, last_name, middle_initial, ...rest } = formData;
      const full_name = [first_name.trim(), middle_initial.trim().toUpperCase(), last_name.trim()]
        .filter(Boolean)
        .join(" ");
      const payload = { ...rest, full_name, role };
      const response = await api.post("/register", payload);
      registered = true;
      setSuccess("Account created! Redirecting you to log in...");
      if (onRegisterSuccess) onRegisterSuccess(response.data);
      // short pause so the success message can be read, then go to the login page
      setTimeout(() => {
        if (switchToLogin) switchToLogin();
      }, 1500);
    } catch (err) {
      const message = err.response?.data?.message || "Something went wrong. Please try again.";
      setError(message);
    } finally {
      if (!registered) setLoading(false); // keep the button disabled while redirecting
    }
  };

  return (
    <div className="bl-page bl-auth">
      <div className="bl-card">

        {/* LEFT HERO PANEL */}
        <div className="bl-hero">
          <div className="bl-brand">
            <div className="bl-logo-card">
              <img className="bl-logo-img" src={logo} alt="BloodLink blood-drop logo" />
            </div>
            <h2 className="bl-brand-name">BloodLink</h2>
            <p className="bl-hero-tagline">Give blood. Give hope.</p>
          </div>
          <p className="bl-hero-description">
            BloodLink connects voluntary donors, patients and licensed blood banks in one place,
            so help reaches the people who need it, faster. Every drop shared is a life given back.
          </p>
        </div>

        {/* RIGHT FORM PANEL */}
        <div className="bl-form-panel bl-wide">
          <button type="button" className="bl-back" onClick={switchToLanding}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            Back to home
          </button>

          <div className="bl-eyebrow">
            <span className="bl-eyebrow-dash" />
            Create account
          </div>

          <h1 className="bl-heading">Join BloodLink</h1>
          <p className="bl-subheading">Save lives in your community</p>

          {error && <div className="bl-error">{error}</div>}
          {success && <div className="bl-inline-success">{success}</div>}

          <div className="bl-form-scroll">
            <form onSubmit={handleSubmit} className="bl-reg-grid" noValidate>

              {/* NAME: first, last, middle initial */}
              <div className="bl-name-row bl-s12">
                <div className="bl-field">
                  <label htmlFor="rg-first">First name</label>
                  <div className="bl-input-wrap">
                    <input id="rg-first" name="first_name" value={formData.first_name} onChange={handleChange} aria-invalid={!!errors.first_name} aria-describedby="err-rg-first" autoComplete="given-name" style={{ paddingLeft: "14px" }} />
                  </div>
                  <FieldError id="err-rg-first" message={errors.first_name} />
                </div>
                <div className="bl-field">
                  <label htmlFor="rg-last">Last name</label>
                  <div className="bl-input-wrap">
                    <input id="rg-last" name="last_name" value={formData.last_name} onChange={handleChange} aria-invalid={!!errors.last_name} aria-describedby="err-rg-last" autoComplete="family-name" style={{ paddingLeft: "14px" }} />
                  </div>
                  <FieldError id="err-rg-last" message={errors.last_name} />
                </div>
                <div className="bl-field">
                  <label htmlFor="rg-mi">M.I.</label>
                  <div className="bl-input-wrap">
                    <input id="rg-mi" name="middle_initial" value={formData.middle_initial} onChange={handleChange} maxLength={1} placeholder="A" aria-label="Middle initial" style={{ paddingLeft: "14px", textTransform: "uppercase" }} />
                  </div>
                </div>
              </div>

              <div className="bl-field bl-s6">
                <label htmlFor="rg-email">Email</label>
                <div className="bl-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                    <path d="M3.5 6.5L12 13L20.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <input id="rg-email" type="email" name="email" value={formData.email} onChange={handleChange} aria-invalid={!!errors.email} aria-describedby="err-rg-email" autoComplete="email" />
                </div>
                <FieldError id="err-rg-email" message={errors.email} />
              </div>

              <div className="bl-field bl-s6">
                <label htmlFor="rg-pass">Password</label>
                <div className="bl-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
                    <path d="M8 10.5V7.5C8 5.29 9.79 3.5 12 3.5C14.21 3.5 16 5.29 16 7.5V10.5" strokeLinecap="round" />
                  </svg>
                  <input
                    id="rg-pass"
                    type={showPassword ? "text" : "password"}
                    className="bl-has-eye"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    aria-invalid={!!errors.password}
                    aria-describedby="err-rg-pass"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="bl-eye"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      {showPassword ? (
                        <>
                          <path d="M3 3l18 18" strokeLinecap="round" />
                          <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" strokeLinecap="round" />
                        </>
                      ) : (
                        <>
                          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" strokeLinecap="round" strokeLinejoin="round" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
                <FieldError id="err-rg-pass" message={errors.password} />
                {!errors.password && <small className="bl-hint">Min. 8 characters, at least 1 letter and 1 number.</small>}
              </div>

              <div className="bl-field bl-s3 bl-t3">
                <label htmlFor="rg-contact">Contact number</label>
                <div className="bl-input-wrap">
                  <input id="rg-contact" name="contact_number" value={formData.contact_number} onChange={handleChange} aria-invalid={!!errors.contact_number} aria-describedby="err-rg-contact" placeholder="09171234567" inputMode="tel" style={{ paddingLeft: "14px" }} />
                </div>
                <FieldError id="err-rg-contact" message={errors.contact_number} />
              </div>

              <div className="bl-field bl-s3 bl-t3">
                <label htmlFor="rg-dob">Birthday</label>
                <div className="bl-input-wrap">
                  <input id="rg-dob" type="date" name="date_of_birth" value={formData.date_of_birth} onChange={handleChange} aria-invalid={!!errors.date_of_birth} aria-describedby="err-rg-dob" max={todayStr} autoComplete="bday" style={{ paddingLeft: "14px" }} />
                </div>
                <FieldError id="err-rg-dob" message={errors.date_of_birth} />
              </div>

              <div className="bl-field bl-s3 bl-t3">
                <label htmlFor="rg-bt">Blood type</label>
                <div className="bl-input-wrap">
                  <select id="rg-bt" className="bl-role-select" name="blood_type" value={formData.blood_type} onChange={handleChange} aria-invalid={!!errors.blood_type} aria-describedby="err-rg-bt" style={{ paddingLeft: "14px" }}>
                    <option value="">Select blood type</option>
                    <option>A+</option><option>A-</option>
                    <option>B+</option><option>B-</option>
                    <option>O+</option><option>O-</option>
                    <option>AB+</option><option>AB-</option>
                  </select>
                </div>
                <FieldError id="err-rg-bt" message={errors.blood_type} />
              </div>

              <div className="bl-field bl-s3 bl-hosp">
                <label htmlFor="rg-rt">When requesting, I am a</label>
                <div className="bl-input-wrap">
                  <select id="rg-rt" className="bl-role-select" name="requester_type" value={formData.requester_type} onChange={handleChange} style={{ paddingLeft: "14px" }}>
                    <option value="individual">Individual / Patient</option>
                    <option value="hospital">Hospital</option>
                    <option value="family_member">Family Member</option>
                  </select>
                </div>
              </div>

              <div className="bl-field bl-s3 bl-hosp">
                <label htmlFor="rg-hosp">Hospital (optional)</label>
                <div className="bl-input-wrap">
                  <input id="rg-hosp" name="affiliated_hospital" value={formData.affiliated_hospital} onChange={handleChange} aria-invalid={!!errors.affiliated_hospital} aria-describedby="err-rg-hosp" style={{ paddingLeft: "14px" }} />
                </div>
                <FieldError id="err-rg-hosp" message={errors.affiliated_hospital} />
              </div>

              <div className="bl-field bl-s12">
                <label htmlFor="rg-addr">Address</label>
                <div className="bl-input-wrap">
                  <input id="rg-addr" name="address" value={formData.address} onChange={handleChange} aria-invalid={!!errors.address} aria-describedby="err-rg-addr" style={{ paddingLeft: "14px" }} />
                </div>
                <FieldError id="err-rg-addr" message={errors.address} />
              </div>

              <div className="bl-field bl-s3 bl-bc">
                <label htmlFor="rg-brgy">Barangay</label>
                <div className="bl-input-wrap">
                  <input id="rg-brgy" name="barangay" value={formData.barangay} onChange={handleChange} aria-invalid={!!errors.barangay} aria-describedby="err-rg-brgy" style={{ paddingLeft: "14px" }} />
                </div>
                <FieldError id="err-rg-brgy" message={errors.barangay} />
              </div>

              <div className="bl-field bl-s3 bl-bc">
                <label htmlFor="rg-city">City</label>
                <div className="bl-input-wrap">
                  <input id="rg-city" name="city" value={formData.city} onChange={handleChange} aria-invalid={!!errors.city} aria-describedby="err-rg-city" style={{ paddingLeft: "14px" }} />
                </div>
                <FieldError id="err-rg-city" message={errors.city} />
              </div>

              <button type="submit" className="bl-submit bl-s12" disabled={loading}>
                {loading ? "Creating account..." : "Sign Up"}
              </button>
            </form>
          </div>

          <p className="bl-footer-text">
            Already have an account?{" "}
            <strong onClick={switchToLogin}>Log in</strong>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;