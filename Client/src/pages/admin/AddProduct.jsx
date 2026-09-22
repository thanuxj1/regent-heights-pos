import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaArrowLeft, FaCheck, FaChevronDown, FaMinus, FaPlus, FaTimes, FaUpload,
} from "react-icons/fa";
import Sidebar from "../../components/admin/Sidebar";
import Header from "../../components/admin/Header";
import { createProduct, getCategories } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

const cardStyle = {
  border: "1px solid #D9E4F2",
  borderRadius: "14px",
  background: "#FFFFFF",
  boxShadow: "0 1px 0 rgba(15, 23, 42, 0.02)",
  padding: "14px",
};

const inputStyle = {
  width: "100%",
  height: "32px",
  borderRadius: "10px",
  border: "1px solid #D6E2EF",
  background: "#F8FBFE",
  outline: "none",
  padding: "0 12px",
  fontSize: "14px",
  boxSizing: "border-box",
};

const labelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: "700",
  color: "#2F3A4C",
  marginBottom: "5px",
};

const sectionTitleStyle = {
  fontSize: "18px",
  fontWeight: "700",
  color: "#111827",
  margin: "0 0 10px",
};

const badgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  borderRadius: "10px",
  padding: "4px 10px",
  fontSize: "12px",
  fontWeight: "700",
};

const toggleTrackStyle = {
  width: "34px",
  height: "16px",
  borderRadius: "999px",
  position: "relative",
  cursor: "pointer",
  transition: "background 0.2s ease",
};

const toggleKnobStyle = {
  width: "12px",
  height: "12px",
  borderRadius: "50%",
  background: "#FFFFFF",
  position: "absolute",
  top: "2px",
  left: "2px",
  boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
  transition: "transform 0.2s ease",
};

const isImageSrc = (value) =>
  typeof value === "string" && (
    /^(https?:)?\/\//i.test(value.trim()) || value.trim().startsWith("data:")
  );

