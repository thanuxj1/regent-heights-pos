import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaArrowLeft, FaCheck } from "react-icons/fa";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import Button from "../../components/admin/Button";
import FormField from "../../components/admin/FormField";
import FormSelect from "../../components/admin/FormSelect";
import PasswordField from "../../components/admin/PasswordField";
import { readImageFile } from "../../utils/readImageFile";
import profileImage from "../../assets/images/Ellipse 11.png";
import plusImage from "../../assets/images/Plus circle.png";
import { createUser, getBranches, getRoles } from "../../services/api";
import { staffRoles } from "../../constants/roles";
import { Link } from "react-router-dom";

const AddUser = () => {
	const photoRef = useRef(null);

	const [formData, setFormData] = useState({
		firstName: "",
		lastName: "",
		email: "",
		contactNumber: "",
		role: "",
		branch: "",
		password: "",
		confirmPassword: "",
		image: "",
	});
	const [roles, setRoles] = useState([]);
	const [branches, setBranches] = useState([]);
	const [isLoadingOptions, setIsLoadingOptions] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");
	const [showSuccessToast, setShowSuccessToast] = useState(false);

	const accessibleRoles = useMemo(() => {
		return staffRoles(roles);
	}, [roles]);

	const updateField = (field, value) => {
		setFormData((prev) => ({ ...prev, [field]: value }));
	};

	useEffect(() => {
		const loadOptions = async () => {
			try {
				setIsLoadingOptions(true);
				const [rolesData, branchesData] = await Promise.all([getRoles(), getBranches()]);
				setRoles(rolesData || []);
				setBranches(branchesData || []);

				const allowedRoles = staffRoles(rolesData || []);

				setFormData((prev) => ({
					...prev,
					role:
						prev.role ||
						(allowedRoles?.length > 0 ? String(allowedRoles[0].role_id) : ""),
					branch:
						prev.branch ||
						(branchesData?.length > 0
							? String(branchesData[0].B_id ?? branchesData[0].b_id ?? "")
							: ""),
				}));
			} catch (error) {
				setErrorMessage(error?.response?.data?.message || "Failed to load roles and branches");
			} finally {
				setIsLoadingOptions(false);
			}
		};

		loadOptions();
	}, []);

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

	const handleSubmit = async (event) => {
		event.preventDefault();
		setErrorMessage("");

		if (!formData.firstName || !formData.lastName || !formData.email || !formData.password) {
			setErrorMessage("First name, last name, email and password are required");
			return;
		}

		if (formData.password !== formData.confirmPassword) {
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
			await createUser({
				u_fname: formData.firstName,
				u_lname: formData.lastName,
				u_email: formData.email,
				u_pw: formData.password,
				u_connumber: formData.contactNumber || null,
				role_id: Number(formData.role),
				u_image: formData.image || null,
			});

			setShowSuccessToast(true);
			setFormData((prev) => ({
				...prev,
				firstName: "",
				lastName: "",
				email: "",
				image: "",
				contactNumber: "",
				password: "",
				confirmPassword: "",
			}));
		} catch (error) {
			setErrorMessage(error?.response?.data?.message || "Failed to create user");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div style={{ display: "flex", background: "#EEEEEE", minHeight: "100vh" }}>
			<Sidebar />

			<div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)" }}>
				<Header title="User Management" />

				<div style={{ padding: "18px 24px 28px" }}>
					<Link to="/branch-admin/users" style={{ textDecoration: "none" }}>
						<div
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: "8px",
								color: "#6A6A6A",
								fontSize: "14px",
								fontWeight: "500",
								marginBottom: "14px",
								cursor: "pointer",
							}}
						>
							<FaArrowLeft size={14} />
							<span>Back to User Management</span>
						</div>
					</Link>
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
							<div style={{ position: "relative", padding: "64px 32px 32px", opacity: isLoadingOptions ? 0.82 : 1, pointerEvents: isLoadingOptions ? "none" : "auto" }}>
								
								{/* Avatar circle - Absolutely positioned over the banner */}
								<div
									style={{
										position: "absolute",
										top: "-48px",
										left: "32px",
										width: "96px",
										height: "96px",
									}}
									onClick={() => photoRef.current?.click()}
									title={formData.image ? "Change photo" : "Add a photo"}
								>
									<input
										ref={photoRef}
										type="file"
										accept="image/*"
										style={{ display: "none" }}
										onChange={async (e) => {
											const file = e.target.files?.[0];
											e.target.value = "";
											if (!file) return;
											try { updateField("image", await readImageFile(file, { maxWidth: 512 })); }
											catch (err) { window.alert(err.message); }
										}}
									/>
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
											cursor: "pointer",
										}}
									/>
									{/* + change icon */}
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
									{/* Remove photo button */}
									{formData.image && (
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												updateField("image", "");
												if (photoRef.current) photoRef.current.value = "";
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
											}}
										>×</button>
									)}
								</div>

								{/* Header row with Name and Save button */}
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "32px" }}>
									<div>
										<h2 style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "800", color: "#0F172A", letterSpacing: "-0.02em" }}>
											Add New User
										</h2>
										<div style={{ fontSize: "14px", color: "#64748B", fontWeight: "500" }}>
											Create a staff login and set what they can reach
										</div>
									</div>
								</div>

								<form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
										<FormField label="First Name" value={formData.firstName} onChange={(event) => updateField("firstName", event.target.value)} />
										<FormField label="Last Name" value={formData.lastName} onChange={(event) => updateField("lastName", event.target.value)} />
									</div>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
										<FormField label="Email" type="email" value={formData.email} onChange={(event) => updateField("email", event.target.value)} />
										<FormField label="Contact Number" value={formData.contactNumber} onChange={(event) => updateField("contactNumber", event.target.value)} />
									</div>
									<div style={{ display: "grid", gridTemplateColumns: branchOptions.length > 1 ? "1fr 1fr" : "1fr", gap: "20px", alignItems: "start" }}>
										<FormSelect label="User Role" value={formData.role} onChange={(event) => updateField("role", event.target.value)} options={roleOptions} />
										{branchOptions.length > 1 && (
											<FormSelect label="Assigned Branch" value={formData.branch} onChange={(event) => updateField("branch", event.target.value)} options={branchOptions} />
										)}
									</div>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
										<PasswordField label="Password" value={formData.password} onChange={(event) => updateField("password", event.target.value)} />
										<PasswordField label="Confirm Password" value={formData.confirmPassword} onChange={(event) => updateField("confirmPassword", event.target.value)} />
									</div>

									{isLoadingOptions && <p style={{ margin: 0, color: "#5E5E5E", fontSize: "13px" }}>Loading roles and branches...</p>}
									{errorMessage && <p style={{ margin: 0, color: "#C62828", fontSize: "13px" }}>{errorMessage}</p>}

									<div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px", borderTop: "1px solid #F1F5F9", paddingTop: "24px" }}>
										<Button label={isSubmitting ? "Creating..." : "Create User Account"} type="submit" disabled={isSubmitting || isLoadingOptions}
											style={{ width: "200px", height: "42px", borderRadius: "10px", fontSize: "14px", fontWeight: "600", background: "#1565C0" }}
										/>
									</div>
								</form>
							</div>
						</div>
					</div>
				</div>
			</div>

			{showSuccessToast && (
				<div
					style={{
						position: "fixed",
						inset: 0,
						background: "rgba(0,0,0,0.12)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						zIndex: 9999,
					}}
				>
					<div
						style={{
							width: "min(92vw, 430px)",
							height: "min(70vw, 350px)",
							background: "#EBEBEB",
							borderRadius: "22px",
							padding: "14px 20px 14px",
							textAlign: "center",
							display: "flex",
							flexDirection: "column",
							justifyContent: "center",
						}}
					>
						<div
							style={{
								width: "62px",
								height: "62px",
								borderRadius: "50%",
								background: "#0E5BA8",
								margin: "0 auto 10px",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<FaCheck size={30} color="#fff" />
						</div>

						<h2
							style={{
								margin: "0",
								fontSize: "18px",
								lineHeight: 1.2,
								fontWeight: "600",
								color: "#0E5BA8",
							}}
						>
							New User has been
							<br />
							Added
							<br />
							Successfully
						</h2>

						<button
							onClick={() => setShowSuccessToast(false)}
							style={{
								marginTop: "16px",
								width: "100%",
								height: "52px",
								border: "none",
								borderRadius: "12px",
								background: "#0E5BA8",
								color: "#fff",
								fontSize: "15px",
								fontWeight: "500",
								cursor: "pointer",
							}}
						>
							Countinue
						</button>
					</div>
				</div>
			)}
		</div>
	);
};

export default AddUser;
