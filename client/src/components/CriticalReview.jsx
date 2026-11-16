    import { useState } from "react";
    import api from "../api";
    import ConfirmDialog from "./ConfirmDialog";
    import { formatUnits } from "./units";

    // SPRINT 2 FIX (NEW): where a verified blood bank or an admin confirms or rejects an emergency flag.
    // The server (PUT /requests/<id>/critical) already did this; no screen used it before.
    //
    //   <CriticalReview requests={requests} onReviewed={() => reload()} />
    //
    // Shows only requests that are still open AND have critical_status = "pending".
    // Only verified blood banks / admins can decide (the server enforces it and says why if not).
    const gtxt = (g) => String(g || "").replace("-", "−");

    function CriticalReview({ requests = [], onReviewed }) {
    const [ask, setAsk] = useState(null);       // { request, decision }
    const [busyId, setBusyId] = useState(null);
    const [msg, setMsg] = useState("");
    const [err, setErr] = useState("");

    const waiting = requests.filter(
        (r) => r.critical_status === "pending" && (r.status === "pending" || r.status === "matched")
    );

    const decide = async (r, decision) => {
        setAsk(null);
        setMsg("");
        setErr("");
        setBusyId(r.request_id);
        try {
        const res = await api.put(`/requests/${r.request_id}/critical`, { decision });
        setMsg(res.data?.message || "Done.");
        if (onReviewed) onReviewed();
        } catch (e) {
        setErr(e.response?.data?.message || "Could not save the decision.");
        if (e.response?.status === 409 && onReviewed) onReviewed(); // someone else already decided
        } finally {
        setBusyId(null);
        }
    };

    return (
        <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-h">
            <h3>
            Emergency requests awaiting confirmation
            <span className="sub">{waiting.length}</span>
            </h3>
        </div>

        {msg && <div className="msg ok">{msg}</div>}
        {err && <div className="msg err">{err}</div>}

        {waiting.length === 0 ? (
            <div className="empty">No emergency flags are waiting for a decision.</div>
        ) : (
            <div className="tw">
            <table>
                <thead>
                <tr>
                    <th>Ref</th>
                    <th>Requester</th>
                    <th>Group</th>
                    <th className="r">Units</th>
                    <th>Hospital</th>
                    <th>Reason given</th>
                    <th>Requested</th>
                    <th className="r">Decision</th>
                </tr>
                </thead>
                <tbody>
                {waiting.map((r) => (
                    <tr key={r.request_id}>
                    <td className="mono">#{r.request_id}</td>
                    <td className="wrap">{r.requester_name}</td>
                    <td><b className="grp">{gtxt(r.blood_type)}</b></td>
                    <td className="r num">{formatUnits(r.quantity_needed)}</td>
                    <td className="wrap">{r.hospital_name || "—"}</td>
                    <td className="wrap">{r.critical_reason || "—"}</td>
                    <td>{r.date_requested}</td>
                    <td className="r">
                        <span style={{ display: "inline-flex", gap: 6 }}>
                        <button type="button" className="btn pri sm" disabled={busyId === r.request_id}
                            onClick={() => setAsk({ request: r, decision: "confirm" })}>
                            Confirm critical
                        </button>
                        <button type="button" className="btn danger sm" disabled={busyId === r.request_id}
                            onClick={() => setAsk({ request: r, decision: "reject" })}>
                            Reject
                        </button>
                        </span>
                    </td>
                    </tr>
                ))}
                </tbody>
            </table>
            </div>
        )}

        <ConfirmDialog
            open={!!ask}
            danger={ask?.decision === "reject"}
            title={ask?.decision === "confirm" ? "Confirm this as critical?" : "Reject the critical flag?"}
            message={
            ask
                ? ask.decision === "confirm"
                ? `Request #${ask.request.request_id} becomes CRITICAL, the requester is told, and nearby eligible donors are alerted.`
                : `Request #${ask.request.request_id} stays open as High urgency and the requester is told. Repeated rejections pause their emergency flags.`
                : ""
            }
            confirmLabel={ask?.decision === "confirm" ? "Yes, confirm critical" : "Yes, reject"}
            cancelLabel="Go back"
            onCancel={() => setAsk(null)}
            onConfirm={() => decide(ask.request, ask.decision)}
        />
        </div>
    );
    }

    export default CriticalReview;
