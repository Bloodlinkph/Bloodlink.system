import { useState, useEffect, useRef, useCallback } from "react";
import api from "../api";
import "./notifications.css";
import Loading from "./Loading";

// SPRINT 2 FIX: emergency / critical messages stand out from normal notifications
const isAlert = (m) => /emergency|critical/i.test(String(m || ""));

// Fired after any component changes notification state, so the bell and the
// Notifications screen refetch and stay in sync.
const SYNC_EVENT = "bloodlink:notifications-changed";

// Shared by the bell and the Notifications screen.
function useNotifications(userId, pollMs = 30000) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get(`/notifications/${userId}`);
      setNotifications(res.data);
      setError("");
    } catch (err) {
      setError("Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, pollMs);
    window.addEventListener(SYNC_EVENT, fetchNotifications);
    return () => {
      clearInterval(interval);
      window.removeEventListener(SYNC_EVENT, fetchNotifications);
    };
  }, [userId, pollMs, fetchNotifications]);

  // accepts one id or an array of ids
  const markRead = async (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    if (list.length === 0) return;

    // optimistic update so the UI feels instant
    setNotifications((prev) =>
      prev.map((n) => (list.includes(n.notification_id) ? { ...n, read_status: true } : n))
    );
    try {
      await Promise.all(list.map((id) => api.put(`/notifications/${id}/read`)));
      window.dispatchEvent(new Event(SYNC_EVENT));
    } catch (err) {
      fetchNotifications(); // resync if any request failed
    }
  };

  const unreadCount = notifications.filter((n) => !n.read_status).length;

  const markAllRead = () =>
    markRead(notifications.filter((n) => !n.read_status).map((n) => n.notification_id));

  return { notifications, loading, error, unreadCount, markRead, markAllRead };
}

// Drop this into any dashboard header:
//   <NotificationBell userId={user.user_id} />
// Poll interval keeps the badge count fresh without a full page reload.
function NotificationBell({ userId, pollMs = 30000 }) {
  const { notifications, loading, error, unreadCount, markRead, markAllRead } =
    useNotifications(userId, pollMs);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // close the dropdown when clicking outside of it, or pressing Esc
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const handleKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  return (
    <div className="nb-wrap" ref={wrapRef}>
      <button
        type="button"
        className="nb-bell-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 8a6 6 0 0 1 12 0c0 4.2 1.2 6 2 7H4c.8-1 2-2.8 2-7Z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.5 19a2.5 2.5 0 0 0 5 0" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 && <span className="nb-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="nb-dropdown">
          <div className="nb-dropdown-header">
            <span>
              Notifications
              {unreadCount > 0 && <span className="nb-sub">{unreadCount} unread</span>}
            </span>
            {unreadCount > 0 && (
              <button type="button" className="nb-mark-all" onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="nb-list">
            {loading ? (
              <p className="nb-empty"><Loading label="Loading..." /></p>
            ) : error ? (
              <p className="nb-empty nb-error-text">{error}</p>
            ) : notifications.length === 0 ? (
              <p className="nb-empty">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.notification_id}
                  className={`nb-item ${n.read_status ? "" : "nb-item-unread"} ${isAlert(n.message) ? "nb-emergency" : ""}`}
                  onClick={() => !n.read_status && markRead(n.notification_id)}
                >
                  <p className="nb-message">{isAlert(n.message) && <span className="alert-tag">ALERT</span>}{n.message}</p>
                  <span className="nb-date">{n.date_sent}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Full-screen list for the "Notifications" sidebar item:
//   import NotificationBell, { NotificationsSection } from "./NotificationBell";
//   <NotificationsSection userId={user.user_id} />
export function NotificationsSection({ userId, limit = 50, pollMs = 30000 }) {
  const { notifications, loading, error, unreadCount, markRead, markAllRead } =
    useNotifications(userId, pollMs);
  const [tab, setTab] = useState("all"); // "all" | "unread"
  const [showAll, setShowAll] = useState(false);

  const filtered = tab === "unread" ? notifications.filter((n) => !n.read_status) : notifications;
  const visible = showAll ? filtered : filtered.slice(0, limit);

  return (
    <section className="db-card db-card-flush db-notif-section" aria-label="Notifications">
      <div className="db-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "all"}
          className={tab === "all" ? "on" : ""}
          onClick={() => setTab("all")}
        >
          All<span className="c">{notifications.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "unread"}
          className={tab === "unread" ? "on" : ""}
          onClick={() => setTab("unread")}
        >
          Unread<span className={`c ${unreadCount > 0 ? "crit" : ""}`}>{unreadCount}</span>
        </button>
        {unreadCount > 0 && (
          <button type="button" className="db-link db-tabs-action" onClick={markAllRead}>
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <p className="db-muted db-empty"><Loading label="Loading notifications..." /></p>
      ) : error ? (
        <p className="db-muted db-empty db-notif-error">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="db-muted db-empty">
          {tab === "unread" ? "No unread notifications." : "You're all caught up. New updates will appear here."}
        </p>
      ) : (
        <>
          <ul className="db-notif-list">
            {visible.map((n) => {
              const unread = !n.read_status;
              return (
                <li
                  key={n.notification_id}
                  className={`db-notif-item ${unread ? "db-notif-item-unread" : ""} ${isAlert(n.message) ? "db-notif-emergency" : ""}`}
                  onClick={() => unread && markRead(n.notification_id)}
                  onKeyDown={(e) => {
                    if (unread && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      markRead(n.notification_id);
                    }
                  }}
                  tabIndex={unread ? 0 : undefined}
                  title={unread ? "Click to mark as read" : undefined}
                >
                  <div className="db-notif-body">
                    <p className="db-notif-message">{isAlert(n.message) && <span className="alert-tag">ALERT</span>}{n.message}</p>
                    <span className="db-notif-date">{n.date_sent}</span>
                  </div>
                  {unread && <span className="db-notif-new">New</span>}
                </li>
              );
            })}
          </ul>

          {filtered.length > limit && (
            <div className="db-foot-note">
              <span>Showing {visible.length} of {filtered.length}</span>
              <button type="button" className="db-link" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show fewer" : "Show all"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default NotificationBell;