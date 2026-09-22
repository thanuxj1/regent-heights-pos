import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaArrowLeft, FaUpload } from "react-icons/fa";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import { deleteProduct, getBranchProducts, getCategories, getProductById, updateProduct } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

const fieldLabel = { fontSize: 12, fontWeight: 600, color: "#64748B" };

const fieldInput = {
	display: "block",
	width: "100%",
	marginTop: 4,
	padding: "9px 12px",
	border: "1px solid #E2E8F0",
	borderRadius: 8,
	fontSize: 14,
	boxSizing: "border-box",
	background: "#fff",
	outline: "none",
};

// The same two choice cards the "Create New Product" form uses.
const stockChoiceStyle = (active) => ({
	textAlign: "left",
	padding: "12px 14px",
	borderRadius: 10,
	cursor: "pointer",
	border: active ? "1.5px solid #1565C0" : "1px solid #E2E8F0",
	background: active ? "#EFF6FF" : "#fff",
	fontFamily: "inherit",
});

const isImageSrc = (value) =>
	typeof value === "string" && (
		/^(https?:)?\/\//i.test(value.trim()) ||
		value.trim().startsWith("data:")
	);

const modalOverlayStyle = {
	position: "fixed",
	inset: 0,
	background: "rgba(0, 0, 0, 0.62)",
	display: "grid",
	placeItems: "center",
	zIndex: 50,
};

const modalCardStyle = {
	width: "380px",
	maxWidth: "calc(100vw - 32px)",
	background: "#FFFFFF",
	borderRadius: "10px",
	boxShadow: "0 18px 50px rgba(0, 0, 0, 0.30)",
};

