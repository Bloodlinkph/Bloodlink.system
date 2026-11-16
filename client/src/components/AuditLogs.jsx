    import { useState, useEffect } from "react";
    import api from "../api";
    import Loading from "./Loading";

    // action_performed values look like "account_status_update"
    const pretty = (s) => {
    const t = String(s ?? "").replace(/_/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
    };

    // colored dot next to the action name (uses the same .st styles as the rest of the dashboard)
    const actionTone = (action) => {
    if (/reject|disable|critical|delete/i.test(action)) return "crit";
    if (/password|pending/i.test(action)) return "warn";
    if (/verif|active|approve/i.test(action)) return "ok";
    return "info";
    };

    const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    function AuditLogs() {
    const [logs, setLogs] = useState([]);
    const [actions, setActions] = useState([]);
    const [action, setAction] = useState("");   // "" = all actions
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");     // search text after a short pause
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);

    // wait until the admin stops typing before asking the server
    useEffect(() => {
        const t = setTimeout(() => setQuery(search.trim()), 350);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
        setLoading(true);
        setError("");
        try {
            const res = await api.get("/admin/audit-logs", {
            params: { limit: 300, action: action || undefined, q: query || undefined },
            });
            if (cancelled) return;
            setLogs(res.data.logs);
            setActions(res.data.actions);
        } catch (err) {
            if (!cancelled) setError(err.response?.data?.message || "Could not load the audit logs.");
        } finally {
            if (!cancelled) setLoading(false);
        }
        })();
        return () => {
        cancelled = true;
        };
    }, [action, query, reloadKey]);

    const downloadCsv = () => {
        const cols = [
        ["log_id", "Log ID"], ["timestamp", "When"], ["action_performed", "Action"],
        ["user_name", "User"], ["user_role", "Role"], ["details", "Details"],
        ];
        const head = cols.map((c) => csvCell(c[1])).join(",");
        const body = logs.map((r) => cols.map((c) => csvCell(r[c[0]])).join(",")).join("\n");
        const blob = new Blob(["\ufeff" + head + "\n" + body], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="panel">
        <div className="toolbar">
            <label htmlFor="audit-logs-action" className="muted">Action</label>
            <select
            id="audit-logs-action"
            className="in sel"
            style={{ width: 220 }}
            value={action}
            onChange={(e) => setAction(e.target.value)}
            >
            <option value="">All actions</option>
            {actions.map((a) => (
                <option key={a} value={a}>{pretty(a)}</option>
            ))}
            </select>

            <input
            type="search"
            className="in"
            style={{ width: 240 }}
            placeholder="Search name or details"
            aria-label="Search audit logs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            />

            <button type="button" className="btn sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
            </button>
            <button type="button" className="btn sm" onClick={downloadCsv} disabled={logs.length === 0}>
            Download CSV
            </button>
        </div>

        {error && <div className="empty" role="alert">{error}</div>}

        {!error && loading && logs.length === 0 ? (
            <div className="empty"><Loading label="Loading audit logs..." /></div>
        ) : !error && logs.length === 0 ? (
            <div className="empty">
            {action || query ? "No log entries match your filters." : "No activity has been logged yet."}
            </div>
        ) : (
            !error && (
            <div className="tw">
                <table>
                <thead>
                    <tr>
                    <th className="r">#</th>
                    <th>When</th>
                    <th>Action</th>
                    <th>User</th>
                    <th>Details</th>
                    </tr>
                </thead>
                <tbody>
                    {logs.map((l) => (
                    <tr key={l.log_id}>
                        <td className="r num muted">{l.log_id}</td>
                        <td className="num">{l.timestamp}</td>
                        <td><span className={`st ${actionTone(l.action_performed)}`}>{pretty(l.action_performed)}</span></td>
                        <td>
                        {l.user_name}
                        {l.user_role && <span className="muted"> ({pretty(l.user_role)})</span>}
                        </td>
                        <td>{l.details}</td>
                    </tr>
                    ))}
                </tbody>
                </table>
            </div>
            )
        )}
        </div>
    );
    }

    export default AuditLogs;