import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaCheck,
  FaChevronDown,
  FaMinus,
  FaPlus,
  FaSearch,
  FaShoppingCart,
  FaTrashAlt,
  FaEdit,
} from "react-icons/fa";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import {
  createBranchProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getBranchProducts,
  getCategories,
  getProducts,
} from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { readImageFile } from "../../utils/readImageFile";

const pageStyle = {
  display: "flex",
  background: "#F2F4F7",
  minHeight: "100vh",
};

// The two answers to "how is this stocked?", side by side so the owner picks
// one rather than filling in a number that may not exist.
const stockChoiceStyle = (chosen) => ({
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1.5px solid ${chosen ? "#1565C0" : "#E2E8F0"}`,
  background: chosen ? "#EFF6FF" : "#fff",
  cursor: "pointer",
  fontFamily: "inherit",
});

const contentStyle = {
  flex: 1,
  marginLeft: "var(--sidebar-w, 240px)",
};

const shellStyle = {
  padding: "20px 22px 28px",
};

const heroStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "18px",
  marginBottom: "18px",
};

const titleStyle = {
  margin: 0,
  fontSize: "34px",
  fontWeight: "800",
  color: "#0B1220",
  lineHeight: 1.05,
};

const subtitleStyle = {
  margin: "8px 0 0",
  fontSize: "14px",
  color: "#64748B",
  maxWidth: "760px",
  lineHeight: 1.6,
};

const panelStyle = {
  background: "#FFFFFF",
  border: "1px solid #E5E7EB",
  borderRadius: "18px",
  boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
};

const searchShellStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  background: "#FFFFFF",
  borderRadius: "14px",
  border: "1px solid #D8E1EA",
  padding: "10px 14px",
  minWidth: "320px",
};

const inputStyle = {
  border: "none",
  outline: "none",
  background: "transparent",
  width: "100%",
  fontSize: "14px",
  color: "#0F172A",
};

const selectStyle = {
  width: "100%",
  height: "42px",
  borderRadius: "12px",
  border: "1px solid #D8E1EA",
  background: "#FFFFFF",
  padding: "0 14px",
  fontSize: "14px",
  color: "#0F172A",
  outline: "none",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
};

const actionButtonStyle = {
  border: "none",
  borderRadius: "12px",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
  fontWeight: "700",
};

const badgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  borderRadius: "999px",
  padding: "6px 10px",
  fontSize: "12px",
  fontWeight: "700",
};

const cardButtonStyle = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  border: "1px solid #D8E1EA",
  borderRadius: "16px",
  padding: "14px",
  background: "#FFFFFF",
  textAlign: "left",
  cursor: "pointer",
  transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

const toShortName = (name) => {
  if (!name) return "";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1, 4).toLowerCase())
    .join(" ");
};

const CardChip = ({ label, value }) => (
  <div style={{
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px 12px",
    borderRadius: "12px",
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
  }}>
    <span style={{ fontSize: "12px", color: "#64748B", fontWeight: "600" }}>{label}</span>
    <span style={{ fontSize: "14px", color: "#0F172A", fontWeight: "700" }}>{value}</span>
  </div>
);

const ProductChip = ({ label, value }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      padding: "10px 12px",
      borderRadius: "12px",
      background: "#F8FAFC",
      border: "1px solid #E2E8F0",
      marginBottom: "10px",
    }}
  >
    <span style={{ fontSize: "13px", color: "#475569", fontWeight: "600" }}>{label}</span>
    <span style={{ fontSize: "13px", color: "#0F172A", fontWeight: "700" }}>{value}</span>
  </div>
);

const AddProduct = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [products, setProducts] = useState([]);
  const [branchProducts, setBranchProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedItems, setSelectedItems] = useState({});
  const [branchId, setBranchId] = useState(null);

  // The owner runs the whole property, so he can author a brand-new menu item
  // here rather than only linking items someone else already created.
  const [showCreate, setShowCreate] = useState(false);
  const [editingProductId, setEditingProductId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newProduct, setNewProduct] = useState({
    pro_name: "", pro_price: "", cost_price: "", discount_pct: 0,
    cat_id: "", pro_qty: 0, description: "", pro_image: "",
    // Nothing is taxed unless the owner says so.
    tax_group: "0", low_stock: "10",
    // Counted by default — a rack item is the common case, and the owner is
    // one click from saying otherwise.
    counted: true,
  });

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      // Downscaled here rather than stored as-is — a raw phone photo is
      // 3-5 MB, and this only ever renders as a small tile.
      const dataUrl = await readImageFile(file, { maxWidth: 800 });
      setNewProduct((p) => ({ ...p, pro_image: dataUrl }));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateProduct = async (e, addToBranch) => {
    if (e) e.preventDefault();
    if (!newProduct.pro_name.trim()) { setCreateError("Give the product a name."); return; }
    if (!user?.com_id) { setCreateError("Your account is not linked to a company, so a product cannot be filed."); return; }
    if (!(Number(newProduct.pro_price) > 0)) { setCreateError("Set a selling price."); return; }
    if (!branchId) { setCreateError("No branch is assigned to your account."); return; }

    setCreating(true); setCreateError("");
    try {
      // The chosen category, or this company's first — never a hard-coded 1,
      // which quietly filed things under whatever category happened to be first
      // in the whole system.
      const catId = Number(newProduct.cat_id || categories?.[0]?.cat_id || 0);
      if (!catId) { setCreateError("Add a menu category first — a product has to be filed under one."); setCreating(false); return; }
      // Nothing to count if it is cooked to order, so nothing is carried in.
      const openingQty = newProduct.counted ? Number(newProduct.pro_qty) || 0 : 0;
      
      const payload = {
        pro_name: newProduct.pro_name.trim(),
        pro_qty: openingQty,
        pro_price: Number(newProduct.pro_price),
        cost_price: Number(newProduct.cost_price) || 0,
        pro_image: newProduct.pro_image.trim(),
        com_id: Number(user?.com_id),
        cat_id: catId,
        description: newProduct.description.trim() || null,
        discount_pct: Number(newProduct.discount_pct) || 0,
        tax_group: Number(newProduct.tax_group) || 0,
        low_stock: newProduct.low_stock === "" ? 10 : Number(newProduct.low_stock),
        track_inventory: newProduct.counted,
        // A new product starts with none; editing must not wipe what is already set.
        ...(editingProductId ? {} : { add_ons: {}, stations: {} }),
      };

      if (editingProductId) {
        await updateProduct(editingProductId, payload);
        const updatedProdObj = {
          pro_id: editingProductId,
          ...payload
        };
        setProducts(prev => prev.map(p => p.pro_id === editingProductId ? { ...p, ...updatedProdObj } : p));
        setSuccess(`Product "${payload.pro_name}" updated successfully!`);
        setTimeout(() => setSuccess(""), 4500);
        setShowCreate(false);
        setEditingProductId(null);
        setNewProduct({ pro_name: "", pro_price: "", cost_price: "", discount_pct: 0, cat_id: "", pro_qty: 0, description: "", pro_image: "", tax_group: "0", low_stock: "10", counted: true });
        return;
      }

      // Two steps: author the master product, then put it on this branch's menu.
      const created = await createProduct(payload);


      const proId = created?.pro_id ?? created?.data?.pro_id;
      if (!proId) throw new Error("The product was created but no id came back.");

      if (addToBranch) {
        await createBranchProduct({
          pro_name: newProduct.pro_name.trim(),
          pro_shortname: toShortName(newProduct.pro_name.trim()),
          pro_image: newProduct.pro_image.trim() || "N/A",
          pro_des: newProduct.description.trim() || newProduct.pro_name.trim(),
          pro_quantity: openingQty,
          pro_price: Number(newProduct.pro_price),
          cat_id: catId,
          pro_id: Number(proId),
          B_id: branchId,
        });

        const newProdObj = {
          pro_id: proId,
          pro_name: newProduct.pro_name.trim(),
          pro_price: Number(newProduct.pro_price),
          pro_image: newProduct.pro_image.trim(),
          pro_qty: openingQty,
          track_inventory: newProduct.counted
        };
        setProducts(prev => [newProdObj, ...prev]);
        setBranchProducts(prev => [...prev, { pro_id: proId }]);

        setShowCreate(false);
        setNewProduct({ pro_name: "", pro_price: "", cost_price: "", discount_pct: 0,
                        cat_id: "", pro_qty: 0, description: "", pro_image: "", tax_group: "0", low_stock: "10", counted: true });
        
        setSuccess(`Product "${newProduct.pro_name}" created and added to branch successfully!`);
        setTimeout(() => setSuccess(""), 4500);
      } else {
        const newProdObj = {
          pro_id: proId,
          pro_name: newProduct.pro_name.trim(),
          pro_price: Number(newProduct.pro_price),
          pro_image: newProduct.pro_image.trim(),
          pro_qty: openingQty,
          track_inventory: newProduct.counted
        };
        setProducts(prev => [newProdObj, ...prev]);
        setShowCreate(false);
        setNewProduct({ pro_name: "", pro_price: "", cost_price: "", discount_pct: 0,
                        cat_id: "", pro_qty: 0, description: "", pro_image: "", tax_group: "0", low_stock: "10", counted: true });
        setSuccess(`Product "${newProduct.pro_name}" created successfully! You can select it below to add to the branch.`);
        setTimeout(() => setSuccess(""), 4500);
      }
    } catch (err) {
      setCreateError(err?.response?.data?.message || "Failed to save product.");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProduct = async (id, name) => {
    if (!window.confirm(`Are you sure you want to completely delete "${name}" from the global catalog?`)) return;
    try {
      await deleteProduct(id);
      setProducts(prev => prev.filter(p => p.pro_id !== id));
      setSelectedItems(prev => { const next = { ...prev }; delete next[id]; return next; });
      setSuccess(`Deleted "${name}" successfully.`);
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to delete product.");
    }
  };

  const openEdit = (product) => {
    setEditingProductId(product.pro_id);
    setNewProduct({
      pro_name: product.pro_name || "",
      pro_price: product.pro_price || "",
      cost_price: product.cost_price || "",
      discount_pct: product.discount_pct || 0,
      cat_id: product.cat_id || "",
      pro_qty: product.pro_qty || 0,
      description: product.description || "",
      pro_image: product.pro_image || "",
      tax_group: String(product.tax_group ?? 0),
      low_stock: String(product.low_stock ?? 10),
      counted: product.track_inventory ?? true,
    });
    setCreateError("");
    setShowCreate(true);
  };

  // If we open standard create, clear edit state
  const openCreate = () => {
    setEditingProductId(null);
    setNewProduct({ pro_name: "", pro_price: "", cost_price: "", discount_pct: 0, cat_id: "", pro_qty: 0, description: "", pro_image: "", tax_group: "0", low_stock: "10", counted: true });
    setCreateError("");
    setShowCreate(true);
  };

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        setLoading(true);
        setError("");

        // Use b_id directly from the JWT token — no need to re-fetch all branches
        const myBranchId = user?.b_id ?? null;

        if (mounted) setBranchId(myBranchId);

        const [allProducts, currentBranchProducts, categoryList] = await Promise.all([
          getProducts().catch((err) => {
            if (err?.response?.status === 404) return [];
            throw err;
          }),
          myBranchId ? getBranchProducts(myBranchId).catch((err) => {
            if (err?.response?.status === 404) return [];
            throw err;
          }) : [],
          getCategories().catch(() => []),
        ]);

        if (!mounted) return;

        const safeProducts = allProducts?.data || allProducts || [];
        setProducts(Array.isArray(safeProducts) ? safeProducts : []);
        setBranchProducts(Array.isArray(currentBranchProducts) ? currentBranchProducts : []);
        setCategories(Array.isArray(categoryList) ? categoryList : []);

        const firstCategory = Array.isArray(categoryList) && categoryList.length > 0 ? categoryList[0] : null;
        setSelectedCategoryId(firstCategory?.cat_id ? String(firstCategory.cat_id) : "");
      } catch (err) {
        if (!mounted) return;
        setError(err?.response?.data?.message || "Failed to load products");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const branchProductIds = useMemo(() => {
    return new Set(branchProducts.map((item) => Number(item.pro_id)));
  }, [branchProducts]);

  const availableProducts = useMemo(() => {
    return products.filter((product) => !branchProductIds.has(Number(product.pro_id)));
  }, [products, branchProductIds]);

  const filteredProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return availableProducts;

    return availableProducts.filter((product) => {
      const name = String(product.pro_name ?? "").toLowerCase();
      const image = String(product.pro_image ?? "").toLowerCase();
      return name.includes(term) || image.includes(term) || String(product.pro_id ?? "").includes(term);
    });
  }, [availableProducts, searchTerm]);

  const selectedList = useMemo(() => {
    return Object.entries(selectedItems)
      .map(([productId, value]) => {
        const product = products.find((item) => String(item.pro_id) === String(productId));
        if (!product) return null;
        return {
          ...product,
          quantity: value.quantity,
        };
      })
      .filter(Boolean);
  }, [selectedItems, products]);

  const selectedCount = selectedList.length;
  const totalUnits = selectedList.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const estimatedValue = selectedList.reduce(
    (sum, item) => sum + Number(item.pro_price ?? 0) * Number(item.quantity || 0),
    0,
  );

  // A dish cooked to order has no opening stock to bring across — asking for
  // one portion of it was refused as "Insufficient stock in main hotel".
  const isMadeToOrder = (product) => product?.track_inventory === false;

  const addToSelection = (product) => {
    setSelectedItems((prev) => {
      const key = String(product.pro_id);
      if (prev[key]) return prev;
      return {
        ...prev,
        [key]: {
          quantity: isMadeToOrder(product) ? 0 : 1,
        },
      };
    });
  };

  const updateSelectedQuantity = (productId, nextQuantity) => {
    const product = products.find(p => String(p.pro_id) === String(productId));
    if (!product) return;

    let finalQuantity = nextQuantity;
    // Cap at maximum available stock if the item is counted
    if (product.track_inventory !== false) {
      const maxStock = Number(product.pro_qty || 0);
      if (finalQuantity > maxStock) {
        finalQuantity = maxStock;
      }
    }

    setSelectedItems((prev) => {
      const key = String(productId);
      if (finalQuantity <= 0) {
        const next = { ...prev };
        delete next[key];
        return next;
      }

      return {
        ...prev,
        [key]: {
          ...prev[key],
          quantity: finalQuantity,
        },
      };
    });
  };

  const removeFromSelection = (productId) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      delete next[String(productId)];
      return next;
    });
  };

  const handleSaveSelection = async () => {
    if (!selectedList.length) {
      setError("Select at least one product to add to the branch.");
      return;
    }

    const resolvedCategoryId = Number(selectedCategoryId || categories?.[0]?.cat_id || 0);
    if (!Number.isFinite(resolvedCategoryId) || resolvedCategoryId <= 0) {
      setError("Please choose a valid category before saving.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      setSuccess("");

      if (!branchId) {
        setError("Branch ID could not be determined.");
        setSaving(false);
        return;
      }

      for (const item of selectedList) {
        await createBranchProduct({
          pro_name: item.pro_name,
          pro_shortname: toShortName(item.pro_name),
          pro_image: item.pro_image || "N/A",
          pro_des: `${item.pro_name} imported from Product`,
          pro_quantity: Number(item.quantity || 0),
          pro_price: Number(item.pro_price ?? 0),
          cat_id: item.cat_id ? Number(item.cat_id) : resolvedCategoryId,
          pro_id: Number(item.pro_id),
          B_id: branchId,
        });
      }

      setBranchProducts((prev) => [
        ...prev,
        ...selectedList.map((item) => ({ pro_id: item.pro_id })),
      ]);
      setSelectedItems({});
      setSuccess(`${selectedCount} product${selectedCount === 1 ? "" : "s"} added to the branch successfully.`);
      setTimeout(() => setSuccess(""), 2500);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to add selected products to branch");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={pageStyle}>
      <Sidebar />

      <div style={contentStyle}>
        <Header
          title="Branch Product Management"
          role="Branch Admin"
          showAddUserIcon
        />

        <div style={shellStyle}>
          <div style={heroStyle}>
            <button
              type="button"
              onClick={() => navigate("/branch-admin/products")}
              style={{
                ...actionButtonStyle,
                background: "#FFFFFF",
                border: "1px solid #D8E1EA",
                color: "#0F172A",
                padding: "12px 16px",
                boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
              }}
            >
              Back to products
            </button>
            <button
              type="button"
              onClick={openCreate}
              style={{ ...actionButtonStyle, background: "#1565C0", color: "#fff", padding: "12px 18px" }}
            >
              + Create New Product
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.45fr 0.85fr", gap: "18px" }}>
            <div style={{ ...panelStyle, padding: "18px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", marginBottom: "16px" }}>
                <div style={searchShellStyle}>
                  <FaSearch color="#94A3B8" />
                  <input
                    type="text"
                    placeholder="Search remaining products"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div style={{ position: "relative", minWidth: "250px" }}>
                  <select
                    value={selectedCategoryId}
                    onChange={(event) => setSelectedCategoryId(event.target.value)}
                    style={selectStyle}
                  >
                    {categories.length === 0 ? (
                      <option value="1">General</option>
                    ) : (
                      categories.map((category) => (
                        <option key={category.cat_id} value={category.cat_id}>
                          {category.cat_name}
                        </option>
                      ))
                    )}
                  </select>
                  <FaChevronDown
                    size={11}
                    color="#334155"
                    style={{
                      position: "absolute",
                      right: "14px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      pointerEvents: "none",
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <div style={{ fontSize: "14px", color: "#64748B", fontWeight: "600" }}>
                  {filteredProducts.length} available item{filteredProducts.length === 1 ? "" : "s"}
                </div>
              </div>

              {loading ? (
                <div style={{ color: "#475569", fontSize: "14px", padding: "10px 0" }}>Loading catalog...</div>
              ) : error ? (
                <div style={{ color: "#B91C1C", fontSize: "14px", padding: "10px 0" }}>{error}</div>
              ) : filteredProducts.length === 0 ? (
                <div
                  style={{
                    border: "1px dashed #CBD5E1",
                    borderRadius: "16px",
                    padding: "24px",
                    color: "#64748B",
                    background: "#F8FAFC",
                    fontSize: "14px",
                  }}
                >
                  No remaining products found. Everything currently in the Product table is already added to the branch,
                  or your search filtered the list to nothing.
                </div>
              ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                      gap: "14px",
                      maxHeight: "calc(100vh - 300px)",
                      overflowY: "auto",
                      padding: "8px",
                    }}
                  >
                  {filteredProducts.map((product) => {
                    const selected = Boolean(selectedItems[String(product.pro_id)]);
                    const price = Number(product.pro_price ?? 0);
                    const stock = Number(product.pro_qty ?? 0);

                    return (
                      <div
                        key={product.pro_id}
                        onClick={() => addToSelection(product)}
                        style={{
                          ...cardButtonStyle,
                          borderColor: selected ? "#0E6DCF" : "#D8E1EA",
                          boxShadow: selected ? "0 10px 26px rgba(14, 109, 207, 0.14)" : cardButtonStyle.boxShadow,
                          transform: selected ? "translateY(-1px)" : "translateY(0)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", width: "100%" }}>
                          <div>
                            <div
                              style={{
                                width: "52px",
                                height: "52px",
                                borderRadius: "14px",
                                display: "grid",
                                placeItems: "center",
                                background: "#F1F5F9",
                                fontSize: "24px",
                                marginBottom: "10px",
                                overflow: "hidden",
                              }}
                            >
                              {product.pro_image && product.pro_image !== "N/A" ? (
                                <img src={product.pro_image} alt={product.pro_name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                "🧾"
                              )}
                            </div>
                            <div style={{ fontSize: "15px", fontWeight: "600", color: "#0F172A", lineHeight: 1.2 }}>
                              {product.pro_name}
                            </div>
                            <div style={{ marginTop: "4px", fontSize: "12px", color: "#64748B" }}>
                              Product ID #{product.pro_id}
                            </div>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end" }}>
                            <div
                              style={{
                                ...badgeStyle,
                                background: selected ? "#E0F2FE" : "#F8FAFC",
                                color: selected ? "#0369A1" : "#475569",
                              }}
                            >
                              {selected ? <FaCheck size={10} /> : <FaPlus size={10} />}
                              {selected ? "Selected" : "Add"}
                            </div>
                            
                            <div style={{ display: "flex", gap: "6px" }} onClick={e => e.stopPropagation()}>
                              <button 
                                onClick={() => openEdit(product)} 
                                style={{ background: "#F1F5F9", border: "none", borderRadius: "6px", width: "26px", height: "26px", display: "grid", placeItems: "center", cursor: "pointer" }}
                                title="Edit Product"
                              >
                                <FaEdit size={12} color="#475569" />
                              </button>
                              <button 
                                onClick={() => handleDeleteProduct(product.pro_id, product.pro_name)} 
                                style={{ background: "#FEF2F2", border: "none", borderRadius: "6px", width: "26px", height: "26px", display: "grid", placeItems: "center", cursor: "pointer" }}
                                title="Delete Product"
                              >
                                <FaTrashAlt size={12} color="#DC2626" />
                              </button>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", paddingTop: "14px", borderTop: "1px solid #F1F5F9", width: "100%" }}>
                          <div style={{ fontSize: "14px", fontWeight: "800", color: "#0F172A" }}>LKR {price.toFixed(2)}</div>
                          <div style={{ fontSize: "12px", color: "#64748B", fontWeight: "600" }}>
                            {isMadeToOrder(product) ? "Made to order" : `${stock} in stock`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ ...panelStyle, padding: "18px", position: "sticky", top: "88px", alignSelf: "start" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "12px",
                    background: "#0E6DCF",
                    display: "grid",
                    placeItems: "center",
                    color: "#FFFFFF",
                  }}
                >
                  <FaShoppingCart />
                </div>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: "600", color: "#0F172A" }}>Order summary</div>
                  <div style={{ fontSize: "13px", color: "#64748B" }}>{selectedCount} item{selectedCount === 1 ? "" : "s"} selected</div>
                </div>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "#334155", marginBottom: "6px" }}>
                  Category for branch entry
                </label>
                <div style={{ position: "relative" }}>
                  <select
                    value={selectedCategoryId}
                    onChange={(event) => setSelectedCategoryId(event.target.value)}
                    style={selectStyle}
                  >
                    {categories.length === 0 ? (
                      <option value="1">General</option>
                    ) : (
                      categories.map((category) => (
                        <option key={category.cat_id} value={category.cat_id}>
                          {category.cat_name}
                        </option>
                      ))
                    )}
                  </select>
                  <FaChevronDown
                    size={11}
                    color="#334155"
                    style={{
                      position: "absolute",
                      right: "14px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      pointerEvents: "none",
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "13px", fontWeight: "700", color: "#334155", marginBottom: "10px" }}>
                  Selected items
                </div>

                {selectedList.length === 0 ? (
                  <div
                    style={{
                      border: "1px dashed #CBD5E1",
                      borderRadius: "14px",
                      padding: "18px",
                      background: "#F8FAFC",
                      color: "#64748B",
                      fontSize: "13px",
                      lineHeight: 1.6,
                    }}
                  >
                    Click any remaining product on the left to add it to the order. You can adjust the quantity here before saving.
                  </div>
                ) : (
                  <div style={{ maxHeight: "310px", overflowY: "auto", paddingRight: "2px" }}>
                    {selectedList.map((item) => {
                      const itemState = selectedItems[String(item.pro_id)] || { quantity: 1 };
                      const quantity = Number(itemState.quantity || 1);
                      const itemTotal = Number(item.pro_price ?? 0) * quantity;

                      return (
                        <div
                          key={item.pro_id}
                          style={{
                            border: "1px solid #E2E8F0",
                            borderRadius: "14px",
                            padding: "12px",
                            marginBottom: "10px",
                            background: "#FFFFFF",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
                            <div>
                              <div style={{ fontSize: "14px", fontWeight: "800", color: "#0F172A" }}>{item.pro_name}</div>
                              <div style={{ fontSize: "12px", color: "#64748B", marginTop: "2px" }}>
                                LKR {Number(item.pro_price ?? 0).toFixed(2)} each
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeFromSelection(item.pro_id)}
                              style={{
                                ...actionButtonStyle,
                                width: "30px",
                                height: "30px",
                                background: "#FEF2F2",
                                color: "#DC2626",
                              }}
                            >
                              <FaTrashAlt size={11} />
                            </button>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "12px" }}>
                            {isMadeToOrder(item) ? (
                              <div style={{ fontSize: "12px", fontWeight: 600, color: "#64748B" }}>
                                Made to order — nothing to bring across
                              </div>
                            ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <button
                                type="button"
                                onClick={() => updateSelectedQuantity(item.pro_id, quantity - 1)}
                                style={{
                                  ...actionButtonStyle,
                                  width: "32px",
                                  height: "32px",
                                  background: "#F8FAFC",
                                  border: "1px solid #E2E8F0",
                                  color: "#334155",
                                }}
                              >
                                <FaMinus size={10} />
                              </button>

                              <input
                                type="number"
                                min={0}
                                value={quantity}
                                onChange={(e) => updateSelectedQuantity(item.pro_id, parseInt(e.target.value) || 0)}
                                style={{
                                  width: "50px",
                                  height: "32px",
                                  textAlign: "center",
                                  fontSize: "14px",
                                  fontWeight: "700",
                                  color: "#0F172A",
                                  border: "1px solid #E2E8F0",
                                  borderRadius: "8px",
                                  background: "#FFFFFF",
                                  outline: "none",
                                  margin: 0,
                                }}
                              />

                              <button
                                type="button"
                                onClick={() => updateSelectedQuantity(item.pro_id, quantity + 1)}
                                style={{
                                  ...actionButtonStyle,
                                  width: "32px",
                                  height: "32px",
                                  background: "#F8FAFC",
                                  border: "1px solid #E2E8F0",
                                  color: "#334155",
                                }}
                              >
                                <FaPlus size={10} />
                              </button>
                            </div>
                            )}

                            <div style={{ fontSize: "13px", fontWeight: "700", color: "#0F172A" }}>
                              LKR {itemTotal.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div
                style={{
                  borderTop: "1px solid #E2E8F0",
                  paddingTop: "14px",
                  marginTop: "12px",
                }}
              >
                <ProductChip label="Total selected" value={selectedCount} />
                <ProductChip label="Total units" value={totalUnits} />
                <ProductChip label="Estimated value" value={`LKR ${estimatedValue.toFixed(2)}`} />
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                <button
                  type="button"
                  onClick={() => navigate("/branch-admin/products")}
                  style={{
                    ...actionButtonStyle,
                    flex: 1,
                    height: "44px",
                    background: "#FFFFFF",
                    border: "1px solid #D8E1EA",
                    color: "#0F172A",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveSelection}
                  style={{
                    ...actionButtonStyle,
                    flex: 1,
                    height: "44px",
                    background: saving ? "#93C5FD" : "#0E6DCF",
                    color: "#FFFFFF",
                    boxShadow: "0 10px 22px rgba(14, 109, 207, 0.22)",
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
                >
                  {saving ? "Saving..." : "Add to Menu"}
                </button>
              </div>

              {success && (
                <div
                  style={{
                    marginTop: "14px",
                    borderRadius: "14px",
                    padding: "12px 14px",
                    background: "#ECFDF3",
                    color: "#166534",
                    fontSize: "13px",
                    fontWeight: "600",
                    lineHeight: 1.5,
                  }}
                >
                  {success}
                </div>
              )}

              {error && !loading && (
                <div
                  style={{
                    marginTop: "14px",
                    borderRadius: "14px",
                    padding: "12px 14px",
                    background: "#FEF2F2",
                    color: "#B91C1C",
                    fontSize: "13px",
                    fontWeight: "600",
                    lineHeight: 1.5,
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          </div>
        </div>

      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex",
                      alignItems: "center", justifyContent: "center", zIndex: 120, padding: 16 }}>
          <form onSubmit={handleCreateProduct}
                style={{ background: "#fff", borderRadius: 16, padding: 26, width: "100%", maxWidth: 560,
                         maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.16)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#0F172A" }}>
                {editingProductId ? "Edit Product" : "Create New Product"}
              </h2>
              <button type="button" onClick={() => setShowCreate(false)}
                style={{ background: "none", border: "none", fontSize: 20, color: "#94A3B8", cursor: "pointer" }}>&times;</button>
            </div>
            <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 18 }}>
              {editingProductId ? "Update global product details." : "Adds it to the menu and puts it straight onto this branch."}
            </div>

            {createError && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626",
                            padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
                {createError}
              </div>
            )}

            <div style={{ display: "grid", gap: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Product Name *
                <input value={newProduct.pro_name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, pro_name: e.target.value }))}
                  placeholder="e.g. Chicken Fried Rice"
                  style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px",
                           border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Selling Price *
                  <input type="number" min={0} step="0.01" value={newProduct.pro_price}
                    onChange={(e) => setNewProduct((p) => ({ ...p, pro_price: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px",
                             border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Cost Price
                  <input type="number" min={0} step="0.01" value={newProduct.cost_price}
                    onChange={(e) => setNewProduct((p) => ({ ...p, cost_price: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px",
                             border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Discount %
                  <input type="number" min={0} max={100} value={newProduct.discount_pct}
                    onChange={(e) => setNewProduct((p) => ({ ...p, discount_pct: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px",
                             border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Category
                  <select value={newProduct.cat_id}
                    onChange={(e) => setNewProduct((p) => ({ ...p, cat_id: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px",
                             border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}>
                    <option value="">Default</option>
                    {categories.map((c) => (
                      <option key={c.cat_id} value={c.cat_id}>{c.cat_name}</option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Tax (%)
                  <input type="number" min={0} max={100} step="0.5" value={newProduct.tax_group}
                    onChange={(e) => setNewProduct((p) => ({ ...p, tax_group: e.target.value }))}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px",
                             border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                </label>
              </div>

              {/* How is this stocked? Twenty pastries go on the rack and are
                  counted down; kottu is cooked when somebody asks for it and
                  there is no number to give until the day is over. */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", marginBottom: 6 }}>
                  How is this stocked?
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button type="button" style={stockChoiceStyle(newProduct.counted)}
                    onClick={() => setNewProduct((p) => ({ ...p, counted: true }))}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>We count it</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 3, lineHeight: 1.4 }}>
                      A tray of pastries, bottled drinks — it sits on the rack in a
                      number, and that number goes down as it sells.
                    </div>
                  </button>
                  <button type="button" style={stockChoiceStyle(!newProduct.counted)}
                    onClick={() => setNewProduct((p) => ({ ...p, counted: false }))}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>Made to order</div>
                    <div style={{ fontSize: 11, color: "#64748B", marginTop: 3, lineHeight: 1.4 }}>
                      Cooked when the customer asks. Nothing to count in the
                      morning; at the end of the day you see how many were made.
                    </div>
                  </button>
                </div>

                {newProduct.counted ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>
                      {editingProductId ? "In the storeroom" : "How many are on the rack now"}
                      <input type="number" min={0} value={newProduct.pro_qty}
                        onChange={(e) => setNewProduct((p) => ({ ...p, pro_qty: e.target.value }))}
                        style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px",
                                 border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                    </label>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Warn me when it drops to
                      <input type="number" min={0} value={newProduct.low_stock}
                        onChange={(e) => setNewProduct((p) => ({ ...p, low_stock: e.target.value }))}
                        style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px",
                                 border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                    </label>
                  </div>
                ) : (
                  <p style={{ margin: "10px 0 0", fontSize: 11, color: "#64748B", lineHeight: 1.5 }}>
                    It will always be on the till and will never read "out of stock".
                    If you write its ingredients on the Recipes page, the till works
                    out how many portions the store allows and takes them out as it sells.
                  </p>
                )}
              </div>

              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Image
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                  {newProduct.pro_image && (
                    <img src={newProduct.pro_image} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", border: "1px solid #E2E8F0", flexShrink: 0 }} />
                  )}
                  <input value={newProduct.pro_image}
                    onChange={(e) => setNewProduct((p) => ({ ...p, pro_image: e.target.value }))}
                    placeholder="https://.../dish.jpg, or upload a photo →"
                    style={{ flex: 1, padding: "9px 12px",
                             border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, boxSizing: "border-box" }} />
                  <label style={{ padding: "9px 14px", border: "1px solid #E2E8F0", borderRadius: 8,
                    fontSize: 13, fontWeight: 600, color: "#1565C0", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                    Upload
                    <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
                  </label>
                </div>
              </label>

              <label style={{ fontSize: 12, fontWeight: 600, color: "#64748B" }}>Description
                <textarea rows={2} value={newProduct.description}
                  onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
                  style={{ display: "block", width: "100%", marginTop: 4, padding: "9px 12px",
                           border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 14, resize: "vertical",
                           boxSizing: "border-box" }} />
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "24px", paddingTop: "20px", borderTop: "1px solid #E2E8F0" }}>
              <button type="button" onClick={() => setShowCreate(false)}
                style={{ padding: "10px 20px", border: "1px solid #E2E8F0", borderRadius: "8px",
                         fontWeight: 600, color: "#475569", background: "#fff", cursor: "pointer", fontSize: "13px" }}>
                Cancel
              </button>
              <button type="button" onClick={(e) => handleCreateProduct(e, false)} disabled={creating}
                style={{ padding: "10px 20px", border: "1px solid #1565C0", borderRadius: "8px", fontWeight: 600,
                         color: "#1565C0", background: "#F0F4F8", cursor: "pointer", opacity: creating ? 0.7 : 1, fontSize: "13px" }}>
                {creating ? "Saving…" : (editingProductId ? "Save Changes" : "Create Only")}
              </button>
              {!editingProductId && (
                <button type="button" onClick={(e) => handleCreateProduct(e, true)} disabled={creating}
                  style={{ padding: "10px 20px", border: "none", borderRadius: "8px", fontWeight: 600,
                           color: "#fff", background: "#1565C0", cursor: "pointer", opacity: creating ? 0.7 : 1, fontSize: "13px", boxShadow: "0 4px 12px rgba(21,101,192,0.2)" }}>
                  {creating ? "Saving…" : "Create & Add to Menu"}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      </div>
    </div>
  );
};

export default AddProduct;
