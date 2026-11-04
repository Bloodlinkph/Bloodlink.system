import { useState } from "react";
import DonorDashboard from "./DonorDashboard";
import RequesterDashboard from "./RequesterDashboard";

export const MODE_KEY = "bloodlink:mode";

// One account, two modes. The toggle is passed into each dashboard's header.
function MemberDashboard({ user, onLogout }) {
  const [mode, setMode] = useState(() => {
    const saved = sessionStorage.getItem(MODE_KEY);
    if (saved === "donor" || saved === "requester") return saved;
    return user.role === "requester" ? "requester" : "donor"; // legacy roles
  });

  const switchMode = (m) => {
    sessionStorage.setItem(MODE_KEY, m);
    setMode(m);
  };

  const modeSwitch = (
    <div className="db-mode-switch" role="group" aria-label="Switch between donating and requesting">
      <button type="button" aria-pressed={mode === "donor"} onClick={() => switchMode("donor")}>
        Donate
      </button>
      <button type="button" aria-pressed={mode === "requester"} onClick={() => switchMode("requester")}>
        Request blood
      </button>
    </div>
  );

  const Dashboard = mode === "donor" ? DonorDashboard : RequesterDashboard;
  return <Dashboard key={mode} user={user} onLogout={onLogout} modeSwitch={modeSwitch} onSwitchMode={switchMode} />;
}

export default MemberDashboard;