const ProductDetails = () => {
	const { productId } = useParams();
	const location = useLocation();
	const navigate = useNavigate();
	const isEditPage = location.pathname.endsWith("/edit");
	const isDeletePage = location.pathname.endsWith("/delete");
	const fileInputRef = useRef(null);

	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);
	const [categories, setCategories] = useState([]);
	const [product, setProduct] = useState(null);
	const [branchQty, setBranchQty] = useState(null);
	const { user } = useAuth();

	const [form, setForm] = useState({
		pro_name: "",
		category: "General",
		pro_qty: "",
		pro_price: "",
		cost_price: "",
		pro_image: "",
		description: "",
		discount_pct: "0",
		tax_group: "0",
		track_inventory: true,
		low_stock: "10",
	});

	useEffect(() => {
		let mounted = true;
		const loadData = async () => {
			try {
				setLoading(true);
				setError("");
				const [productData, categoryData, branchRows] = await Promise.all([
					getProductById(productId),
					getCategories().catch(() => []),
					getBranchProducts(user?.b_id).catch(() => []),
				]);
				if (!mounted) return;

				setProduct(productData);
				const mine = (Array.isArray(branchRows) ? branchRows : []).filter((r) => Number(r.pro_id) === Number(productId));
				setBranchQty(mine.length ? mine.reduce((sum, r) => sum + Number(r.pro_quantity ?? r.pro_qty ?? 0), 0) : null);
				setCategories(Array.isArray(categoryData) ? categoryData : []);
				setForm({
					pro_name: productData?.pro_name || "",
					category: productData?.cat_name || categoryData.find(c => c.cat_id === productData?.cat_id)?.cat_name || "General",
					pro_qty: productData?.pro_qty == null ? "" : String(Number(productData.pro_qty)),
					pro_price: String(productData?.pro_price ?? ""),
					cost_price: String(productData?.cost_price ?? productData?.pro_price ?? ""),
					pro_image: productData?.pro_image || "",
					description: productData?.description || "",
					discount_pct: String(productData?.discount_pct ?? "0"),
					tax_group: String(productData?.tax_group ?? "0"),
					track_inventory: productData?.track_inventory !== undefined ? Boolean(productData.track_inventory) : true,
					low_stock: String(productData?.low_stock ?? "10"),
				});
			} catch (err) {
				if (mounted) setError(err?.response?.data?.message || "Failed to load product details");
			} finally {
				if (mounted) setLoading(false);
			}
		};
		loadData();
		return () => { mounted = false; };
	}, [productId]);

	const imagePreview = useMemo(() => {
		if (isImageSrc(form.pro_image)) {
			return (
				<img
					src={form.pro_image}
					alt={form.pro_name || "Product"}
					style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "8px" }}
				/>
			);
		}
		return <span style={{ fontSize: "22px" }}>🍔</span>;
	}, [form.pro_image, form.pro_name]);

	const handleFieldChange = (field) => (event) => {
		const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
		setForm((prev) => ({
			...prev,
			[field]: value,
		}));
	};

	const handleFileUpload = (e) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			setForm(prev => ({ ...prev, pro_image: ev.target.result }));
		};
		reader.readAsDataURL(file);
	};

	const handleSave = async () => {
		if (!productId) { setError("Missing product id"); return; }
		if (!form.pro_name.trim()) { setError("Enter a product name"); return; }
		if (form.pro_price === "" || !(Number(form.pro_price) >= 0)) { setError("Enter the selling price"); return; }
		if (form.track_inventory && (form.pro_qty === "" || !(Number(form.pro_qty) >= 0))) {
			setError("Enter how many are on the rack now");
			return;
		}
		if (!(Number(form.discount_pct || 0) >= 0 && Number(form.discount_pct || 0) <= 100)) {
			setError("Discount must be between 0 and 100");
			return;
		}

		try {
			setSaving(true);
			setError("");
			const selectedCategoryObj = categories.find((c) => c.cat_name === form.category);
			const cat_id = selectedCategoryObj ? selectedCategoryObj.cat_id : null;

			const updated = await updateProduct(productId, {
				pro_name: form.pro_name.trim(),
				// Nothing is counted, so nothing is stored: a leftover figure here would
		// be a number that means nothing the day the toggle goes back on.
		pro_qty: form.track_inventory ? Number(form.pro_qty) : 0,
				pro_price: Number(form.pro_price),
				cost_price: Number(form.cost_price) || 0,
				pro_image: form.pro_image.trim(),
				cat_id,
				description: form.description.trim() || null,
				discount_pct: Number(form.discount_pct) || 0,
				tax_group: Number(form.tax_group) || 0,
				low_stock: Number(form.low_stock) || 10,
				track_inventory: form.track_inventory,
			});
			setProduct(updated);
			setSuccess("Product updated successfully");
			setTimeout(() => setSuccess(""), 2200);
		} catch (err) {
			setError(err?.response?.data?.message || "Failed to update product");
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async () => {
		if (!productId) { setError("Missing product id"); return; }
		if (!isDeletePage) { navigate(`/branch-admin/products/${productId}/delete`); return; }
		if (!deleteAcknowledged) { setError("Please confirm the deletion acknowledgment first."); return; }
		try {
			setSaving(true);
			setError("");
			await deleteProduct(productId);
			navigate("/branch-admin/products");
		} catch (err) {
			setError(err?.response?.data?.message || "Failed to delete product");
		} finally {
			setSaving(false);
		}
	};

	const handleCancel = () => {
		if (isDeletePage) { navigate(`/branch-admin/products/${productId}/edit`); return; }
		navigate("/branch-admin/products");
	};

	const discountedPrice = useMemo(() => {
		const base = Number(form.pro_price) || 0;
		const disc = Number(form.discount_pct) || 0;
		if (disc <= 0) return null;
		return (base * (1 - disc / 100)).toFixed(2);
	}, [form.pro_price, form.discount_pct]);

	return (
		<div style={{ display: "flex", background: "#F3F4F6", minHeight: "100vh" }}>
			<Sidebar />
			<div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)" }}>
				<Header title="Product Management" role="Branch Admin" showAddUserIcon />
				<div style={{ padding: "18px 20px 32px", maxWidth: 680, margin: "0 auto" }}>
					<button
						type="button"
						onClick={() => navigate("/branch-admin/products")}
						style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "none", background: "transparent", color: "#6B7280", fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 10, padding: 0 }}
					>
						<FaArrowLeft />
						<span>Back to products</span>
					</button>

					{loading ? (
						<div style={{ color: "#475569", fontSize: 14 }}>Loading product details...</div>
					) : error && !product ? (
						<div style={{ color: "#B91C1C", fontSize: 14 }}>{error}</div>
					) : (
						<div style={{ background: "#fff", borderRadius: 16, padding: 26, boxShadow: "0 20px 60px rgba(0,0,0,0.06)", border: "1px solid #E9EEF5" }}>
							<h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0F172A" }}>Edit Product</h1>
							<div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 18 }}>Update global product details.</div>

							{error && (
								<div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
									{error}
								</div>
							)}

							<div style={{ display: "grid", gap: 14 }}>
								<label style={fieldLabel}>Product Name *
									<input style={fieldInput} value={form.pro_name} onChange={handleFieldChange("pro_name")} placeholder="e.g. Chicken Fried Rice" />
								</label>

								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
									<label style={fieldLabel}>Selling Price *
										<input type="number" min="0" step="0.01" style={fieldInput} value={form.pro_price} onChange={handleFieldChange("pro_price")} />
									</label>
									<label style={fieldLabel}>Cost Price
										<input type="number" min="0" step="0.01" style={fieldInput} value={form.cost_price} onChange={handleFieldChange("cost_price")} />
									</label>
									<label style={fieldLabel}>Discount %
										<input type="number" min="0" max="100" step="0.5" style={fieldInput} value={form.discount_pct} onChange={handleFieldChange("discount_pct")} />
									</label>
								</div>
								{discountedPrice && (
									<div style={{ fontSize: 13, color: "#15803D", fontWeight: 700, marginTop: -6 }}>
										Customers pay LKR {discountedPrice}
										<span style={{ color: "#9CA3AF", fontWeight: 400, marginLeft: 6, textDecoration: "line-through" }}>LKR {Number(form.pro_price).toFixed(2)}</span>
									</div>
								)}

								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
									<label style={fieldLabel}>Category
										<select style={fieldInput} value={form.category} onChange={handleFieldChange("category")}>
											<option value="General">Default</option>
											{categories.map((c) => (
												<option key={c.cat_id} value={c.cat_name}>{c.cat_name}</option>
											))}
										</select>
									</label>
									<label style={fieldLabel}>Tax (%)
										<input type="number" min="0" max="100" step="0.5" style={fieldInput} value={form.tax_group} onChange={handleFieldChange("tax_group")} />
									</label>
								</div>

								<div>
									<div style={{ ...fieldLabel, marginBottom: 6 }}>How is this stocked?</div>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
										<button type="button" style={stockChoiceStyle(form.track_inventory)} onClick={() => setForm((prev) => ({ ...prev, track_inventory: true }))}>
											<div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>We count it</div>
											<div style={{ fontSize: 11, color: "#64748B", marginTop: 3, lineHeight: 1.4 }}>
												A tray of pastries, bottled drinks — it sits on the rack in a number, and that number goes down as it sells.
											</div>
										</button>
										<button type="button" style={stockChoiceStyle(!form.track_inventory)} onClick={() => setForm((prev) => ({ ...prev, track_inventory: false }))}>
											<div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Made to order</div>
											<div style={{ fontSize: 11, color: "#64748B", marginTop: 3, lineHeight: 1.4 }}>
												Cooked when the customer asks. Nothing to count in the morning; at the end of the day you see how many were made.
											</div>
										</button>
									</div>

									{form.track_inventory ? (
										<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
											<label style={fieldLabel}>In the storeroom
												<input type="number" min="0" style={fieldInput} value={form.pro_qty} onChange={handleFieldChange("pro_qty")} />
												<span style={{ display: "block", marginTop: 4, fontWeight: 400, fontSize: 11, color: "#94A3B8" }}>
													{branchQty === null
														? "Not on the menu yet."
														: `${Number(branchQty)} more are on the menu, ready to sell (use Restock on the Products list to move more).`}
												</span>
											</label>
											<label style={fieldLabel}>Warn me when it drops to
												<input type="number" min="0" style={fieldInput} value={form.low_stock} onChange={handleFieldChange("low_stock")} />
											</label>
										</div>
									) : (
										<p style={{ margin: "10px 0 0", fontSize: 11, color: "#64748B", lineHeight: 1.5 }}>
											It will always be on the till and will never read "out of stock". If you write its ingredients on the Recipes page, the till works out how many portions the store allows and takes them out as it sells.
										</p>
									)}
								</div>

								<div>
									<div style={{ ...fieldLabel, marginBottom: 4 }}>Image</div>
									<div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
										<div style={{ width: 72, height: 72, borderRadius: 12, border: "1px solid #E2E8F0", background: "#F8FAFC", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
											{imagePreview}
										</div>
										<div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
											<input
												placeholder="https://.../dish.jpg"
												style={{ ...fieldInput, marginTop: 0 }}
												value={form.pro_image.startsWith("data:") ? "" : form.pro_image}
												onChange={(e) => setForm((prev) => ({ ...prev, pro_image: e.target.value }))}
											/>
											<label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 34, borderRadius: 8, border: "1px dashed #A0B4C8", background: "#F0F5FA", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#1565C0" }}>
												<FaUpload size={10} />
												<span>Upload from device</span>
												<input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileUpload} />
											</label>
											{form.pro_image.startsWith("data:") && (
												<button type="button" onClick={() => setForm((prev) => ({ ...prev, pro_image: "" }))} style={{ fontSize: 11, color: "#EF4444", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
													× Remove uploaded image
												</button>
											)}
										</div>
									</div>
								</div>

								<label style={fieldLabel}>Description
									<textarea rows={2} style={{ ...fieldInput, resize: "vertical" }} value={form.description} onChange={handleFieldChange("description")} />
								</label>
							</div>

							<div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 24, paddingTop: 20, borderTop: "1px solid #E2E8F0" }}>
								{success && <span style={{ marginRight: "auto", color: "#15803D", fontSize: 13, fontWeight: 600 }}>{success}</span>}
								<button type="button" onClick={handleDelete} disabled={saving} style={{ padding: "10px 16px", border: "1px solid #FECACA", borderRadius: 8, fontWeight: 600, color: "#DC2626", background: "#fff", cursor: saving ? "wait" : "pointer", fontSize: 13 }}>
									Delete
								</button>
								<button type="button" onClick={handleCancel} style={{ padding: "10px 20px", border: "1px solid #E2E8F0", borderRadius: 8, fontWeight: 600, color: "#475569", background: "#fff", cursor: "pointer", fontSize: 13 }}>
									Cancel
								</button>
								<button type="button" onClick={handleSave} disabled={saving} style={{ padding: "10px 20px", border: "none", borderRadius: 8, fontWeight: 600, color: "#fff", background: "#1565C0", cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1, fontSize: 13, boxShadow: "0 4px 12px rgba(21,101,192,0.2)" }}>
									{saving ? "Saving…" : "Save Changes"}
								</button>
							</div>
						</div>
					)}
				</div>
			</div>


			{isDeletePage && (
				<div style={modalOverlayStyle}>
					<div style={modalCardStyle}>
						<div style={{ padding: "18px 20px 10px" }}>
							<h3 style={{ margin: 0, fontSize: "18px", lineHeight: 1.2, color: "#111827", fontWeight: "800" }}>Delete Product?</h3>
							<p style={{ margin: "8px 0 0", fontSize: "12px", lineHeight: 1.45, color: "#111827" }}>
								Are you sure you want to delete '{form.pro_name || "this product"}'? This action cannot be undone and will remove the product from all menus.
							</p>
						</div>
						<div style={{ padding: "0 20px 16px" }}>
							<label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", fontWeight: "700", color: "#111827" }}>
								<input type="checkbox" checked={deleteAcknowledged} onChange={(e) => setDeleteAcknowledged(e.target.checked)} />
								<span>I understand that this action is permanent.</span>
							</label>
						</div>
						<div style={{ display: "flex", justifyContent: "center", gap: "14px", padding: "0 20px 18px" }}>
							<button type="button" onClick={handleCancel} style={{ minWidth: "76px", height: "30px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "#FFFFFF", color: "#111827", cursor: "pointer", fontWeight: "500" }}>
								Cancel
							</button>
							<button type="button" onClick={handleDelete} disabled={saving} style={{ minWidth: "76px", height: "30px", borderRadius: "8px", border: "none", background: "#EF4444", color: "#FFFFFF", cursor: saving ? "wait" : "pointer", fontWeight: "500" }}>
								{saving ? "Deleting..." : "Delete"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default ProductDetails;
