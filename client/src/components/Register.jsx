import { useState } from "react";
import api from "../api";
import logo from "../assets/bloodlink-logo-light.png";
import "./Login.css";
import "./Register.css";

function Register({ onRegisterSuccess, switchToLogin, switchToLanding }) {
  const [role, setRole] = useState("member");
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    password: "",
    contact_number: "",
    address: "",
    barangay: "",
    city: "",
    // member fields (one account = donor + requester)
    blood_type: "",
    requester_type: "individual",
    affiliated_hospital: "",
    // blood bank fields
    bank_name: "",
    license_number: "",
    operating_hours: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    let registered = false;

    try {
      const payload = { ...formData, role };
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
    <div className="bl-page">
      <div className="bl-card">

        {/* LEFT HERO PANEL */}
        <div className="bl-hero">
          <div className="bl-logo-card">
            <img className="bl-logo-img" src={logo} alt="BloodLink" />
          </div>
          <div className="bl-hero-name">BloodLink</div>
        </div>

        {/* RIGHT FORM PANEL */}
        <div className="bl-form-panel">
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
            <form onSubmit={handleSubmit}>

              {/* ROLE PICKER */}
              <div className="bl-field">
                <label>I am registering as:</label>
                <div className="bl-input-wrap">
                  <select
                    className="bl-role-select"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    style={{ paddingLeft: "14px" }}
                  >
                    <option value="member">Donor / Requester</option>
                    <option value="blood_bank">Blood Bank</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              {/* COMMON FIELDS */}
              <div className="bl-field">
                <label>Full Name</label>
                <div className="bl-input-wrap">
                  <input name="full_name" value={formData.full_name} onChange={handleChange} required style={{ paddingLeft: "14px" }} />
                </div>
              </div>

              <div className="bl-field">
                <label>Email</label>
                <div className="bl-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                    <path d="M3.5 6.5L12 13L20.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <input type="email" name="email" value={formData.email} onChange={handleChange} required />
                </div>
              </div>

              <div className="bl-field">
                <label>Password</label>
                <div className="bl-input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
                    <path d="M8 10.5V7.5C8 5.29 9.79 3.5 12 3.5C14.21 3.5 16 5.29 16 7.5V10.5" strokeLinecap="round" />
                  </svg>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="bl-has-eye"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
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
                <small style={{ display: "block", marginTop: "5px", fontSize: "11.5px", color: "#9a9aa2" }}>
                  Min. 8 characters, at least 1 letter and 1 number.
                </small>
              </div>

              <div className="bl-field">
                <label>Contact Number</label>
                <div className="bl-input-wrap">
                  <input name="contact_number" value={formData.contact_number} onChange={handleChange} required placeholder="09171234567" style={{ paddingLeft: "14px" }} />
                </div>
              </div>

              <div className="bl-field">
                <label>Address</label>
                <div className="bl-input-wrap">
                  <input name="address" value={formData.address} onChange={handleChange} style={{ paddingLeft: "14px" }} />
                </div>
              </div>

              <div className="bl-field-row">
                <div className="bl-field">
                  <label>Barangay</label>
                  <div className="bl-input-wrap">
                    <input name="barangay" value={formData.barangay} onChange={handleChange} style={{ paddingLeft: "14px" }} />
                  </div>
                </div>

                <div className="bl-field">
                  <label>City</label>
                  <div className="bl-input-wrap">
                    <input name="city" value={formData.city} onChange={handleChange} style={{ paddingLeft: "14px" }} />
                  </div>
                </div>
              </div>

              {/* MEMBER FIELDS (donor + requester in one account) */}
              {role === "member" && (
                <>
                  <div className="bl-section-label">Your details</div>
                  <div className="bl-field">
                    <label>Blood Type</label>
                    <div className="bl-input-wrap">
                      <select
                        className="bl-role-select"
                        name="blood_type"
                        value={formData.blood_type}
                        onChange={handleChange}
                        required
                        style={{ paddingLeft: "14px" }}
                      >
                        <option value="">Select blood type</option>
                        <option>A+</option><option>A-</option>
                        <option>B+</option><option>B-</option>
                        <option>O+</option><option>O-</option>
                        <option>AB+</option><option>AB-</option>
                      </select>
                    </div>
                    <small>One account lets you both donate and request blood.</small>
                  </div>
                  <div className="bl-field">
                    <label>When requesting, I am a</label>
                    <div className="bl-input-wrap">
                      <select
                        className="bl-role-select"
                        name="requester_type"
                        value={formData.requester_type}
                        onChange={handleChange}
                        style={{ paddingLeft: "14px" }}
                      >
                        <option value="individual">Individual / Patient</option>
                        <option value="hospital">Hospital</option>
                        <option value="family_member">Family Member</option>
                      </select>
                    </div>
                  </div>
                  <div className="bl-field">
                    <label>Affiliated Hospital (optional)</label>
                    <div className="bl-input-wrap">
                      <input name="affiliated_hospital" value={formData.affiliated_hospital} onChange={handleChange} style={{ paddingLeft: "14px" }} />
                    </div>
                  </div>
                </>
              )}

              {/* BLOOD BANK-ONLY FIELDS */}
              {role === "blood_bank" && (
                <>
                  <div className="bl-section-label">Blood bank details</div>
                  <div className="bl-field">
                    <label>Blood Bank Name</label>
                    <div className="bl-input-wrap">
                      <input name="bank_name" value={formData.bank_name} onChange={handleChange} required style={{ paddingLeft: "14px" }} />
                    </div>
                  </div>
                  <div className="bl-field">
                    <label>License Number (optional)</label>
                    <div className="bl-input-wrap">
                      <input name="license_number" value={formData.license_number} onChange={handleChange} style={{ paddingLeft: "14px" }} />
                    </div>
                  </div>
                  <div className="bl-field">
                    <label>Operating Hours (optional)</label>
                    <div className="bl-input-wrap">
                      <input name="operating_hours" value={formData.operating_hours} onChange={handleChange} placeholder="8:00 AM - 5:00 PM" style={{ paddingLeft: "14px" }} />
                    </div>
                  </div>
                </>
              )}

              <button type="submit" className="bl-submit" disabled={loading} style={{ marginTop: "8px" }}>
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