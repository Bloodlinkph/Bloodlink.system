    // Shared form validation for BloodLink.
    // Rules mirror server/bloodlink.py so the messages shown under a field match what the server would reject.
    //
    // Usage:
    //   const errs = validate(values, { email: [required("Email"), email], ... });
    //   setErrors(errs);                 // { email: "Email is required." }
    //   if (hasErrors(errs)) return;     // stop, nothing is sent to the server
    //
    // Each rule is a function (value, allValues) => string | "" . Rules run in order and the first message wins.

    const NAME_RE = /^[A-Za-z\u00D1\u00F1\s-]+$/;
    const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    const CONTACT_RE = /^(09\d{9}|\+639\d{9})$/;
    const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    const ADDRESS_RE = /^[A-Za-z0-9\u00D1\u00F1\u00C1\u00E1\u00C9\u00E9\u00CD\u00ED\u00D3\u00F3\u00DA\u00FA.,#\-\s]+$/;
    const BANK_NAME_RE = /^[A-Za-z0-9\u00D1\u00F1.\s-]+$/;
    const LICENSE_RE = /^[A-Za-z0-9-]+$/;
    const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

    const str = (v) => String(v ?? "").trim();
    const blank = (v) => str(v) === "";

    // ----- rules -----
    export const required = (label = "This field") => (v) => (blank(v) ? `${label} is required.` : "");

    // applies a rule only when the field has something in it (for optional fields)
    export const optional = (rule) => (v, all) => (blank(v) ? "" : rule(v, all));

    // applies a rule only when a condition on the whole form is true
    export const when = (cond, rule) => (v, all) => (cond(all) ? rule(v, all) : "");

    export const fullName = (label = "Full name") => (v) =>
    !blank(v) && !NAME_RE.test(str(v)) ? `${label} can contain letters, spaces and dash only.` : "";
    export const lettersOnly = (label) => (v) =>
    !blank(v) && !NAME_RE.test(str(v)) ? `${label} can contain letters, spaces and dash only.` : "";
    export const email = (v) => (!blank(v) && !EMAIL_RE.test(str(v)) ? "Enter a valid email address." : "");
    export const contact = (v) =>
    !blank(v) && !CONTACT_RE.test(str(v)) ? "Enter a valid PH mobile number (e.g. 09171234567)." : "";
    export const password = (v) =>
    !blank(v) && !PASSWORD_RE.test(String(v)) ? "Use at least 8 characters with a letter and a number." : "";
    export const address = (label = "Address") => (v) =>
    !blank(v) && !ADDRESS_RE.test(str(v)) ? `${label} has invalid characters.` : "";
    export const bankName = (v) =>
    !blank(v) && !BANK_NAME_RE.test(str(v)) ? "Blood bank name has invalid characters." : "";
    export const license = (v) =>
    !blank(v) && !LICENSE_RE.test(str(v)) ? "License number can contain letters, numbers and dash only." : "";
    export const bloodType = (v) => (!blank(v) && !BLOOD_TYPES.includes(str(v)) ? "Choose a valid blood type." : "");
    export const minLen = (n, label = "This field") => (v) =>
    !blank(v) && str(v).length < n ? `${label} must be at least ${n} characters.` : "";
    export const maxLen = (n, label = "This field") => (v) =>
    str(v).length > n ? `${label} must be ${n} characters or fewer.` : "";
    export const matches = (otherKey, msg = "The two values don't match.") => (v, all) =>
    v !== all[otherKey] ? msg : "";

    // half-unit steps: 0.5, 1, 1.5 ... (same rule as units.js / the server)
    export const units = (label = "Units") => (v) => {
    if (blank(v)) return "";
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return `${label} must be greater than 0.`;
    if (!Number.isInteger(n * 2)) return `${label} must be in half-unit steps (0.5, 1, 1.5, ...).`;
    return "";
    };
    // same, but 0 is allowed (inventory counts)
    export const unitsOrZero = (label = "Units") => (v) => {
    if (blank(v)) return "";
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return `${label} can't be negative.`;
    if (!Number.isInteger(n * 2)) return `${label} must be in half-unit steps (0.5, 1, 1.5, ...).`;
    return "";
    };
    export const numberBetween = (min, max, label = "Value") => (v) => {
    if (blank(v)) return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return `${label} must be a number.`;
    if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
    return "";
    };
    export const notBefore = (min, label = "Date") => (v) =>
    !blank(v) && str(v) < min ? `${label} can't be in the past.` : "";
    export const notAfter = (max, label = "Date") => (v) =>
    !blank(v) && str(v) > max ? `${label} is too far ahead.` : "";
    export const notFuture = (label = "Date") => (v) => {
    if (blank(v)) return "";
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return str(v).slice(0, 10) > today ? `${label} can't be in the future.` : "";
    };
    // must be at least `years` old
    export const minAge = (years, label = "You") => (v) => {
    if (blank(v)) return "";
    const b = new Date(`${str(v).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(b.getTime())) return "Enter a valid date.";
    const now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
    return age < years ? `${label} must be at least ${years} years old.` : "";
    };
    export const oneOf = (list, msg = "Choose one of the options.") => (v) =>
    !blank(v) && !list.includes(str(v)) ? msg : "";

    // ----- runner -----
    // rules: { fieldName: [rule, rule, ...] } -> { fieldName: "message" } (only fields that failed)
    export function validate(values, rules) {
    const out = {};
    Object.keys(rules).forEach((key) => {
        const list = Array.isArray(rules[key]) ? rules[key] : [rules[key]];
        for (const rule of list) {
        const msg = rule(values[key], values);
        if (msg) {
            out[key] = msg;
            break;
        }
        }
    });
    return out;
    }

    export const hasErrors = (errs) => Object.keys(errs).length > 0;

    // Keeps the form's error state in one place: returns helpers that re-check a single field as the user edits it.
    //   const v = fieldChecker(rules);   v.check("email", value, allValues) -> "" | message
    export const checkField = (rules, key, values) => {
    const list = Array.isArray(rules[key]) ? rules[key] : rules[key] ? [rules[key]] : [];
    for (const rule of list) {
        const msg = rule(values[key], values);
        if (msg) return msg;
    }
    return "";
    };

    // Move keyboard focus to the first field with an error (call after setErrors, inside the submit handler).
    export const focusFirstError = (formEl) => {
    const el = formEl?.querySelector?.('[aria-invalid="true"]');
    if (el && typeof el.focus === "function") el.focus();
    };

    // date of birth can't be more than `years` ago (server rejects > 120)
    export const maxAge = (years, label = "Date of birth") => (v) => {
    if (blank(v)) return "";
    const b = new Date(`${str(v).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(b.getTime())) return "Enter a valid date.";
    const limit = new Date();
    limit.setFullYear(limit.getFullYear() - years);
    return b < limit ? `${label} is not valid.` : "";
    };
