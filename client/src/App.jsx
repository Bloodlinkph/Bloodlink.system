import { useState, useEffect } from "react";
import { TOKEN_KEY } from "./api";
import LandingPage from "./components/LandingPage";
import Login from "./components/Login";
import Register from "./components/Register";
import ResetPassword from "./components/ResetPassword";
import AdminDashboard from "./components/AdminDashboard";
import MemberDashboard, { MODE_KEY } from "./components/MemberDashboard";
import BloodBankDashboard from "./components/BloodBankDashboardV9";

function App() {
  const [user, setUser] = useState(null);
  const [authView, setAuthView] = useState("landing");
  // opened from the emailed link: https://your-site/?reset=<token>
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get("reset"));

  const finishReset = () => {
    window.history.replaceState({}, "", window.location.pathname); // drop the token from the address bar
    setResetToken(null);
    setAuthView("login");
  };

  const handleLoginSuccess = (data) => {
    sessionStorage.setItem(TOKEN_KEY, data.token);
    setUser(data);
  };
  const handleLogout = () => {
    sessionStorage.removeItem(MODE_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setAuthView("landing");
  };

  // api.js fires this when the server says the session is no longer valid
  useEffect(() => {
    const onUnauthorized = () => {
      sessionStorage.removeItem(MODE_KEY);
      setUser(null);
      setAuthView("login");
    };
    window.addEventListener("bloodlink:unauthorized", onUnauthorized);
    return () => window.removeEventListener("bloodlink:unauthorized", onUnauthorized);
  }, []);

  if (!user && resetToken) {
    return <ResetPassword token={resetToken} onDone={finishReset} />;
  }

  if (!user) {
    if (authView === "landing") {
      return (
        <LandingPage
          switchToLogin={() => setAuthView("login")}
          switchToRegister={() => setAuthView("register")}
        />
      );
    }
    if (authView === "login") {
      return (
        <Login
          onLoginSuccess={handleLoginSuccess}
          switchToRegister={() => setAuthView("register")}
          switchToLanding={() => setAuthView("landing")}
        />
      );
    } else {
      return (
        <Register
          switchToLogin={() => setAuthView("login")}
          switchToLanding={() => setAuthView("landing")}
        />
      );
    }
  }

  if (user.role === "admin") {
    return <AdminDashboard user={user} onLogout={handleLogout} />;
  }

  // "donor" and "requester" are only a safety net for sessions from before the migration
  if (user.role === "member" || user.role === "donor" || user.role === "requester") {
    return <MemberDashboard user={user} onLogout={handleLogout} />;
  }

  if (user.role === "blood_bank") {
    return <BloodBankDashboard user={user} onLogout={handleLogout} />;
  }

  return (
    <div style={{ textAlign: "center", marginTop: "50px" }}>
      <h1>Welcome, {user.full_name}!</h1>
      <p>Role: {user.role}</p>
      <button onClick={handleLogout} style={{ marginTop: "20px", padding: "8px 16px" }}>
        Logout
      </button>
    </div>
  );
}

export default App;