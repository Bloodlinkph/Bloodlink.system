import { useState } from "react";
import heroImage from "../assets/blood-donation-hero.webp";
import bloodLinkMark from "../assets/bloodlink-mark.png";
import "./LandingPage.css";

// Drop this in as the very first screen in App.jsx (before Login/Register).
// Usage:  <LandingPage switchToLogin={...} switchToRegister={...} />

const DropIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 54 66" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M27 0C27 0 54 34.5 54 46C54 57.0457 41.9117 66 27 66C12.0883 66 0 57.0457 0 46C0 34.5 27 0 27 0Z"
      fill="currentColor"
    />
  </svg>
);

// same rules the matching engine uses on the backend (red blood cell donation)
const COMPATIBILITY = [
  ["O-", ["Everyone"]],
  ["O+", ["O+", "A+", "B+", "AB+"]],
  ["A-", ["A-", "A+", "AB-", "AB+"]],
  ["A+", ["A+", "AB+"]],
  ["B-", ["B-", "B+", "AB-", "AB+"]],
  ["B+", ["B+", "AB+"]],
  ["AB-", ["AB-", "AB+"]],
  ["AB+", ["AB+"]],
];

function LandingPage({ switchToLogin, switchToRegister }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="lp-page">
      {/* ===================== NAVBAR ===================== */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-logo">
            <img className="lp-logo-mark" src={bloodLinkMark} alt="" />
            <span>Blood<span className="lp-logo-link">Link</span></span>
          </div>

          <div className="lp-nav-links">
            <a href="#help">How You Can Help</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#about">About</a>
          </div>

          <div className="lp-nav-actions">
            <button className="lp-btn-ghost" onClick={switchToLogin}>Log in</button>
            <button className="lp-btn-solid" onClick={switchToRegister}>Get Started</button>
          </div>

          <button
            className="lp-burger"
            aria-label="Menu"
            onClick={() => setNavOpen((o) => !o)}
          >
            <span /><span /><span />
          </button>
        </div>

        {navOpen && (
          <div className="lp-mobile-menu">
            <a href="#help" onClick={() => setNavOpen(false)}>How You Can Help</a>
            <a href="#how-it-works" onClick={() => setNavOpen(false)}>How It Works</a>
            <a href="#about" onClick={() => setNavOpen(false)}>About</a>
            <button className="lp-btn-solid" onClick={switchToRegister}>Get Started</button>
          </div>
        )}
      </nav>

      {/* ===================== HERO ===================== */}
      <header className="lp-hero">
        <div className="lp-hero-text">
          <div className="lp-eyebrow">
            <span className="lp-eyebrow-dash" />
            Every drop counts
          </div>
          <h1>
            One Donation.<br />Endless Lives Saved.
          </h1>
          <p className="lp-hero-sub">
            BloodLink connects donors, requesters, and blood banks so the right
            blood type reaches the right person when it's needed.
          </p>

          <div className="lp-hero-actions">
            <button className="lp-btn-action lp-btn-lg" onClick={switchToRegister}>
              Become a Donor
            </button>
          </div>

          <div className="lp-stat-row">
            <div className="lp-stat">
              <strong>8</strong>
              <span>Blood types supported</span>
            </div>
            <div className="lp-stat">
              <strong>Nearby</strong>
              <span>Location-based matching</span>
            </div>
            <div className="lp-stat">
              <strong>Verified</strong>
              <span>Blood bank partners</span>
            </div>
          </div>
        </div>

        <div className="lp-hero-visual">
          <div className="lp-hero-blob" />
          <div className="lp-hero-photo-frame">
            <img src={heroImage} alt="A nurse handling a blood donation bag beside a donor" />
          </div>
          <div className="lp-hero-badge">
            <DropIcon className="lp-hero-badge-drop" />
            <div>
              <strong>Smart Matching</strong>
              <span>Donors alerted in the app</span>
            </div>
          </div>
        </div>
      </header>

      {/* ===================== HOW YOU CAN HELP ===================== */}
      <section id="help" className="lp-section">
        <div className="lp-section-head">
          <div className="lp-eyebrow lp-eyebrow-dark">
            <span className="lp-eyebrow-dash" />
            How you can help
          </div>
          <h2>Three ways to save a life</h2>
        </div>

        <div className="lp-card-grid">
          <div className="lp-role-card">
            <div className="lp-role-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 21s-7-4.35-9.5-8.5C.7 8.8 2.3 5 6 5c2 0 3.4 1.1 4 2 .6-.9 2-2 4-2 3.7 0 5.3 3.8 3.5 7.5C19 16.65 12 21 12 21Z" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Become a Donor</h3>
            <p>Register your blood type and availability. Get matched with nearby requests and help save a life.</p>
            <button className="lp-role-link" onClick={switchToRegister}>Sign up as Donor →</button>
          </div>

          <div className="lp-role-card">
            <div className="lp-role-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="17" rx="2.5" />
                <path d="M8 2.5V6M16 2.5V6M3 10h18" strokeLinecap="round" />
                <path d="M12 13v5M9.5 15.5h5" strokeLinecap="round" />
              </svg>
            </div>
            <h3>Request Blood</h3>
            <p>Post a request with your blood type, urgency, and location. We'll find compatible donors near you.</p>
            <button className="lp-role-link" onClick={switchToRegister}>Request as Patient/Hospital →</button>
          </div>

          <div className="lp-role-card">
            <div className="lp-role-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 21V9l8-5 8 5v12" strokeLinejoin="round" />
                <path d="M9 21v-7h6v7" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Partner Your Blood Bank</h3>
            <p>List your inventory, get verified, and log donations directly through the BloodLink network.</p>
            <button className="lp-role-link" onClick={switchToRegister}>Register a Blood Bank →</button>
          </div>
        </div>
      </section>

      {/* ===================== HOW IT WORKS ===================== */}
      <section id="how-it-works" className="lp-section lp-section-tint">
        <div className="lp-section-head">
          <div className="lp-eyebrow lp-eyebrow-dark">
            <span className="lp-eyebrow-dash" />
            How it works
          </div>
          <h2>From sign-up to saving a life</h2>
        </div>

        <div className="lp-steps">
          <div className="lp-step">
            <div className="lp-step-num">1</div>
            <h4>Create your account</h4>
            <p>One account lets you donate and request blood. Blood banks register separately. An admin approves new accounts.</p>
          </div>
          <div className="lp-step-connector" />
          <div className="lp-step">
            <div className="lp-step-num">2</div>
            <h4>Get matched</h4>
            <p>Our system finds compatible blood types and sorts donors by distance and urgency.</p>
          </div>
          <div className="lp-step-connector" />
          <div className="lp-step">
            <div className="lp-step-num">3</div>
            <h4>Respond &amp; donate</h4>
            <p>Accept the match, coordinate with the blood bank, and help save a life.</p>
          </div>
        </div>
      </section>

      {/* ===================== WHY BLOODLINK ===================== */}
      <section id="why" className="lp-section">
        <div className="lp-section-head">
          <div className="lp-eyebrow lp-eyebrow-dark">
            <span className="lp-eyebrow-dash" />
            Why BloodLink
          </div>
          <h2>Built to get help there faster</h2>
        </div>

        <div className="lp-feature-grid">
          <div className="lp-feature">
            <div className="lp-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3s6 6.5 6 10.8A6 6 0 0 1 12 20a6 6 0 0 1-6-6.2C6 9.5 12 3 12 3Z" strokeLinejoin="round" />
                <path d="M9.5 14.5l2 2 3-3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Compatible matches</h3>
            <p>Requests are matched to donors whose blood type can be given to the patient, not just exact matches.</p>
          </div>

          <div className="lp-feature">
            <div className="lp-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" strokeLinejoin="round" />
                <circle cx="12" cy="9.5" r="2.5" />
              </svg>
            </div>
            <h3>Closest donors first</h3>
            <p>Pin where blood is needed and available donors are sorted by distance from that spot.</p>
          </div>

          <div className="lp-feature">
            <div className="lp-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M6 8a6 6 0 0 1 12 0c0 4.2 1.2 6 2 7H4c.8-1 2-2.8 2-7Z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9.5 19a2.5 2.5 0 0 0 5 0" strokeLinecap="round" />
              </svg>
            </div>
            <h3>Stay in the loop</h3>
            <p>Donors are alerted in the app when a request matches, and requesters see their response.</p>
          </div>

          <div className="lp-feature">
            <div className="lp-feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3l7 3v5.5c0 4.3-2.9 7.6-7 9.5-4.1-1.9-7-5.2-7-9.5V6l7-3Z" strokeLinejoin="round" />
                <path d="M9 12l2.2 2.2L15.5 10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3>Reviewed blood banks</h3>
            <p>Blood bank accounts are reviewed and verified by an admin before they are marked as verified.</p>
          </div>
        </div>
      </section>

      {/* ===================== ABOUT ===================== */}
      <section id="about" className="lp-section lp-section-tint">
        <div className="lp-about">
          <div className="lp-about-text">
            <div className="lp-eyebrow lp-eyebrow-dark">
              <span className="lp-eyebrow-dash" />
              About BloodLink
            </div>
            <h2>One place for donors, patients and blood banks</h2>
            <p>
              BloodLink brings voluntary donors, patients and licensed blood banks
              together, so help reaches the people who need it, faster. Every drop
              shared is a life given back.
            </p>
            <p>
              Anyone can use a single account to donate when they're able and
              request blood when they or their family need it.
            </p>
            <button className="lp-btn-action lp-btn-lg" onClick={switchToRegister}>
              Become a Donor
            </button>
          </div>

          <div className="lp-compat-card">
            <h3>Who can donate to whom</h3>
            <p className="lp-compat-note">Red blood cell donations. Final matching is always confirmed by the blood bank or medical staff.</p>
            <div className="lp-compat">
              <div className="lp-compat-row lp-compat-head">
                <span>Donor</span>
                <span />
                <span>Can give to</span>
              </div>
              {COMPATIBILITY.map(([from, to]) => (
                <div className="lp-compat-row" key={from}>
                  <span className="lp-compat-from">{from}</span>
                  <span className="lp-compat-arrow" aria-hidden="true">→</span>
                  <span className="lp-compat-to">{to.join(", ")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===================== CTA BANNER ===================== */}
      <section className="lp-cta">
        <div className="lp-cta-text">
          <h2>Join the BloodLink community today</h2>
          <p>Every donor counts. Every second matters.</p>
        </div>
        <button className="lp-btn-solid lp-btn-lg lp-btn-white" onClick={switchToRegister}>
          Get Started
        </button>
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="lp-footer">
        <div className="lp-logo lp-logo-footer">
          <img className="lp-logo-mark" src={bloodLinkMark} alt="" />
          <span>Blood<span className="lp-logo-link">Link</span></span>
        </div>
        <p>&copy; {new Date().getFullYear()} BloodLink. Give blood. Give hope.</p>
      </footer>
    </div>
  );
}

export default LandingPage;