const AddProduct = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const fileInputRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [categories, setCategories] = useState([]);
  const [newAddOn, setNewAddOn] = useState("");
  const [newStation, setNewStation] = useState("");

  const [form, setForm] = useState({
    pro_name: "",
    cat_id: "",
    pro_qty: "0",
    pro_price: "",
    cost_price: "",
    pro_image: "",
    description: "",
    discount_pct: "0",
    tax_group: "5",
    track_inventory: true,
    low_stock: "10",
    add_ons: {},
    stations: { Kitchen: true, Bar: true },
  });

  useEffect(() => {
    getCategories()
      .then((cats) => {
        const list = Array.isArray(cats) ? cats : [];
        setCategories(list);
        if (list.length > 0) {
          setForm((prev) => ({ ...prev, cat_id: String(list[0].cat_id) }));
        }
      })
      .catch(() => {});
  }, []);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setForm((prev) => ({ ...prev, pro_image: ev.target.result }));
    reader.readAsDataURL(file);
  };

  const toggleModifier = (group, key) => {
    setForm((prev) => ({
      ...prev,
      [group]: { ...prev[group], [key]: !prev[group][key] },
    }));
  };

  const handleAddAddOn = () => {
    if (!newAddOn.trim()) return;
    const key = newAddOn.trim();
    setForm((prev) => ({ ...prev, add_ons: { ...prev.add_ons, [key]: true } }));
    setNewAddOn("");
  };

  const handleAddStation = () => {
    if (!newStation.trim()) return;
    const key = newStation.trim();
    setForm((prev) => ({ ...prev, stations: { ...prev.stations, [key]: true } }));
    setNewStation("");
  };

  const imagePreview = useMemo(() => {
    if (isImageSrc(form.pro_image)) {
      return (
        <img
          src={form.pro_image}
          alt="Product"
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "8px" }}
        />
      );
    }
    return <span style={{ fontSize: "22px" }}>🍔</span>;
  }, [form.pro_image]);

  const discountedPrice = useMemo(() => {
    const base = Number(form.pro_price) || 0;
    const disc = Number(form.discount_pct) || 0;
    if (disc <= 0 || base <= 0) return null;
    return (base * (1 - disc / 100)).toFixed(2);
  }, [form.pro_price, form.discount_pct]);

  const handleSave = async () => {
    setError("");
    if (!form.pro_name.trim()) { setError("Product name is required"); return; }
    if (form.pro_price === "" || isNaN(Number(form.pro_price))) { setError("Sales price is required"); return; }

    try {
      setSubmitting(true);
      // No silent fallback to company 1: an item filed under somebody else's
      // company is worse than an item that was not created.
      const com_id = user?.com_id;
      if (!com_id) { setError("Your account is not linked to a company, so a product cannot be filed."); setSubmitting(false); return; }
      await createProduct({
        pro_name: form.pro_name.trim(),
        // Made to order means nothing is counted, so nothing is stored — a
        // figure here would be a number that stands for nothing.
        pro_qty: form.track_inventory ? Number(form.pro_qty) || 0 : 0,
        pro_price: Number(form.pro_price),
        cost_price: Number(form.cost_price) || 0,
        pro_image: form.pro_image.trim(),
        com_id: Number(com_id),
        cat_id: form.cat_id ? Number(form.cat_id) : undefined,
        description: form.description.trim() || null,
        discount_pct: Number(form.discount_pct) || 0,
        tax_group: Number(form.tax_group) || 5,
        low_stock: Number(form.low_stock) || 10,
        track_inventory: form.track_inventory,
        add_ons: form.add_ons,
        stations: form.stations,
      });
      setSuccess(true);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Failed to save product");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", background: "#F3F4F6", minHeight: "100vh" }}>
      <Sidebar />

      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)" }}>
        <Header title="Product Management" />

        <div style={{ padding: "18px 20px 24px" }}>
          <button
            type="button"
            onClick={() => navigate("/admin/products")}
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              border: "none", background: "transparent", color: "#6B7280",
              fontSize: "14px", fontWeight: "600", cursor: "pointer", marginBottom: "10px",
            }}
          >
            <FaArrowLeft />
            <span>Back to Products</span>
          </button>

          <h1 style={{ margin: "0 0 14px", fontSize: "24px", fontWeight: "800", color: "#0F172A" }}>
            Add New Product
          </h1>

          {error && (
            <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", color: "#B91C1C", marginBottom: "12px" }}>
              {error}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1.06fr 0.94fr", gap: "24px", alignItems: "start" }}>
            {/* LEFT COLUMN */}
            <div>
              <div style={{ ...cardStyle, marginBottom: "14px" }}>
                {/* Product Name (full row) */}
                <div style={{ marginBottom: "10px" }}>
                  <label style={labelStyle}>Product Name</label>
                  <input
                    style={inputStyle}
                    placeholder="e.g. Margherita Pizza"
                    value={form.pro_name}
                    onChange={handleChange("pro_name")}
                  />
                </div>

                {/* Category + Quantity */}
                <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: "12px", marginBottom: "10px" }}>
                  <div>
                    <label style={labelStyle}>Category</label>
                    <div style={{ position: "relative" }}>
                      <select
                        value={form.cat_id}
                        onChange={handleChange("cat_id")}
                        style={{ ...inputStyle, appearance: "none", WebkitAppearance: "none", MozAppearance: "none", paddingRight: "30px" }}
                      >
                        {categories.length === 0 ? (
                          <option value="">Loading...</option>
                        ) : (
                          categories.map((c) => (
                            <option key={c.cat_id} value={c.cat_id}>{c.cat_name}</option>
                          ))
                        )}
                      </select>
                      <FaChevronDown size={10} color="#475569" style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Quantity</label>
                    {form.track_inventory ? (
                    	<input type="number" min="0" style={inputStyle} value={form.pro_qty} onChange={handleChange("pro_qty")} />
                    ) : (
                    	<div title="Made to order — nothing is counted" style={{ ...inputStyle, display: "flex", alignItems: "center", color: "#94A3B8", background: "#F8FAFC" }}>
                    		—
                    	</div>
                    )}
                  </div>
                </div>

                {/* Product Image */}
                <div style={{ marginBottom: "10px" }}>
                  <label style={labelStyle}>Product Image</label>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                    <div style={{ width: "72px", height: "72px", borderRadius: "12px", border: "1px solid #C9DDF3", background: "#EFF4F8", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                      {imagePreview}
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                      <input
                        placeholder="Paste image URL (https://...)"
                        style={inputStyle}
                        value={form.pro_image.startsWith("data:") ? "" : form.pro_image}
                        onChange={(e) => setForm((prev) => ({ ...prev, pro_image: e.target.value }))}
                      />
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ flex: 1, height: "1px", background: "#E5E7EB" }} />
                        <span style={{ fontSize: "11px", color: "#9CA3AF" }}>or</span>
                        <div style={{ flex: 1, height: "1px", background: "#E5E7EB" }} />
                      </div>
                      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", height: "30px", borderRadius: "8px", border: "1px dashed #A0B4C8", background: "#F0F5FA", cursor: "pointer", fontSize: "12px", fontWeight: "600", color: "#1565C0" }}>
                        <FaUpload size={10} />
                        <span>Upload from device</span>
                        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileUpload} />
                      </label>
                      {form.pro_image.startsWith("data:") && (
                        <button type="button" onClick={() => setForm((prev) => ({ ...prev, pro_image: "" }))} style={{ fontSize: "11px", color: "#EF4444", background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
                          × Remove uploaded image
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label style={labelStyle}>Description</label>
                  <textarea
                    style={{ ...inputStyle, height: "64px", resize: "none", paddingTop: "8px" }}
                    placeholder="Enter product description..."
                    value={form.description}
                    onChange={handleChange("description")}
                  />
                </div>
              </div>

              {/* PRICING */}
              <h2 style={{ ...sectionTitleStyle, marginTop: "10px" }}>Pricing</h2>
              <div style={cardStyle}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "10px" }}>
                  <div>
                    <label style={labelStyle}>Sales Price (LKR)</label>
                    <input type="number" min="0" step="0.01" style={inputStyle} placeholder="0.00" value={form.pro_price} onChange={handleChange("pro_price")} />
                  </div>
                  <div>
                    <label style={labelStyle}>Tax Group (%)</label>
                    <input type="number" min="0" max="100" step="0.5" style={inputStyle} value={form.tax_group} onChange={handleChange("tax_group")} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "10px" }}>
                  <div>
                    <label style={labelStyle}>Cost Price (LKR)</label>
                    <input type="number" min="0" step="0.01" style={inputStyle} placeholder="0.00" value={form.cost_price} onChange={handleChange("cost_price")} />
                  </div>
                  <div>
                    <label style={labelStyle}>Product Code</label>
                    <input style={{ ...inputStyle, background: "#F3F4F6", color: "#9CA3AF" }} value="Auto-generated on save" readOnly />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "12px", alignItems: "end" }}>
                  <div>
                    <label style={labelStyle}>Discount (%)</label>
                    <input type="number" min="0" max="100" step="0.5" style={inputStyle} value={form.discount_pct} onChange={handleChange("discount_pct")} />
                  </div>
                  {discountedPrice && (
                    <div style={{ fontSize: "13px", color: "#15803D", fontWeight: "700", paddingBottom: "6px" }}>
                      Effective price: <span>LKR {discountedPrice}</span>
                      <span style={{ color: "#9CA3AF", fontWeight: "400", marginLeft: "6px", textDecoration: "line-through" }}>
                        LKR {Number(form.pro_price).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div>
              {/* MODIFIERS */}
              <h2 style={{ ...sectionTitleStyle, fontSize: "20px", marginBottom: "8px" }}>Modifiers</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "22px" }}>
                {/* Add-Ons */}
                <div style={cardStyle}>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "#374151", marginBottom: "8px" }}>Add-Ons</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {Object.entries(form.add_ons).map(([key, value]) => (
                      <label key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", fontSize: "14px", color: "#374151" }}>
                        <span>{key}</span>
                        <button type="button" onClick={() => toggleModifier("add_ons", key)} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
                          <span style={{ ...badgeStyle, background: value ? "#E8F7EC" : "#FCE8E6", color: value ? "#15803D" : "#B91C1C" }}>
                            {value ? <FaCheck size={9} /> : <FaTimes size={9} />}
                            {value ? "On" : "Off"}
                          </span>
                        </button>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <input
                      placeholder="Add new add-on..."
                      value={newAddOn}
                      onChange={(e) => setNewAddOn(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddAddOn()}
                      style={{ flex: 1, height: "26px", borderRadius: "8px", border: "1px solid #D6E2EF", padding: "0 10px", fontSize: "12px", outline: "none", background: "#F8FBFE" }}
                    />
                    <button type="button" onClick={handleAddAddOn} style={{ height: "26px", padding: "0 12px", background: "#26B44A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
                      + Add
                    </button>
                  </div>
                </div>

                {/* Stations */}
                <div style={cardStyle}>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "#374151", marginBottom: "8px" }}>Stations</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {Object.entries(form.stations).map(([key, value]) => (
                      <label key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", fontSize: "14px", color: "#374151" }}>
                        <span>{key}</span>
                        <button type="button" onClick={() => toggleModifier("stations", key)} style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
                          <span style={{ ...badgeStyle, background: value ? "#E8F7EC" : "#FCE8E6", color: value ? "#15803D" : "#B91C1C" }}>
                            {value ? <FaCheck size={9} /> : <FaTimes size={9} />}
                            {value ? "On" : "Off"}
                          </span>
                        </button>
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <input
                      placeholder="Add new station..."
                      value={newStation}
                      onChange={(e) => setNewStation(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddStation()}
                      style={{ flex: 1, height: "26px", borderRadius: "8px", border: "1px solid #D6E2EF", padding: "0 10px", fontSize: "12px", outline: "none", background: "#F8FBFE" }}
                    />
                    <button type="button" onClick={handleAddStation} style={{ height: "26px", padding: "0 12px", background: "#26B44A", color: "#fff", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
                      + Add
                    </button>
                  </div>
                </div>
              </div>

              {/* TRACK INVENTORY */}
              <h2 style={{ ...sectionTitleStyle, fontSize: "20px", marginTop: "22px", marginBottom: "8px" }}>Stock</h2>
              <div style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div>
                  	<div style={{ fontSize: "14px", fontWeight: "700", color: "#374151" }}>Counted stock</div>
                  	<div style={{ fontSize: "11px", color: "#6B7280", marginTop: "2px", maxWidth: "420px", lineHeight: 1.45 }}>
                  		{form.track_inventory
                  			? "It sits on the rack in a number — a tray of pastries, bottled drinks — and that number goes down as it sells."
                  			: "Made to order: cooked when the customer asks. Nothing is counted and it never reads out of stock. If it has a recipe, the till takes the ingredients instead."}
                  	</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, track_inventory: !prev.track_inventory }))}
                    style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer" }}
                  >
                    <div style={{ ...toggleTrackStyle, background: form.track_inventory ? "#1769AA" : "#CBD5E1" }}>
                      <div style={{ ...toggleKnobStyle, transform: form.track_inventory ? "translateX(18px)" : "translateX(0)" }} />
                    </div>
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", opacity: form.track_inventory ? 1 : 0.45, pointerEvents: form.track_inventory ? "auto" : "none" }}>
                  <div>
                    <label style={labelStyle}>Current stock</label>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, pro_qty: String(Math.max(0, Number(prev.pro_qty || 0) - 1)) }))}
                        style={{ width: "24px", height: "24px", borderRadius: "6px", border: "1px solid #D1D5DB", background: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}
                      >
                        <FaMinus size={9} color="#475569" />
                      </button>
                      <input style={inputStyle} value={form.pro_qty} onChange={handleChange("pro_qty")} />
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, pro_qty: String(Number(prev.pro_qty || 0) + 1) }))}
                        style={{ width: "24px", height: "24px", borderRadius: "6px", border: "1px solid #D1D5DB", background: "#fff", display: "grid", placeItems: "center", cursor: "pointer" }}
                      >
                        <FaPlus size={9} color="#475569" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Low stock threshold</label>
                    <input style={inputStyle} type="number" min="0" value={form.low_stock} onChange={handleChange("low_stock")} />
                  </div>
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "14px", marginTop: "24px" }}>
                <button
                  type="button"
                  onClick={() => navigate("/admin/products")}
                  style={{ minWidth: "120px", height: "40px", borderRadius: "10px", border: "none", background: "#FFFFFF", color: "#1F2937", boxShadow: "0 3px 10px rgba(0,0,0,0.12)", cursor: "pointer", fontWeight: "700" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={submitting}
                  style={{ minWidth: "138px", height: "40px", borderRadius: "10px", border: "none", background: submitting ? "#22A84A" : "#26B44A", color: "#FFFFFF", cursor: submitting ? "wait" : "pointer", fontWeight: "700" }}
                >
                  {submitting ? "Saving..." : "Save Product"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SUCCESS OVERLAY */}
      {success && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ width: "min(92vw, 400px)", background: "#fff", borderRadius: "18px", padding: "32px 24px", textAlign: "center", boxShadow: "0 12px 40px rgba(0,0,0,0.18)" }}>
            <div style={{ width: "60px", height: "60px", borderRadius: "50%", background: "#0E5BA8", margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <FaCheck size={28} color="#fff" />
            </div>
            <h2 style={{ margin: "0 0 6px", fontSize: "20px", fontWeight: "700", color: "#0E5BA8" }}>Product Added!</h2>
            <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#6B7280" }}>The product has been created successfully.</p>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => { setSuccess(false); setForm({ pro_name: "", cat_id: categories[0]?.cat_id ? String(categories[0].cat_id) : "", pro_qty: "0", pro_price: "", cost_price: "", pro_image: "", description: "", discount_pct: "0", tax_group: "5", track_inventory: true, low_stock: "10", add_ons: {}, stations: { Kitchen: true, Bar: true } }); }}
                style={{ flex: 1, height: "42px", border: "1px solid #E5E7EB", borderRadius: "10px", background: "#fff", color: "#374151", fontWeight: "600", cursor: "pointer" }}
              >
                Add Another
              </button>
              <button
                onClick={() => navigate("/admin/products")}
                style={{ flex: 1, height: "42px", border: "none", borderRadius: "10px", background: "#0E5BA8", color: "#fff", fontWeight: "700", cursor: "pointer" }}
              >
                View Products
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddProduct;
