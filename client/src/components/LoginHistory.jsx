    import { useState, useEffect } from "react";
    import api from "../api";
    import Loading from "./Loading";

    const pretty = (s) => {
    const t = String(s ?? "").replace(/_/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
    };

    // "Mozilla/5.0 (iPhone; ...) ..." -> "Safari on iOS"
    const device = (ua) => {
    const s = String(ua || "");
    if (!s) return "Unknown device";
    const browser = /Edg\//.test(s) ? "Edge"
        : /OPR\//.test(s) ? "Opera"
        : /Chrome\//.test(s) ? "Chrome"
        : /Firefox\//.test(s) ? "Firefox"
        : /Safari\//.test(s) ? "Safari"
        : "Browser";
    // order matters: Android and iPhone user agents also mention Linux / Mac OS X
    const os = /Android/.test(s) ? "Android"
        : /iPhone|iPad|iPod/.test(s) ? "iOS"
        : /Windows/.test(s) ? "Windows"
        : /Mac OS X/.test(s) ? "macOS"
        : /Linux/.test(s) ? "Linux"
        : "";
    return os ? `${browser} on ${os}` : browser;
    };

    const csvCell = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    function LoginHistory() {
    const [logins, setLogins] = useState([]);
    const [summary, setSummary] = useState({ success_24h: 0, failed_24h: 0 });
    const [result, setResult] = useState("");   // "" = all, "success", "failed"
    const [search, setSearch] = useState("");
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);

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
            const res = await api.get("/admin/login-history", {
            params: { limit: 300, result: result || undefined, q: query || undefined },
            });
            if (cancelled) return;
            setLogins(res.data.logins);
            setSummary(res.data.summary);
        } catch (err) {
            if (!cancelled) setError(err.response?.data?.message || "Could not load the login history.");
        } finally {
            if (!cancelled) setLoading(false);
        }
        })();
        return () => {
        cancelled = true;
        };
    }, [result, query, reloadKey]);

    const downloadCsv = () => {
        const head = ["When", "Name", "Role", "Email", "Result", "Reason", "IP address", "Device"]
        .map(csvCell).join(",");
        const body = logins.map((l) => [
        l.created_at, l.full_name, l.role, l.email,
        l.success ? "Successful" : "Failed", l.reason ? pretty(l.reason) : "",
        l.ip_address, device(l.user_agent),
        ].map(csvCell).join(",")).join("\n");
        const blob = new Blob(["\ufeff" + head + "\n" + body], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `login-history-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="panel">
        <div className="toolbar">
            <label htmlFor="login-result" className="muted">Result</label>
            <select
            id="login-result"
            className="in sel"
            style={{ width: 180 }}
            value={result}
            onChange={(e) => setResult(e.target.value)}
            >
            <option value="">All attempts</option>
            <option value="success">Successful only</option>
            <option value="failed">Failed only</option>
            </select>

            <input
            type="search"
            className="in"
            style={{ width: 240 }}
            placeholder="Search name, email or IP"
            aria-label="Search login history"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            />

            <button type="button" className="btn sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
            </button>
            <button type="button" className="btn sm" onClick={downloadCsv} disabled={logins.length === 0}>
            Download CSV
            </button>

            <span className="muted" style={{ marginLeft: "auto" }}>
            Last 24 hours: {summary.success_24h} successful, {summary.failed_24h} failed
            </span>
        </div>

        {error && <div className="empty" role="alert">{error}</div>}

        {!error && loading && logins.length === 0 ? (
            <div className="empty"><Loading label="Loading login history..." /></div>
        ) : !error && logins.length === 0 ? (
            <div className="empty">
            {result || query
                ? "No sign-in attempts match your filters."
                : "No sign-ins recorded yet. New logins will appear here."}
            </div>
        ) : (
            !error && (
            <div className="tw">
                <table>
                <thead>
                    <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Result</th>
                    <th>IP address</th>
                    <th>Device</th>
                    </tr>
                </thead>
                <tbody>
                    {logins.map((l) => (
                    <tr key={l.login_id}>
                        <td className="num">{l.created_at}</td>
                        <td>
                        {l.full_name || <span className="muted">Not a known account</span>}
                        {l.role && <span className="muted"> ({pretty(l.role)})</span>}
                        <div className="muted">{l.email}</div>
                        </td>
                        <td>
                        <span className={`st ${l.success ? "ok" : "crit"}`}>
                            {l.success ? "Successful" : "Failed"}
                        </span>
                        {!l.success && l.reason && <div className="muted">{pretty(l.reason)}</div>}
                        </td>
                        <td className="num">{l.ip_address || "-"}</td>
                        <td>{device(l.user_agent)}</td>
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

    export default LoginHistory;