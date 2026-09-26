import { API_URL, IMAGE_BASE_URL } from "../../config";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	FaBell,
	FaBoxOpen,
	FaChevronDown,
	FaExclamationTriangle,
	FaSearch,
} from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import Button from "../../components/admin/Button";
import ProductItemsTable from "../../components/branch-admin/ProductItemsTable";
import CountStockModal from "../../components/branch-admin/CountStockModal";
import RestockModal from "../../components/branch-admin/RestockModal";
import { getBranchProducts, deleteBranchProduct, countBranchProduct, restockBranchProduct, getProductById } from "../../services/api";
import { stockOf } from "../../utils/stockLabel";

const API_BASE_URL = API_URL;

const cardBaseStyle = {
	flex: "0 1 calc((100% - 60px) / 3)",
	borderRadius: "18px",
	padding: "25px 18px",
	display: "flex",
	alignItems: "center",
	gap: "2px",
	minHeight: "98px",
};

const statIconWrapStyle = {
	width: "30px",
	height: "30px",
	borderRadius: "8px",
	display: "grid",
	placeItems: "center",
	flexShrink: 0,
	transform: "translateX(2px)",
};

const statTextWrapStyle = {
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	marginLeft: "-6px",
};

const statRightSpacerStyle = {
	width: "18px",
	flexShrink: 0,
};

const statTitleStyle = {
	fontSize: "24px",
	fontWeight: "700",
	color: "#101828",
	lineHeight: 1,
	textAlign: "center",
};

const statValueStyle = {
	fontSize: "24px",
	fontWeight: "700",
	lineHeight: 1.1,
	textAlign: "center",
};

// What the chip says. The thresholds are the item's own — "low" is whatever the
// owner set as its Low stock alert, not a number picked here.
const getStockStatus = (stock) => {
	if (stock.madeToOrder) return "Made to order";
	if (stock.count < 0) return "Below zero";
	if (stock.soldOut) return "Out of stock";
	if (stock.low) return "Low stock";
	return "In stock";
};

