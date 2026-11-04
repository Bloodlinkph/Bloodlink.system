    import { useEffect, useState } from "react";
    import api from "../api";

    export default function DonorPostReview() {
    const [posts, setPosts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [busyId, setBusyId] = useState(null);

    const load = async () => {
        setLoading(true); setError("");
        try { const res = await api.get("/admin/donor-posts"); setPosts(res.data); }
        catch (e) { setError(e.response?.data?.message || "Could not load donation posts awaiting review."); }
        finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const review = async (post, decision) => {
        let rejection_reason = "";
        if (decision === "rejected") {
        rejection_reason = window.prompt("Reason for rejecting this post (required):", "") || "";
        if (!rejection_reason.trim()) return;
        }
        setBusyId(post.post_id); setError(""); setMessage("");
        try {
        const res = await api.put(`/admin/donor-posts/${post.post_id}/review`, { decision, rejection_reason });
        setMessage(res.data.message || `Post ${decision}.`); await load();
        } catch (e) { setError(e.response?.data?.message || "Could not review this post."); }
        finally { setBusyId(null); }
    };

    return <section className="panel">
        <div className="panel-h"><h3>Donation posts awaiting approval <span className="sub">{posts.length}</span></h3><button className="btn" type="button" onClick={load} disabled={loading}>Refresh</button></div>
        {message && <div className="msg ok">{message}</div>}{error && <div className="msg err">{error}</div>}
        {loading ? <div className="empty">Loading posts…</div> : posts.length === 0 ? <div className="empty">There are no donation posts waiting for review.</div> : <div className="tw"><table><thead><tr><th>Donor</th><th>Blood type</th><th>Location</th><th>Available until</th><th>Note</th><th>Actions</th></tr></thead><tbody>
        {posts.map(p => <tr key={p.post_id}><td>{p.donor_name}</td><td>{p.blood_type}</td><td>{[p.barangay,p.city].filter(Boolean).join(", ") || "Not provided"}</td><td>{p.available_until}</td><td>{p.note || "—"}</td><td><div className="actions"><button className="btn pri sm" type="button" disabled={busyId===p.post_id} onClick={()=>review(p,"approved")}>Approve</button><button className="btn danger sm" type="button" disabled={busyId===p.post_id} onClick={()=>review(p,"rejected")}>Reject</button></div></td></tr>)}
        </tbody></table></div>}
        <p className="muted">Approve only after reviewing the post. This review does not replace medical screening or final donor eligibility checks.</p>
    </section>;
    }
