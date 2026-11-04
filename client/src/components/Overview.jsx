import "./overview.css";

// "in_progress" -> "In progress"
export const prettify = (s) =>
  s ? String(s).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";

// Shared landing screen for every portal.
//   greeting   - big welcome line
//   subtitle   - small line under it
//   attention  - [{ tone: "warn" | "info" | "ok", text, actionLabel?, onAction? }]
//   stats      - [{ label, value, hint?, tone?: "accent" | "good" | "warn" | "bad" | "muted", onClick? }]
//   actions    - [{ label, onClick, primary? }]
function Overview({ greeting, subtitle, attention = [], stats = [], actions = [] }) {
  return (
    <div className="ov-wrap">
      <div className="ov-hello">
        <h2 className="ov-greeting">{greeting}</h2>
        {subtitle && <p className="ov-subtitle">{subtitle}</p>}
      </div>

      {attention.length > 0 && (
        <div className="ov-attention">
          {attention.map((a, i) => (
            <div key={i} className={`ov-banner ov-banner-${a.tone || "info"}`}>
              <span className="ov-banner-dot" aria-hidden="true" />
              <p className="ov-banner-text">{a.text}</p>
              {a.actionLabel && (
                <button type="button" className="ov-banner-btn" onClick={a.onAction}>
                  {a.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="ov-grid">
        {stats.map((s) => {
          const body = (
            <>
              <span className="ov-stat-label">{s.label}</span>
              <span className={`ov-stat-value ov-tone-${s.tone || "default"}`}>{s.value}</span>
              {s.hint && <span className="ov-stat-hint">{s.hint}</span>}
            </>
          );
          return s.onClick ? (
            <button key={s.label} type="button" className="ov-stat ov-stat-click" onClick={s.onClick}>
              {body}
            </button>
          ) : (
            <div key={s.label} className="ov-stat">
              {body}
            </div>
          );
        })}
      </div>

      {actions.length > 0 && (
        <div className="ov-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={a.primary ? "db-btn" : "db-btn-outline"}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default Overview;