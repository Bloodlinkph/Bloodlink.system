    // Small inline message shown directly under a field, e.g. "Email is required."
    // Pair it with aria-invalid on the input so the field itself also turns red:
    //   <input aria-invalid={!!errors.email} aria-describedby="err-email" ... />
    //   <FieldError id="err-email" message={errors.email} />
    export default function FieldError({ id, message }) {
    if (!message) return null;
    return (
        <span id={id} className="bl-field-error" role="alert">
        {message}
        </span>
    );
    }
