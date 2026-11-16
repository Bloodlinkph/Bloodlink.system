    import { useState } from "react";
    import api from "../api";
    import logo from "../assets/bloodlink-logo-light.png";
    import FieldError from "./FieldError";
    import { validate, hasErrors, required, password as passwordRule, focusFirstError } from "../validation";
    import "./Login.css";

    // Opened from the link in the reset email (App.jsx passes the token from ?reset=...).
    function ResetPassword({ token, onDone }) {
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState(""); // server problems only (e.g. expired link)
    const [errors, setErrors] = useState({});
    const [success, setSuccess] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        const found = validate(
        { password, confirm },
        {
            password: [required("New password"), passwordRule],
            confirm: [
            required("Confirm password"),
            (v, all) => (v !== all.password ? "The two passwords don't match." : ""),
            ],
        }
        );
        setErrors(found);
        if (hasErrors(found)) {
        focusFirstError(e.currentTarget);
        return;
        }
        setLoading(true);
        try {
        const res = await api.post("/reset-password", { token, new_password: password });
        setSuccess(res.data.message);
        setPassword("");
        setConfirm("");
        } catch (err) {
        setError(err.response?.data?.message || "Something went wrong. Please try again.");
        } finally {
        setLoading(false);
        }
    };

    return (
        <div className="bl-page">
        <div className="bl-card">
            <div className="bl-hero">
            <div className="bl-logo-card">
                <img className="bl-logo-img" src={logo} alt="BloodLink" />
            </div>
            <div className="bl-hero-name">BloodLink</div>
            </div>

            <div className="bl-form-panel">
            <div className="bl-eyebrow">
                <span className="bl-eyebrow-dash" />
                Password help
            </div>
            <h1 className="bl-heading">Choose a new password</h1>
            <p className="bl-subheading">Min. 8 characters, at least 1 letter and 1 number.</p>

            {error && <div className="bl-error">{error}</div>}
            {success && <div className="bl-inline-success">{success}</div>}

            {success ? (
                <button type="button" className="bl-submit" onClick={onDone}>Go to sign in</button>
            ) : (
                <form onSubmit={handleSubmit} noValidate>
                <div className="bl-field">
                    <label htmlFor="bl-new-pw">New password</label>
                    <div className="bl-input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
                        <path d="M8 10.5V7.5C8 5.29 9.79 3.5 12 3.5C14.21 3.5 16 5.29 16 7.5V10.5" strokeLinecap="round" />
                    </svg>
                    <input
                        id="bl-new-pw"
                        type={showPassword ? "text" : "password"}
                        className="bl-has-eye"
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: "" })); }}
                        autoComplete="new-password"
                        aria-invalid={!!errors.password}
                        aria-describedby="err-new-pw"
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
                    <FieldError id="err-new-pw" message={errors.password} />
                </div>

                <div className="bl-field">
                    <label htmlFor="bl-confirm-pw">Confirm new password</label>
                    <div className="bl-input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
                        <path d="M8 10.5V7.5C8 5.29 9.79 3.5 12 3.5C14.21 3.5 16 5.29 16 7.5V10.5" strokeLinecap="round" />
                    </svg>
                    <input
                        id="bl-confirm-pw"
                        type={showPassword ? "text" : "password"}
                        value={confirm}
                        onChange={(e) => { setConfirm(e.target.value); setErrors((p) => ({ ...p, confirm: "" })); }}
                        autoComplete="new-password"
                        aria-invalid={!!errors.confirm}
                        aria-describedby="err-confirm-pw"
                    />
                    </div>
                    <FieldError id="err-confirm-pw" message={errors.confirm} />
                </div>

                <button type="submit" className="bl-submit" disabled={loading}>
                    {loading ? "Saving..." : "Save new password"}
                </button>
                <p className="bl-footer-text">
                    Link not working? <strong onClick={onDone}>Request a new one</strong>
                </p>
                </form>
            )}
            </div>
        </div>
        </div>
    );
    }

    export default ResetPassword;