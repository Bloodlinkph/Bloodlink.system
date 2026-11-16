    import { useEffect, useState } from "react";
    import { useSlow, Spinner } from "./Loading";
    import "./loading.css";

    // Listens to api.js. If any (non-background) request is still running after ~0.8s,
    // a small "Please wait" pill appears at the top. Fast requests never show it.
    export default function GlobalLoading() {
    const [pending, setPending] = useState(0);
    useEffect(() => {
        const onChange = (e) => setPending(e.detail ?? 0);
        window.addEventListener("bloodlink:pending", onChange);
        return () => window.removeEventListener("bloodlink:pending", onChange);
    }, []);
    const slow = useSlow(pending > 0, 800);
    if (!slow) return null;
    return (
        <div className="bl-slow" role="status" aria-live="polite">
        <Spinner size="sm" />
        <span>This is taking a moment, please wait...</span>
        </div>
    );
    }
