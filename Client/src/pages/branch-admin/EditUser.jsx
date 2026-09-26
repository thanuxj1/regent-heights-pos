import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaArrowLeft, FaCheck } from "react-icons/fa";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import Button from "../../components/admin/Button";
import FormField from "../../components/admin/FormField";
import FormSelect from "../../components/admin/FormSelect";
import PasswordField from "../../components/admin/PasswordField";
import profileImage from "../../assets/images/Ellipse 11.png";
import plusImage from "../../assets/images/Plus circle.png";
import {
    getBranches, getRoles, getUserById, updateUser,
    getCapabilityCatalog, getUserCapabilities, updateUserCapabilities,
} from "../../services/api";
import { staffRoles, isAdminRole } from "../../constants/roles";
import ToggleSwitch from "../../components/super-admin/ToggleSwitch";

const EditUser = () => {
    const { userId } = useParams();
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        firstName: "",
        lastName: "",
        email: "",
        contactNumber: "",
        role: "",
        branch: "",
        password: "",
        confirmPassword: "",
        image: null,        // base64 string or existing URL
    });
    const [roles, setRoles] = useState([]);
    const [branches, setBranches] = useState([]);
    const [isLoadingOptions, setIsLoadingOptions] = useState(true);
    const [isLoadingUser, setIsLoadingUser] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [showSuccessToast, setShowSuccessToast] = useState(false);
    const fileInputRef = useRef(null);

    // Permissions — independent of the main "Edit User Details" form. Only
    // meaningful for a non-admin user (Branch Admin/Owner already has
    // everything); saves immediately per toggle rather than waiting for the
    // page's Save Changes button.
    const [capabilityCatalog, setCapabilityCatalog] = useState([]);
    const [grantedCapabilities, setGrantedCapabilities] = useState(new Set());
    const [capLoading, setCapLoading] = useState(false);
    const [capError, setCapError] = useState("");
    const [savingCapKey, setSavingCapKey] = useState(null);
    const currentRoleId = formData.role ? Number(formData.role) : null;
    const showPermissions = !isLoadingUser && currentRoleId != null && !isAdminRole(currentRoleId);

    const accessibleRoles = useMemo(() => {
        return staffRoles(roles);
    }, [roles]);

    const resolvedUserId = useMemo(() => {
        return String(userId || "").trim();
    }, [userId]);

    const updateField = (field, value) => {
        if (!isEditMode) {
            return;
        }

        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    useEffect(() => {
        const loadPageData = async () => {
            try {
                setErrorMessage("");
                setIsLoadingOptions(true);
                setIsLoadingUser(true);

                if (!resolvedUserId) {
                    setErrorMessage("User id is missing. Open this page from User Management.");
                    return;
                }

                const [rolesData, branchesData, userData] = await Promise.all([
                    getRoles(),
                    getBranches(),
                    getUserById(resolvedUserId),
                ]);

                setRoles(rolesData || []);
                setBranches(branchesData || []);

                const allowedRoles = staffRoles(rolesData || []);

                const userRoleId = userData?.role_id ? String(userData.role_id) : "";
                if (userRoleId && !allowedRoles.some((role) => String(role.role_id) === userRoleId)) {
                    setErrorMessage("This user role is not available in branch admin.");
                    return;
                }

                const defaultBranchValue =
                    branchesData?.length > 0
                        ? String(branchesData[0].B_id ?? branchesData[0].b_id ?? "")
                        : "";

                setFormData({
                    firstName: userData?.u_fname || "",
                    lastName: userData?.u_lname || "",
                    email: userData?.u_email || "",
                    contactNumber: userData?.u_connumber || "",
                    role: userRoleId,
                    branch: defaultBranchValue,
                    password: "",
                    confirmPassword: "",
                    isActive: userData?.u_status !== false,
                    image: userData?.u_image || null,
                });
            } catch (error) {
                setErrorMessage(error?.response?.data?.message || "Failed to load user details");
            } finally {
                setIsLoadingOptions(false);
                setIsLoadingUser(false);
            }
        };

        loadPageData();
    }, [resolvedUserId]);

    useEffect(() => {
        if (!resolvedUserId || isLoadingUser || currentRoleId == null || isAdminRole(currentRoleId)) return;
        let cancelled = false;
        (async () => {
            try {
                setCapLoading(true);
                setCapError("");
                const [catalog, granted] = await Promise.all([
                    getCapabilityCatalog(),
                    getUserCapabilities(resolvedUserId),
                ]);
                if (cancelled) return;
                setCapabilityCatalog(catalog || []);
                setGrantedCapabilities(new Set(granted?.capabilities || []));
            } catch (error) {
                if (!cancelled) setCapError(error?.response?.data?.message || "Failed to load permissions");
            } finally {
                if (!cancelled) setCapLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resolvedUserId, isLoadingUser, currentRoleId]);

    const toggleCapability = async (key, nextValue) => {
        const next = new Set(grantedCapabilities);
        if (nextValue) next.add(key); else next.delete(key);
        setGrantedCapabilities(next); // optimistic
        setSavingCapKey(key);
        setCapError("");
        try {
            await updateUserCapabilities(resolvedUserId, [...next]);
        } catch (error) {
            setGrantedCapabilities(grantedCapabilities); // revert on failure
            setCapError(error?.response?.data?.message || "Failed to update permission");
        } finally {
            setSavingCapKey(null);
        }
    };

    const roleOptions = useMemo(() => {
        if (!accessibleRoles.length) {
            return [{ label: "No roles available", value: "" }];
        }

        return accessibleRoles.map((roleItem) => ({
            label: roleItem.role_name,
            value: String(roleItem.role_id),
        }));
    }, [accessibleRoles]);

    const branchOptions = useMemo(() => {
        if (!branches.length) {
            return [{ label: "No branches available", value: "" }];
        }

        return branches.map((branchItem) => ({
            label: branchItem.B_name ?? branchItem.b_name ?? "Branch",
            value: String(branchItem.B_id ?? branchItem.b_id ?? ""),
        }));
    }, [branches]);

    const submitUserUpdate = async () => {
        setErrorMessage("");

        if (!isEditMode) {
            return;
        }

        if (!resolvedUserId) {
            setErrorMessage("User id is missing. Open this page from User Management.");
            return;
        }

        if (!formData.firstName || !formData.lastName) {
            setErrorMessage("First name and last name are required");
            return;
        }

        if (formData.password && formData.password !== formData.confirmPassword) {
            setErrorMessage("Password and confirm password do not match");
            return;
        }

        if (!formData.role) {
            setErrorMessage("Please select a user role");
            return;
        }

        if (!accessibleRoles.some((role) => String(role.role_id) === String(formData.role))) {
            setErrorMessage("Please select a supported role");
            return;
        }

        try {
            setIsSubmitting(true);
            const payload = {
                u_fname: formData.firstName,
                u_lname: formData.lastName,
                u_connumber: formData.contactNumber || null,
                role_id: Number(formData.role),
            };
            payload.u_email = formData.email;
            payload.u_status = formData.isActive !== false;
            // Send image explicitly: null clears it in DB, a string saves it
            if (formData.image !== undefined) payload.u_image = formData.image ?? null;

            if (formData.password) {
                payload.u_pw = formData.password;
            }

            await updateUser(resolvedUserId, payload);

            setShowSuccessToast(true);
            setFormData((prev) => ({
                ...prev,
                password: "",
                confirmPassword: "",
            }));
            setIsEditMode(false);
        } catch (error) {
            setErrorMessage(error?.response?.data?.message || "Failed to update user");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        await submitUserUpdate();
    };

    const handlePrimaryAction = async () => {
        setErrorMessage("");

        if (!isEditMode) {
            setIsEditMode(true);
            return;
        }

        await submitUserUpdate();
    };

    const isFormLocked = isLoadingOptions || isLoadingUser || !isEditMode;

    const roleLabel = useMemo(() => {
        const match = roleOptions.find((r) => r.value === formData.role);
        return match ? match.label : "";
    }, [roleOptions, formData.role]);

    return (
        <div style={{ display: "flex", background: "#f0f3f9", minHeight: "100vh" }}>
            <Sidebar />

            <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)" }}>
                <Header title="User Management" />

                <div style={{ padding: "18px 24px 28px" }}>
                    {/* Back link */}
                    <div
                        style={{ display: "inline-flex", alignItems: "center", gap: "8px", color: "#6A6A6A", fontSize: "14px", fontWeight: "500", marginBottom: "18px", cursor: "pointer" }}
                        onClick={() => navigate("/branch-admin/users")}
                    >
                        <FaArrowLeft size={14} />
                        <span>Back to User Management</span>
                    </div>

                    <div style={{ maxWidth: "820px", margin: "0 auto" }}>
                        {/* Card — no overflow:hidden so avatar is never clipped */}
                        <div style={{ background: "#fff", borderRadius: "18px", boxShadow: "0 4px 24px rgba(30,50,100,0.09)" }}>

                            {/* Banner — rounded only on top */}
                            <div style={{
                                height: "120px",
                                background: "linear-gradient(120deg, #1565C0 0%, #42a5f5 100%)",
                                borderRadius: "18px 18px 0 0",
                            }} />

                            {/* Card Body Container */}
                            <div style={{ position: "relative", padding: "64px 32px 32px" }}>
                                
                                {/* Avatar circle - Absolutely positioned over the banner */}
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "-48px",
                                        left: "32px",
                                        width: "96px",
                                        height: "96px",
                                    }}
                                    onClick={() => isEditMode && fileInputRef.current?.click()}
                                    title={isEditMode ? "Click to change photo" : ""}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        style={{ display: "none" }}
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            const reader = new FileReader();
                                            reader.onload = (ev) => setFormData((prev) => ({ ...prev, image: ev.target.result }));
                                            reader.readAsDataURL(file);
                                        }}
                                    />
                                    {/* Photo */}
                                    <img
                                        src={formData.image || profileImage}
                                        alt="Profile"
                                        style={{
                                            width: "96px",
                                            height: "96px",
                                            borderRadius: "50%",
                                            objectFit: "cover",
                                            border: "4px solid #fff",
                                            boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
                                            display: "block",
                                            cursor: isEditMode ? "pointer" : "default",
                                            outline: isEditMode ? "2px dashed #1565C0" : "none",
                                            outlineOffset: "3px",
                                        }}
                                    />
                                    {/* + change icon */}
                                    {isEditMode && (
                                        <div style={{
                                            position: "absolute",
                                            bottom: "4px",
                                            right: "4px",
                                            width: "26px",
                                            height: "26px",
                                            borderRadius: "50%",
                                            background: "#fff",
                                            boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor: "pointer",
                                            pointerEvents: "none",
                                        }}>
                                            <img src={plusImage} alt="change" style={{ width: "22px", height: "22px" }} />
                                        </div>
                                    )}
                                    {/* Remove photo button */}
                                    {isEditMode && formData.image && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setFormData((p) => ({ ...p, image: null }));
                                                if (fileInputRef.current) fileInputRef.current.value = "";
                                            }}
                                            title="Remove photo"
                                            style={{
                                                position: "absolute",
                                                top: "2px",
                                                right: "2px",
                                                width: "22px",
                                                height: "22px",
                                                borderRadius: "50%",
                                                background: "#dc2626",
                                                color: "#fff",
                                                border: "2px solid #fff",
                                                cursor: "pointer",
                                                fontSize: "12px",
                                                fontWeight: "700",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                lineHeight: 1,
                                                boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
                                                padding: 0,
                                            }}
                                        >&#x00D7;</button>
                                    )}
                                </div>

                                {/* Header Row: Name/Role on left, Actions on right */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
                                    
                                    {/* Name + role badge */}
                                    <div>
                                        <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#1e2d4e", lineHeight: 1.2 }}>
                                            {(formData.firstName || formData.lastName)
                                                ? `${formData.firstName} ${formData.lastName}`.trim()
                                                : (isLoadingUser ? "Loading..." : "")}
                                        </h2>
                                        {roleLabel && (
                                            <span style={{ display: "inline-block", marginTop: "8px", padding: "4px 12px", borderRadius: "999px", background: "#e8f0fe", color: "#1565C0", fontSize: "12px", fontWeight: 700 }}>
                                                {roleLabel}
                                            </span>
                                        )}
                                    </div>

                                    {/* Action buttons */}
                                    <div style={{ display: "flex", gap: "10px" }}>
                                        {isEditMode && (
                                            <button
                                                type="button"
                                                onClick={() => { setIsEditMode(false); setErrorMessage(""); }}
                                                style={{ height: "38px", padding: "0 18px", borderRadius: "9px", border: "1px solid #d0d7e6", background: "#f5f7fa", color: "#555", fontWeight: 600, cursor: "pointer", fontSize: "14px" }}
                                            >
                                                Cancel
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={handlePrimaryAction}
                                            disabled={isSubmitting || isLoadingOptions || isLoadingUser || !resolvedUserId}
                                            style={{
                                                height: "38px",
                                                padding: "0 22px",
                                                borderRadius: "9px",
                                                border: "none",
                                                background: isEditMode ? "#1565C0" : "#50B748",
                                                color: "#fff",
                                                fontWeight: 700,
                                                cursor: (isSubmitting || isLoadingOptions || isLoadingUser) ? "not-allowed" : "pointer",
                                                opacity: (isSubmitting || isLoadingOptions || isLoadingUser) ? 0.7 : 1,
                                                fontSize: "14px",
                                                transition: "background 0.2s",
                                            }}
                                        >
                                            {!isEditMode ? "Edit User Details" : isSubmitting ? "Saving..." : "Save Changes"}
                                        </button>
                                    </div>
                                </div>

                                <div style={{ height: "1px", background: "#edf1f8", margin: "24px 0" }} />

                                {/* Form Body */}
                                {(isLoadingOptions || isLoadingUser) && (
                                    <p style={{ margin: 0, color: "#6b7a99", fontSize: "13px" }}>Loading user details...</p>
                                )}
                                {errorMessage && (
                                    <p style={{ margin: "0 0 16px", color: "#C62828", fontSize: "13px" }}>{errorMessage}</p>
                                )}

                                {/* VIEW MODE */}
                                {!isEditMode ? (
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                                        <InfoRow label="First Name" value={formData.firstName} />
                                        <InfoRow label="Last Name" value={formData.lastName} />
                                        <InfoRow label="Email" value={formData.email} />
                                        <InfoRow label="Contact Number" value={formData.contactNumber} />
                                        <InfoRow label="User Role" value={roleLabel} />
                                        <InfoRow label="Account" value={formData.isActive === false ? "Inactive — cannot sign in" : "Active"} />
                                    </div>
                                ) : (
                                    /* EDIT MODE */
                                    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                                        <div style={{ display: "flex", flexDirection: "column", gap: "18px", opacity: isFormLocked ? 0.82 : 1, pointerEvents: isFormLocked ? "none" : "auto" }}>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                                                <FormField label="First Name" value={formData.firstName} onChange={(e) => updateField("firstName", e.target.value)} />
                                                <FormField label="Last Name" value={formData.lastName} onChange={(e) => updateField("lastName", e.target.value)} />
                                            </div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                                                <FormField label="Email" type="email" value={formData.email} onChange={(e) => updateField("email", e.target.value)} />
                                                <FormField label="Contact Number" value={formData.contactNumber} onChange={(e) => updateField("contactNumber", e.target.value)} />
                                            </div>
                                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                                                <FormSelect label="User Role" value={formData.role} onChange={(e) => updateField("role", e.target.value)} options={roleOptions} />
                                                <label style={{ display: "flex", alignItems: "center", gap: "10px", alignSelf: "end", height: "44px", fontSize: "14px", color: "#334155", cursor: "pointer" }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={formData.isActive !== false}
                                                        onChange={(e) => updateField("isActive", e.target.checked)}
                                                        style={{ width: "18px", height: "18px" }}
                                                    />
                                                    Account is active (can sign in)
                                                </label>
                                            </div>
                                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                                <p style={{ margin: 0, fontSize: "12px", color: "#888" }}>Leave blank to keep the current password</p>
                                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                                                    <PasswordField label="New Password" value={formData.password} onChange={(e) => updateField("password", e.target.value)} />
                                                    <PasswordField label="Confirm Password" value={formData.confirmPassword} onChange={(e) => updateField("confirmPassword", e.target.value)} />
                                                </div>
                                            </div>
                                        </div>
                                    </form>
                                )}

                                {showPermissions && (
                                    <>
                                        <div style={{ height: "1px", background: "#edf1f8", margin: "24px 0" }} />
                                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "4px" }}>
                                            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#1e2d4e" }}>Permissions</h3>
                                            {capLoading && <span style={{ fontSize: "12px", color: "#94a3b8" }}>Loading…</span>}
                                        </div>
                                        <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#8a94ab" }}>
                                            Grant this account extra access beyond their role. Each toggle takes effect immediately.
                                        </p>
                                        {capError && <p style={{ margin: "0 0 14px", color: "#C62828", fontSize: "13px" }}>{capError}</p>}
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
                                            {capabilityCatalog.map((cap) => (
                                                <div key={cap.key} style={{
                                                    display: "flex", alignItems: "center", justifyContent: "space-between",
                                                    padding: "10px 14px", borderRadius: "10px", background: "#f8fafc",
                                                    border: cap.sensitive ? "1px solid #fde68a" : "1px solid transparent",
                                                }}>
                                                    <span style={{ fontSize: "13px", color: "#334155", display: "flex", alignItems: "center", gap: "8px" }}>
                                                        {cap.label}
                                                        {cap.sensitive && (
                                                            <span style={{
                                                                fontSize: "10px", fontWeight: 700, color: "#92400e",
                                                                background: "#fef3c7", padding: "2px 7px", borderRadius: "999px",
                                                                textTransform: "uppercase", letterSpacing: "0.4px",
                                                            }} title="Grants significant access — review before enabling">
                                                                Sensitive
                                                            </span>
                                                        )}
                                                    </span>
                                                    <ToggleSwitch
                                                        checked={grantedCapabilities.has(cap.key)}
                                                        disabled={savingCapKey === cap.key}
                                                        onChange={(next) => toggleCapability(cap.key, next)}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {showSuccessToast && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.18)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                    <div style={{ width: "min(92vw, 380px)", background: "#fff", borderRadius: "20px", padding: "32px 28px", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
                        <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "linear-gradient(135deg,#1565C0,#42a5f5)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <FaCheck size={28} color="#fff" />
                        </div>
                        <h2 style={{ margin: "0 0 6px", fontSize: "20px", fontWeight: 700, color: "#1e2d4e" }}>Changes Saved</h2>
                        <p style={{ margin: "0 0 22px", fontSize: "14px", color: "#6b7a99" }}>User details updated successfully.</p>
                        <button
                            onClick={() => { setShowSuccessToast(false); navigate("/branch-admin/users"); }}
                            style={{ width: "100%", height: "46px", border: "none", borderRadius: "12px", background: "linear-gradient(135deg,#1565C0,#42a5f5)", color: "#fff", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}
                        >
                            Back to Users
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const InfoRow = ({ label, value }) => (
    <div>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "#9aa5be", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "4px" }}>{label}</div>
        <div style={{ fontSize: "15px", color: value ? "#1e2d4e" : "#bcc5d6", fontWeight: value ? 500 : 400 }}>{value || "—"}</div>
    </div>
);

export default EditUser;
// EOF
