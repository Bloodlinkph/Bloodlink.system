    import { useEffect, useRef } from "react";
    import { createPortal } from "react-dom";
    import "./confirm.css";

    // Reusable "Are you sure?" dialog.
    //
    //   <ConfirmDialog
    //     open={!!pending}
    //     title="Decline this request?"
    //     message="They will be notified."
    //     confirmLabel="Yes, decline"
    //     onConfirm={() => { ...; setPending(null); }}
    //     onCancel={() => setPending(null)}
    //   />
    //
    // Optional children (for example an input) render between the message and the buttons.
    // Cancel is focused by default, so pressing Enter by accident never confirms.
    // Esc and clicking outside the box also cancel.
    function ConfirmDialog({
    open,
    title,
    message,
    children,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = true,
    onConfirm,
    onCancel,
    }) {
    const dialogRef = useRef(null);
    const cancelRef = useRef(null);
    const cancelFn = useRef(onCancel);
    cancelFn.current = onCancel; // always the latest, without re-running the effect below

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        cancelRef.current?.focus();

        const onKey = (e) => {
        if (e.key === "Escape") {
            cancelFn.current?.();
        } else if (e.key === "Tab" && dialogRef.current) {
            // keep keyboard focus inside the dialog
            const focusable = dialogRef.current.querySelectorAll("button, input, select, textarea");
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
            }
        }
        };
        document.addEventListener("keydown", onKey);

        return () => {
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = previousOverflow;
        previouslyFocused?.focus?.();
        };
    }, [open]);

    if (!open) return null;

    // rendered inside .db-page so the portal's accent colors still apply
    const target = document.querySelector(".db-page") || document.body;

    return createPortal(
        <div
        className="cf-backdrop"
        onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}
        >
        <div
            ref={dialogRef}
            className="cf-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cf-title"
            aria-describedby="cf-message"
        >
            <div className={`cf-icon ${danger ? "cf-icon-danger" : ""}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3.5l9.5 16.5h-19L12 3.5z" />
                <path d="M12 10v4M12 17.2v.1" />
            </svg>
            </div>
            <h2 id="cf-title" className="cf-title">{title}</h2>
            <p id="cf-message" className="cf-message">{message}</p>
            {children}
            <div className="cf-actions">
            <button ref={cancelRef} type="button" className="db-btn-outline" onClick={onCancel}>
                {cancelLabel}
            </button>
            <button
                type="button"
                className={danger ? "cf-confirm cf-confirm-danger" : "db-btn"}
                onClick={onConfirm}
            >
                {confirmLabel}
            </button>
            </div>
        </div>
        </div>,
        target
    );
    }

    export default ConfirmDialog;