const resolveProductImage = (value) => {
	if (!value) return "";
	const trimmed = String(value).trim();
	if (!trimmed || trimmed.toLowerCase() === "n/a") return "";
	if (/^data:/i.test(trimmed)) return trimmed;
	if (/^(https?:)?\/\//i.test(trimmed)) return trimmed;
	return `${IMAGE_BASE_URL}/images/${trimmed.replace(/^\/+/, "")}`;
};

const mapApiProductToTableItem = (product) => {
	const stock = stockOf(product);
	const quantity = stock.count ?? 0;
	const price = Number(product.pro_price ?? 0);
	const imageUrl = resolveProductImage(product.pro_image);

	return {
		id: product.Bpro_id,
		// The edit screen works on the master Product row, not the branch link.
		proId: product.pro_id,
		imageUrl,
		imageAlt: product.pro_name || "Product",
		name: product.pro_name,
		sku: `SKU: BPRD-${String(product.Bpro_id).padStart(3, "0")}`,
		category: product.cat_name || "General",
		price: `LKR ${price.toFixed(2)}`,
		discount: `${Number(product.discount_pct ?? 0)}%`,
		stock: stock.madeToOrder ? null : quantity,
		// The only figure a made-to-order dish has: how many the kitchen has
		// turned out since service began.
		madeToday: Number(product.made_today ?? 0),
		stockMode: product.stock_mode || "count",
		limitedBy: product.limited_by || null,
		status: getStockStatus(stock),
	};
};

const ProductManagement = () => {
	const navigate = useNavigate();

	// The table hands back Bpro_id; the edit screen is keyed on the master pro_id.
	const openProduct = (bproId) => {
		const row = tableProducts.find((p) => p.id === bproId);
		if (row?.proId) navigate(`/branch-admin/products/${row.proId}`);
	};

	const handleRemoveFromBranch = async (bproId) => {
		const row = tableProducts.find((p) => p.id === bproId);
		if (!row) return;
		if (!window.confirm(`Remove "${row.name}" from the menu?

The product itself is kept, so you can add it back later.`)) return;
		try {
			await deleteBranchProduct(bproId);
			setProducts((prev) => prev.filter((p) => p.Bpro_id !== bproId));
		} catch (err) {
			window.alert(err?.response?.data?.message || "Could not remove the product from the menu.");
		}
	};
	const { user } = useAuth();
	const [searchTerm, setSearchTerm] = useState("");
	const [products, setProducts] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [countingItem, setCountingItem] = useState(null);
	const [restocking, setRestocking] = useState(null);
	const [currentPage, setCurrentPage] = useState(1);
	const itemsPerPage = 4;

	useEffect(() => {
		let isMounted = true;

		const loadProducts = async () => {
			try {
				setLoading(true);
				setError("");
				// Use b_id directly from the JWT token — no need to re-fetch all branches
				const myBranchId = user?.b_id ?? null;
				
				const response = myBranchId ? await getBranchProducts(myBranchId).catch((err) => {
					if (err?.response?.status === 404) return [];
					throw err;
				}) : [];
				
				if (!isMounted) return;
				const safeData = response?.data || response || [];
				setProducts(Array.isArray(safeData) ? safeData : []);
			} catch (err) {
				if (!isMounted) return;
				setError(err?.response?.data?.message || "Failed to load products");
				setProducts([]);
			} finally {
				if (isMounted) setLoading(false);
			}
		};

		loadProducts();

		return () => {
			isMounted = false;
		};
	}, [user?.u_id]);

	const tableProducts = useMemo(() => {
		const mapped = products.map(mapApiProductToTableItem);
		const query = searchTerm.trim().toLowerCase();

		if (!query) return mapped;

		return mapped.filter((item) => {
			return (
				item.name.toLowerCase().includes(query) ||
				item.sku.toLowerCase().includes(query) ||
				item.category.toLowerCase().includes(query)
			);
		});
	}, [products, searchTerm]);

	const totalPages = Math.max(1, Math.ceil(tableProducts.length / itemsPerPage));

	useEffect(() => {
		setCurrentPage(1);
	}, [searchTerm]);

	useEffect(() => {
		if (currentPage > totalPages) {
			setCurrentPage(totalPages);
		}
	}, [currentPage, totalPages]);

	const paginatedProducts = useMemo(() => {
		const startIndex = (currentPage - 1) * itemsPerPage;
		return tableProducts.slice(startIndex, startIndex + itemsPerPage);
	}, [tableProducts, currentPage]);

	const pageStart = tableProducts.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
	const pageEnd = Math.min(currentPage * itemsPerPage, tableProducts.length);

	const totalItems = products.length;
	// A dish cooked to order is neither low nor out: there was never a count of
	// it to run down. Counting those as "out of stock" put the whole menu in red
	// every morning.
	const lowStockCount = products.filter((item) => stockOf(item).low).length;
	const outOfStockCount = products.filter((item) => {
		const s = stockOf(item);
		return !s.madeToOrder && s.count <= 0;
	}).length;

	return (
		<div style={{ display: "flex", background: "#F2F4F7", minHeight: "100vh" }}>
			<Sidebar />

			<div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)" }}>
				<Header
					title="Branch Product Management"
					role="Branch Admin"
					showAddUserIcon
				/>

				<div
					style={{
						padding: "22px 20px",
						marginTop: "20px",
						minHeight: "calc(100vh - 70px)",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "28px",
						}}
					>
						<h1 style={{ margin: 0, fontSize: "22px", fontWeight: "700", color: "#0F172A" }}>
							Branch Product Management
						</h1>

						<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
							<Button
								label="+  Add Product"
								onClick={() => navigate("/branch-admin/products/add")}
								style={{
									background: "#0E6DCF",
									borderRadius: "3px",
									padding: "10px 18px",
									fontWeight: "600",
								}}
							/>
						</div>
					</div>

					<div style={{ display: "flex", gap: "15px", marginBottom: "30px" }}>
						<div style={{ ...cardBaseStyle, background: "#BEE8C4" }}>
							<div
								style={{
									...statIconWrapStyle,
									background: "#22C55E",
								}}
							>
								<FaBoxOpen color="#0B3F1D" size={12} />
							</div>
							<div style={statTextWrapStyle}>
								<div style={statTitleStyle}>Total Items</div>
								<div style={statValueStyle}>{totalItems}</div>
							</div>
							<div style={statRightSpacerStyle} />
						</div>

						<div style={{ ...cardBaseStyle, background: "#F3C8DA" }}>
							<div
								style={{
									...statIconWrapStyle,
									background: "#F87171",
								}}
							>
								<FaBell color="#7F1D1D" size={12} />
							</div>
							<div style={statTextWrapStyle}>
								<div style={statTitleStyle}>Low Stock</div>
								<div style={statValueStyle}>{lowStockCount}</div>
							</div>
							<div style={statRightSpacerStyle} />
						</div>

						<div style={{ ...cardBaseStyle, background: "#C8E0EC" }}>
							<div
								style={{
									...statIconWrapStyle,
									background: "#38BDF8",
								}}
							>
								<FaExclamationTriangle color="#0C4A6E" size={12} />
							</div>
							<div style={statTextWrapStyle}>
								<div style={statTitleStyle}>Out Of Stock</div>
								<div style={statValueStyle}>{outOfStockCount}</div>
							</div>
							<div style={statRightSpacerStyle} />
						</div>
					</div>

					{loading && (
						<div style={{ marginBottom: "14px", color: "#475569", fontSize: "14px" }}>
							Loading products...
						</div>
					)}

					{error && (
						<div style={{ marginBottom: "14px", color: "#B91C1C", fontSize: "14px" }}>{error}</div>
					)}

					<div style={{ display: "flex", gap: "14px", marginBottom: "24px" }}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								background: "#fff",
								borderRadius: "12px",
								boxShadow: "0 2px 5px rgba(0,0,0,0.18)",
								padding: "8px 12px",
								flex: 1,
							}}
						>
							<FaSearch color="#9CA3AF" size={14} />
							<input
								type="text"
								placeholder="Search by Name or Code"
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								style={{ border: "none", outline: "none", width: "100%", fontSize: "14px" }}
							/>
						</div>

						{["Category : All", "Status : All", "Stock Level : All"].map((option) => (
							<div key={option} style={{ position: "relative", width: "182px" }}>
								<select
									style={{
										width: "100%",
										height: "36px",
										background: "#fff",
										borderRadius: "13px",
										boxShadow: "0 1px 3px rgba(0,0,0,0.22)",
										border: "1px solid #D9DCE1",
										padding: "0 34px 0 14px",
										fontSize: "13px",
										fontWeight: "500",
										color: "#4B5563",
										outline: "none",
										appearance: "none",
										WebkitAppearance: "none",
										MozAppearance: "none",
									}}
								>
									<option>{option}</option>
								</select>
								<FaChevronDown
									size={11}
									color="#111827"
									style={{
										position: "absolute",
										right: "17px",
										top: "50%",
										transform: "translateY(-50%)",
										pointerEvents: "none",
									}}
								/>
							</div>
						))}
					</div>

					<ProductItemsTable
						products={paginatedProducts}
						onRestock={async (id) => {
							const item = products.find((p) => p.Bpro_id === id);
							if (!item) return;
							try {
								const base = await getProductById(item.pro_id);
								setRestocking({ item, inMain: Number(base?.pro_qty ?? 0) });
							} catch {
								window.alert("Could not read the storeroom's stock. Try again.");
							}
						}}
						onCountStock={(id) => setCountingItem(products.find((p) => p.Bpro_id === id) || null)}
						onViewProduct={openProduct}
						onEditProduct={openProduct}
						onDeleteProduct={handleRemoveFromBranch}
						showActions={true}
						currentPage={currentPage}
						totalPages={totalPages}
						totalItems={tableProducts.length}
						pageStart={pageStart}
						pageEnd={pageEnd}
						onPageChange={setCurrentPage}
					/>
				</div>
			</div>

			{restocking && (
				<RestockModal
					title={restocking.item.pro_name}
					onShelf={restocking.item.pro_quantity}
					inMain={restocking.inMain}
					onClose={() => setRestocking(null)}
					onSave={async (qty) => {
						const saved = await restockBranchProduct(restocking.item.Bpro_id, qty);
						setProducts((prev) => prev.map((p) => (p.Bpro_id === restocking.item.Bpro_id
							? { ...p, pro_quantity: saved.pro_quantity, available: saved.pro_quantity }
							: p)));
					}}
				/>
			)}

			{countingItem && (
				<CountStockModal
					title={countingItem.pro_name}
					current={countingItem.pro_quantity}
					wholeNumbers
					onClose={() => setCountingItem(null)}
					onSave={async (count) => {
						const saved = await countBranchProduct(countingItem.Bpro_id, count);
						setProducts((prev) => prev.map((p) => (p.Bpro_id === countingItem.Bpro_id
							? { ...p, pro_quantity: saved.pro_quantity, available: saved.pro_quantity }
							: p)));
					}}
				/>
			)}
		</div>
	);
};

export default ProductManagement;
