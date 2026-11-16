    import { useEffect, useState } from "react";
    import "./loading.css";

    export function Spinner({ size = "", label }) {
    return <span className={`bl-spin ${size}`} role="status" aria-label={label || "Loading"} />;
    }

    // true only once `active` has stayed true for `delay` ms, so fast loads never flash a spinner
    // eslint-disable-next-line react-refresh/only-export-components
    export function useSlow(active, delay = 400) {
    const [slow, setSlow] = useState(false);
    useEffect(() => {
        // state only changes inside timer callbacks, never synchronously in the effect
        const t = setTimeout(() => setSlow(active), active ? delay : 0);
        return () => clearTimeout(t);
    }, [active, delay]);
    return slow && active;
    }

    // Drop-in replacement for "Loading..." text. Mounted = loading, so it waits `delay` ms
    // and only then shows the spinner (nothing at all for fast loads).
    export default function Loading({ label = "Loading...", delay = 400 }) {
    const slow = useSlow(true, delay);
    if (!slow) return <span style={{ display: "inline-block", minHeight: 24 }} />;
    return (
        <span className="bl-loading">
        <Spinner />
        <span>{label}</span>
        </span>
    );
    }
