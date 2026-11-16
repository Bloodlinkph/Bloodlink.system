    import { useEffect } from "react";
    import { createPortal } from "react-dom";
    import "./successPopup.css";

    // Small "saved" notification that matches the portal's message style.
    // Slides in at the top-right (under the header), closes by itself or with the x.
    //
    //   <SuccessPopup
    //     open={!!popup}
    //     title="Profile updated!"
    //     message="Your changes were saved."
    //     onClose={() => setPopup(null)}
    //   />
    function SuccessPopup({ open, title = "Profile updated!", message = "", onClose, autoCloseMs = 4000 }) {
    useEffect(() => {
        if (!open) return;
        const timer = setTimeout(() => onClose?.(), autoCloseMs);
        return () => clearTimeout(timer);
    }, [open, title, message, autoCloseMs, onClose]);

    if (!open) return null;

    return createPortal(
        <div className="sn-toast" role="status" aria-live="polite">
        <span className="sn-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
        </span>
        <div className="sn-text">
            <strong className="sn-title">{title}</strong>
            {message && <span className="sn-message">{message}</span>}
        </div>
        <button type="button" className="sn-close" onClick={onClose} aria-label="Close">×</button>
        </div>,
        document.body
    );
    }

    export default SuccessPopup;