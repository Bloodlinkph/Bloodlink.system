    import { useState, useEffect } from "react";
    import api from "../api";
    import FieldError from "./FieldError";
    import {
    validate, hasErrors, required, optional, when, fullName, email as emailRule, password as passwordRule,
    contact as contactRule, address as addressRule, lettersOnly, bankName, license, bloodType as bloodTypeRule,
    focusFirstError,
    } from "../validation";

    const gtxt = (g) => String(g || "").replace("-", "\u2212");

    // Add / edit user dialog for the admin "Manage users" screen.
    const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
    const EMPTY_USER = {
    role: "member", full_name: "", email: "", password: "", contact_number: "",
    address: "", barangay: "", city: "",
    blood_type: "", requester_type: "individual", affiliated_hospital: "",
    bank_name: "", license_number: "", operating_hours: "",
    permission_level: "staff",
    };

    // mode "add": creates an account. mode "edit": updates one (role and blood type stay fixed).
    export default function UserFormModal({ mode, initial, onClose, onSaved }) {
    const [f, setF] = useState({ ...EMPTY_USER, ...initial });
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState(""); // server problems only (e.g. email already in use)
    const [errors, setErrors] = useState({});
    const editing = mode === "edit";
    // the red message goes away as soon as the person edits that field
    const set = (k) => (e) => {
        const value = e.target.value;
        setF((p) => ({ ...p, [k]: value }));
        setErrors((p) => (p[k] ? { ...p, [k]: "" } : p));
    };

    const rules = {
        full_name: [required("Full name"), fullName("Full name")],
        email: [required("Email"), emailRule],
        contact_number: [required("Contact number"), contactRule],
        // new accounts need a password; when editing it is optional but must still be valid if typed
        password: [when(() => !editing, required("Password")), optional(passwordRule)],
        address: [optional(addressRule("Address"))],
        barangay: [optional(lettersOnly("Barangay"))],
        city: [optional(lettersOnly("City"))],
        blood_type: [when((all) => all.role === "member" && !editing, required("Blood type")), bloodTypeRule],
        affiliated_hospital: [when((all) => all.role === "member", optional(lettersOnly("Affiliated hospital")))],
        bank_name: [when((all) => all.role === "blood_bank", required("Blood bank name")), when((all) => all.role === "blood_bank", bankName)],
        license_number: [when((all) => all.role === "blood_bank", optional(license))],
    };

    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && !saving && onClose();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [saving, onClose]);

    const submit = async (e) => {
        e.preventDefault();
        setErr("");
        const found = validate(f, rules);
        setErrors(found);
        if (hasErrors(found)) {
        focusFirstError(e.currentTarget);
        return;
        }
        setSaving(true);
        try {
        const body = {
            full_name: f.full_name, email: f.email, contact_number: f.contact_number,
            address: f.address, barangay: f.barangay, city: f.city,
        };
        if (f.role === "member") {
            body.requester_type = f.requester_type;
            body.affiliated_hospital = f.affiliated_hospital;
        } else if (f.role === "blood_bank") {
            body.bank_name = f.bank_name;
            body.license_number = f.license_number;
            body.operating_hours = f.operating_hours;
        }
        if (editing) {
            if (f.password) body.new_password = f.password; // optional password reset
            await api.put(`/admin/users/${initial.user_id}`, body);
        } else {
            body.role = f.role;
            body.password = f.password;
            if (f.role === "member") body.blood_type = f.blood_type;
            if (f.role === "admin") body.permission_level = f.permission_level;
            await api.post("/admin/users", body);
        }
        onSaved(editing ? "User updated." : "User created.");
        } catch (ex) {
        setErr(ex.response?.data?.message || "Could not save the user.");
        setSaving(false);
        }
    };

    return (
        <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
        <form className="dialog" style={{ maxWidth: 640 }} onSubmit={submit} role="dialog" aria-modal="true" noValidate>
            <div className="dialog-h">
            <h2>{editing ? "Edit user" : "Add user"}</h2>
            <button type="button" className="x" onClick={onClose} aria-label="Close" disabled={saving}>×</button>
            </div>

            <div className="dialog-b">
            {err && <div className="msg err" style={{ margin: 0 }}>{err}</div>}

            <div className="form-grid">
                <div className="field">
                <label htmlFor="uf-role">Role</label>
                <select id="uf-role" className="in" value={f.role} onChange={set("role")} disabled={editing}>
                    <option value="member">Member (donor / requester)</option>
                    <option value="blood_bank">Blood bank</option>
                    <option value="admin">Admin</option>
                </select>
                </div>
                <div className="field">
                <label htmlFor="uf-name">Full name</label>
                <input id="uf-name" className="in" value={f.full_name} onChange={set("full_name")} aria-invalid={!!errors.full_name} aria-describedby="err-uf-name" />
                <FieldError id="err-uf-name" message={errors.full_name} />
                </div>
                <div className="field">
                <label htmlFor="uf-email">Email</label>
                <input id="uf-email" type="email" className="in" value={f.email} onChange={set("email")} aria-invalid={!!errors.email} aria-describedby="err-uf-email" />
                <FieldError id="err-uf-email" message={errors.email} />
                </div>
                <div className="field">
                <label htmlFor="uf-contact">Contact number</label>
                <input id="uf-contact" className="in" placeholder="09171234567" value={f.contact_number} onChange={set("contact_number")} aria-invalid={!!errors.contact_number} aria-describedby="err-uf-contact" />
                <FieldError id="err-uf-contact" message={errors.contact_number} />
                </div>
                <div className="field full">
                <label htmlFor="uf-pass">{editing ? "New password (leave blank to keep the current one)" : "Password"}</label>
                <input id="uf-pass" type="password" className="in" autoComplete="new-password"
                        value={f.password} onChange={set("password")} aria-invalid={!!errors.password} aria-describedby="err-uf-pass" />
                <FieldError id="err-uf-pass" message={errors.password} />
                {!errors.password && <span className="hint">At least 8 characters, with a letter and a number.</span>}
                </div>
                <div className="field full">
                <label htmlFor="uf-addr">Address</label>
                <input id="uf-addr" className="in" value={f.address || ""} onChange={set("address")} aria-invalid={!!errors.address} aria-describedby="err-uf-addr" />
                <FieldError id="err-uf-addr" message={errors.address} />
                </div>
                <div className="field">
                <label htmlFor="uf-brgy">Barangay</label>
                <input id="uf-brgy" className="in" value={f.barangay || ""} onChange={set("barangay")} aria-invalid={!!errors.barangay} aria-describedby="err-uf-brgy" />
                <FieldError id="err-uf-brgy" message={errors.barangay} />
                </div>
                <div className="field">
                <label htmlFor="uf-city">City</label>
                <input id="uf-city" className="in" value={f.city || ""} onChange={set("city")} aria-invalid={!!errors.city} aria-describedby="err-uf-city" />
                <FieldError id="err-uf-city" message={errors.city} />
                </div>

                {f.role === "member" && (
                <>
                    <div className="field">
                    <label htmlFor="uf-bt">Blood type</label>
                    <select id="uf-bt" className="in" value={f.blood_type || ""} onChange={set("blood_type")}
                            aria-invalid={!!errors.blood_type} aria-describedby="err-uf-bt" disabled={editing}>
                        <option value="">Select...</option>
                        {BLOOD_TYPES.map((b) => <option key={b} value={b}>{gtxt(b)}</option>)}
                    </select>
                    <FieldError id="err-uf-bt" message={errors.blood_type} />
                    {editing && <span className="hint">Blood type can't be changed here.</span>}
                    </div>
                    <div className="field">
                    <label htmlFor="uf-rt">Requester type</label>
                    <select id="uf-rt" className="in" value={f.requester_type} onChange={set("requester_type")}>
                        <option value="individual">Individual</option>
                        <option value="family_member">Family member</option>
                        <option value="hospital">Hospital</option>
                    </select>
                    </div>
                    <div className="field full">
                    <label htmlFor="uf-hosp">Affiliated hospital (optional)</label>
                    <input id="uf-hosp" className="in" value={f.affiliated_hospital || ""} onChange={set("affiliated_hospital")} aria-invalid={!!errors.affiliated_hospital} aria-describedby="err-uf-hosp" />
                    <FieldError id="err-uf-hosp" message={errors.affiliated_hospital} />
                    </div>
                </>
                )}

                {f.role === "blood_bank" && (
                <>
                    <div className="field full">
                    <label htmlFor="uf-bank">Blood bank name</label>
                    <input id="uf-bank" className="in" value={f.bank_name || ""} onChange={set("bank_name")} aria-invalid={!!errors.bank_name} aria-describedby="err-uf-bank" />
                    <FieldError id="err-uf-bank" message={errors.bank_name} />
                    </div>
                    <div className="field">
                    <label htmlFor="uf-lic">License number</label>
                    <input id="uf-lic" className="in" value={f.license_number || ""} onChange={set("license_number")} aria-invalid={!!errors.license_number} aria-describedby="err-uf-lic" />
                    <FieldError id="err-uf-lic" message={errors.license_number} />
                    </div>
                    <div className="field">
                    <label htmlFor="uf-hrs">Operating hours</label>
                    <input id="uf-hrs" className="in" value={f.operating_hours || ""} onChange={set("operating_hours")} />
                    </div>
                    {!editing && <span className="hint full">New blood banks start as "pending" until you verify them in Blood bank verification.</span>}
                </>
                )}

                {f.role === "admin" && !editing && (
                <div className="field full">
                    <label htmlFor="uf-perm">Permission level</label>
                    <select id="uf-perm" className="in" value={f.permission_level} onChange={set("permission_level")}>
                    <option value="staff">Staff</option>
                    <option value="super_admin">Super admin</option>
                    </select>
                </div>
                )}
            </div>
            </div>

            <div className="dialog-f">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn pri" disabled={saving}>
                {saving ? "Saving..." : editing ? "Save changes" : "Add user"}
            </button>
            </div>
        </form>
        </div>
    );
    }