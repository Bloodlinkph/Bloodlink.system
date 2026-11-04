import { useState } from "react";
import api from "../api";
import logo from "../assets/BloodLink_Mark_Transparent.png";
import "./Login.css";

function Login({ onLoginSuccess, switchToRegister, switchToLanding }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await api.post("/login", { email, password });
      onLoginSuccess(response.data);
    } catch (err) {
      const message = err.response?.data?.message || "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bl-page">
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
        <div className="bl-form-panel">
          <button type="button" className="bl-back" onClick={switchToLanding}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
            Back to home
          </button>

          <div className="bl-eyebrow">
            <span className="bl-eyebrow-dash" />
            Member portal
          </div>

          <h1 className="bl-heading">Welcome back</h1>
          <p className="bl-subheading">Sign in to your account</p>

          {error && <div className="bl-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="bl-field">
              <label htmlFor="bl-email">Email</label>
              <div className="bl-input-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                  <path d="M3.5 6.5L12 13L20.5 6.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <input
                  id="bl-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="bl-field">
              <label htmlFor="bl-password">Password</label>
              <div className="bl-input-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
                  <path d="M8 10.5V7.5C8 5.29 9.79 3.5 12 3.5C14.21 3.5 16 5.29 16 7.5V10.5" strokeLinecap="round" />
                </svg>
                <input
                  id="bl-password"
                  type={showPassword ? "text" : "password"}
                  className="bl-has-eye"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
            </div>

            {/* NOTE: "Remember me" and "Forgot password?" do nothing yet. Remove them or wire them up before launch. */}
            <div className="bl-row-between">
              <label className="bl-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>
              <button type="button" className="bl-forgot" onClick={(e) => e.preventDefault()}>
                Forgot password?
              </button>
            </div>

            <button type="submit" className="bl-submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="bl-footer-text">
            New here?{" "}
            <strong onClick={switchToRegister}>Create an account</strong>
          </p>

          <div className="bl-secure-note">
            Create an account, then sign in right away.
          </div>
        </div>
      </div>
    </div>
  );
}

export default Login;