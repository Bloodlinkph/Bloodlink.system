    // One definition of "unit" for the whole app (must match bloodlink.py):
    //   1 unit = 1 bag = 450 mL of whole blood, counted in steps of 0.5.
    // Requests, inventory, donations and matching all use it.

    export const UNIT_ML = 450;
    export const UNIT_STEP = 0.5;

    export const UNIT_HINT = "1 unit = 1 bag (450 mL). Half units (0.5) are allowed.";

    // 1 -> "1", 1.5 -> "1.5", "2.0" -> "2", 0.89 -> "0.89"
    export const formatUnits = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? String(Number(v.toFixed(2))) : "—";
    };

    // 1 -> "1 unit", 0.5 -> "0.5 units", 1.5 -> "1.5 units"
    export const unitLabel = (n) => {
    const text = formatUnits(n);
    return text === "1" ? "1 unit" : `${text} units`;
    };

    // true for 0.5, 1, 1.5 ... (and 0 only when allowZero)
    export const isValidUnits = (value, { allowZero = false } = {}) => {
    if (value === "" || value === null || value === undefined) return false;
    const v = Number(value);
    if (!Number.isFinite(v) || v < 0) return false;
    if (v === 0 && !allowZero) return false;
    return Number.isInteger(v * 2);
    };

    export const UNIT_ERROR = "Units must be in half-unit steps (0.5, 1, 1.5, ...).";

    // +1.5 / −2 / 0  (signed change, for the audit log)
    export const formatChange = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v === 0) return "0";
    return `${v > 0 ? "+" : "−"}${formatUnits(Math.abs(v))}`;
    };