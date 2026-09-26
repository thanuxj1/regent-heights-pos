import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Carrot, Package, SprayCan, Plus, Truck, Wallet, CircleAlert, LoaderCircle } from "lucide-react";
import PurchaseItemRow from "../../components/branch-admin/PurchaseItemRow";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import ToastMessage from "../../components/branch-admin/ToastMessage";
import { useAuth } from "../../context/AuthContext";
import { printSupplierInvoice } from "../../utils/printSupplierInvoice";

// The units the server accepts for a raw material.
const VALID_UNITS = ["kg", "g", "mg", "l", "ml", "pcs", "units", "dozen", "box", "pack", "bag", "bottle", "can"];

// Limits the server enforces. Checked here first so nothing is half-saved.
const MAX_NAME = 120;
const MAX_QTY = 100_000;
const MAX_UNIT_PRICE = 999_999.99;
const MAX_MIN_STOCK = 99_999.999;

const TABS = {
  ingredient: {
    label: "Ingredients",
    icon: Carrot,
    title: "Incoming ingredients",
    blurb: "Food and drink ingredients your recipes use. Stock goes up as soon as you save.",
  },
  product: {
    label: "Resale Products",
    icon: Package,
    title: "Incoming resale products",
    blurb: "Things you buy ready-made and sell as they are, like bottled drinks. They go into the storeroom; put them on the menu from Menu / Products.",
  },
  supply: {
    label: "Hotel Supplies",
    icon: SprayCan,
    title: "Incoming hotel supplies",
    blurb: "Consumables the hotel uses itself, like cleaning products. These aren't sold to guests.",
  },
};

const PAY_METHODS = [
  ["cash", "Cash"],
  ["card", "Card"],
  ["bank_transfer", "Bank transfer"],
  ["cheque", "Cheque"],
  ["online", "Online"],
];

let rowSeq = 0;
const nextKey = () => ++rowSeq;
const blankMaterial = () => ({
  key: nextKey(), rm_name: "", unit: "", qty: "", record_level: "", unit_price: "", yield_unit: "", yield_amount: "",
});
const blankProduct = () => ({ key: nextKey(), pro_id: "", pro_name: "", qty: "", unit_price: "", sell_price: "", low_stock: "", cat_id: "" });
const blankFor = (type) => (type === "product" ? blankProduct() : blankMaterial());

const lower = (s) => String(s ?? "").trim().toLowerCase();
const code = (id) => `#${String(id).padStart(3, "0")}`;
const cents = (n) => Math.round((Number(n) || 0) * 100);
const money = (c) =>
  `LKR ${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const showNum = (n) => String(Number(Number(n).toFixed(3)));
const categoryOf = (m) => m.item_category || "ingredient";

const isFilled = (row, type) =>
  Boolean((type === "product" ? row.pro_name : row.rm_name).trim() || row.qty !== "" || row.unit_price !== "");

const isNumber = (v) => v !== "" && Number.isFinite(Number(v));

const STYLES = `
.ai-page{padding:28px 32px 56px;max-width:1180px;margin:0 auto;font-family:'Inter',system-ui,sans-serif;color:#101828}
.ai-top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:20px}
.ai-top h1{margin:0;font-size:24px;font-weight:700}
.ai-sub{margin:4px 0 0;color:#667085;font-size:14px}
.ai-tabs{display:inline-flex;background:#F1F5F9;border-radius:12px;padding:4px;gap:2px;max-width:100%;overflow-x:auto}
.ai-tab{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border:0;border-radius:9px;background:transparent;color:#64748B;font:600 13px/1 inherit;font-family:inherit;cursor:pointer;transition:background .15s,color .15s;white-space:nowrap}
.ai-tab:hover{color:#1565C0}
.ai-tab[aria-selected="true"]{background:#fff;color:#1565C0;box-shadow:0 1px 4px rgba(16,24,40,.12)}
.ai-tab:focus-visible,.ai-link:focus-visible,.ai-chip:focus-visible,.ai-add:focus-visible,.ai-icon-btn:focus-visible,.ai-primary:focus-visible{outline:2px solid #1565C0;outline-offset:2px}
.ai-dot{width:7px;height:7px;border-radius:50%;background:#F79009}
.ai-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px;align-items:start}
.ai-card{background:#fff;border:1px solid #E4E7EC;border-radius:16px;box-shadow:0 1px 3px rgba(16,24,40,.06);padding:18px}
.ai-items{container-type:inline-size}
.ai-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
.ai-card-title{display:flex;align-items:center;gap:10px;margin:0;font-size:16px;font-weight:600;color:#001F3F}
.ai-card-title svg{color:#1565C0;flex:none}
.ai-card-blurb{margin:0 0 14px;color:#667085;font-size:13px}
.ai-side{display:flex;flex-direction:column;gap:20px;position:sticky;top:16px}
.ai-colhead,.ai-grid{display:grid;gap:8px;align-items:start}
.is-material .ai-grid,.ai-colhead.is-material{grid-template-columns:minmax(130px,1fr) 80px 84px 96px 100px 28px}
.is-product .ai-grid,.ai-colhead.is-product{grid-template-columns:minmax(130px,1fr) 96px 100px 100px 28px}
.ai-colhead{padding:8px 0;border-bottom:1px solid #E4E7EC;font-size:11px;font-weight:600;color:#667085;text-transform:uppercase;letter-spacing:.03em}
.ai-row{padding:14px 0;border-bottom:1px solid #F2F4F7}
.ai-cell{min-width:0}
.ai-mlabel{display:none;font-size:11px;font-weight:600;color:#667085;text-transform:uppercase;margin-bottom:4px}
.ai-input{width:100%;height:40px;padding:0 10px;border:1px solid #D0D5DD;border-radius:8px;font:400 14px/1 inherit;font-family:inherit;color:#101828;background:#fff;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}
.ai-input::placeholder{color:#98A2B3}
.ai-input:focus{outline:none;border-color:#1565C0;box-shadow:0 0 0 3px rgba(21,101,192,.15)}
.ai-input:disabled{background:#F2F4F7;color:#667085;cursor:not-allowed}
.ai-input.is-invalid{border-color:#D92D20;background:#FFFBFA}
.ai-input.is-invalid:focus{box-shadow:0 0 0 3px rgba(217,45,32,.15)}
select.ai-input{padding-right:6px}
.ai-err{display:block;margin-top:4px;font-size:12px;color:#D92D20}
.ai-total{height:40px;display:flex;align-items:center;font-weight:600;font-size:14px;white-space:nowrap}
.ai-icon-btn{height:40px;width:28px;display:flex;align-items:center;justify-content:center;border:0;background:none;color:#98A2B3;border-radius:8px;cursor:pointer}
.ai-icon-btn:hover{color:#D92D20;background:#FEF3F2}
.ai-hint{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px;font-size:12.5px;color:#475467}
.ai-tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
.ai-tag.is-existing{background:#ECFDF3;color:#067647}
.ai-tag.is-new{background:#EFF8FF;color:#175CD3}
.ai-link{background:none;border:0;padding:0;color:#1565C0;font:500 12.5px/1.4 inherit;font-family:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.ai-yield{margin-top:6px}
.ai-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;padding:10px 12px;background:#EFF8FF;border:1px solid #B2DDFF;border-radius:10px;color:#175CD3;font-size:13px}
.ai-stickybar{position:sticky;bottom:0;z-index:20;display:flex;justify-content:space-between;align-items:center;gap:12px;margin:16px -18px -18px;padding:12px 18px;background:rgba(255,255,255,.96);border-top:1px solid #E4E7EC;border-radius:0 0 16px 16px;font-size:14px}
.ai-primary-sm{width:auto;height:40px;margin:0;padding:0 22px;font-size:14px}
.ai-yield-body{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px;padding:10px 12px;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:10px;font-size:13px;color:#475467}
.ai-inline{display:inline-flex;align-items:center;gap:6px;color:#475467}
.ai-min{width:76px;height:32px;padding:0 8px}
.ai-sell{width:100px;height:32px;padding:0 8px}
.ai-cat{width:170px;height:32px;padding:0 8px}
.ai-yield-unit{width:130px}
.ai-yield-amt{width:110px}
.ai-picker{position:relative}
.ai-picker-list{position:absolute;top:calc(100% + 4px);left:0;right:0;min-width:260px;z-index:30;background:#fff;border:1px solid #E4E7EC;border-radius:10px;box-shadow:0 8px 24px rgba(16,24,40,.14);max-height:280px;overflow-y:auto}
.ai-picker-opt{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;border-bottom:1px solid #F2F4F7}
.ai-picker-opt.is-active{background:#EFF6FF}
.ai-code{font:700 11px/1 ui-monospace,Consolas,monospace;color:#1565C0;background:#DBEAFE;border-radius:4px;padding:3px 6px;min-width:36px;text-align:center}
.ai-picker-name{flex:1;font-size:14px;font-weight:500;color:#1D2939;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-picker-meta{font-size:12px;color:#667085;white-space:nowrap}
.ai-picker-new{padding:9px 12px;font-size:12.5px;color:#475467;background:#F9FAFB}
.ai-add{width:100%;margin-top:12px;padding:12px;border:1.5px dashed #B2CCFF;background:#F5F9FF;color:#1565C0;font:600 14px/1 inherit;font-family:inherit;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.ai-add:hover{background:#EFF6FF;border-color:#84ADFF}
.ai-banner{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:10px 12px;background:#FEF3F2;border:1px solid #FECDCA;border-radius:10px;color:#B42318;font-size:13px}
.ai-label{display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:#344054}
.ai-field{margin-bottom:14px}
.ai-field:last-child{margin-bottom:0}
.ai-help{margin:6px 0 0;font-size:12px;color:#667085;line-height:1.45}
.ai-sum-row{display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;font-size:14px;color:#475467}
.ai-sum-total{margin-top:6px;padding-top:12px;border-top:1px solid #E4E7EC;font-size:20px;font-weight:700;color:#101828}
.ai-owed{color:#B54708;font-weight:600}
.ai-chips{display:flex;gap:8px;margin-top:8px}
.ai-chip{padding:6px 12px;border:1px solid #D0D5DD;background:#fff;border-radius:999px;font:500 12.5px/1 inherit;font-family:inherit;color:#344054;cursor:pointer}
.ai-chip:hover:not(:disabled){border-color:#1565C0;color:#1565C0}
.ai-chip:disabled{opacity:.5;cursor:not-allowed}
.ai-primary{width:100%;height:46px;margin-top:16px;border:0;border-radius:10px;background:#1565C0;color:#fff;font:600 15px/1 inherit;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px}
.ai-primary:hover:not(:disabled){background:#0F4F9A}
.ai-primary:disabled{opacity:.65;cursor:not-allowed}
.ai-spin{animation:ai-spin .8s linear infinite}
@keyframes ai-spin{to{transform:rotate(360deg)}}
@container (max-width:520px){
  .ai-colhead{display:none}
  .ai-mlabel{display:block}
  .is-material .ai-grid,.is-product .ai-grid{grid-template-columns:1fr 1fr}
  .ai-c-name{grid-column:1 / -1}
  .ai-c-del{grid-column:2;justify-self:end}
}
@media (max-width:1260px){
  .ai-layout{grid-template-columns:minmax(0,1fr)}
  .ai-side{position:static}
}
@media (max-width:640px){
  .ai-page{padding:20px 16px 48px}
}
@media (prefers-reduced-motion:reduce){
  .ai-spin{animation:none}
  .ai-input,.ai-tab{transition:none}
}
`;

const AddRawMaterials = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Arrived here via "Reorder" on the Inventory page — Inventory Dashboard.jsx
  // passes the item's name/unit/category so the row is ready to fill in a
  // quantity and price, instead of retyping what's already known.
  const reorderFrom = location.state?.reorder || null;

  // "ingredient" = raw material, "product" = resale product, "supply" = hotel supplies
  const [itemType, setItemType] = useState(reorderFrom?.itemType || "ingredient");

  // Each tab keeps its own rows, so switching tabs never loses or mixes up work.
  const [rowsByType, setRowsByType] = useState(() => {
    const prefilled = reorderFrom ? { ...blankMaterial(), rm_name: reorderFrom.name, unit: reorderFrom.unit } : null;
    const startType = reorderFrom?.itemType || "ingredient";
    return {
      ingredient: startType === "ingredient" && prefilled ? [prefilled] : [blankMaterial()],
      product: [blankProduct()],
      supply: startType === "supply" && prefilled ? [prefilled] : [blankMaterial()],
    };
  });
  const rows = rowsByType[itemType];
  const [focusKey, setFocusKey] = useState(reorderFrom ? rowsByType[reorderFrom.itemType || "ingredient"][0].key : null);

  // Consume the reorder prefill once — a later refresh or back-navigation to
  // this same history entry shouldn't keep re-triggering it.
  useEffect(() => {
    if (reorderFrom) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [availableProducts, setAvailableProducts] = useState([]);
  const [availableMaterials, setAvailableMaterials] = useState([]);

  const [isNewSupplier, setIsNewSupplier] = useState(false);
  const [supplier, setSupplier] = useState({ sup_name: "", sup_email: "", sup_contact: "", sup_address: "" });
  const [existingSuppliers, setExistingSuppliers] = useState([]);
  const [branches, setBranches] = useState([]);

  const [paymentByType, setPaymentByType] = useState({ ingredient: "", product: "", supply: "" });
  const paymentAmount = paymentByType[itemType];
  const setPaymentAmount = (value) => setPaymentByType((prev) => ({ ...prev, [itemType]: value }));
  const [paymentMethod, setPaymentMethod] = useState("cash");

  const [draftRestored, setDraftRestored] = useState(false);
  const pendingSupplier = useRef(null);

  const [attempted, setAttempted] = useState(false);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const [isSaving, setIsSaving] = useState(false);
  // A dismissible confirmation after save — optional, never blocks the next
  // line item from being typed the way a required modal would.
  const [receipt, setReceipt] = useState(null);

  // --- network helpers ---
  const fetchWithAuth = (url, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (!headers["Content-Type"] && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(url, { ...opts, headers, credentials: "include" });
  };

  const extractArray = (data) => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.suppliers)) return data.suppliers;
    if (Array.isArray(data.branches)) return data.branches;
    return [];
  };

  async function parseBody(res) {
    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, body: JSON.parse(text) };
    } catch {
      return { ok: res.ok, status: res.status, body: text };
    }
  }

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
  };
  const closeToast = useCallback(() => setToast((t) => ({ ...t, show: false })), []);

  const fetchSuppliers = async () => {
    try {
      const res = await fetchWithAuth("/api/suppliers", { method: "GET" });
      if (res.status === 401) {
        showToast("Session expired — please login", "error");
        setExistingSuppliers([]);
        return;
      }
      if (res.status === 403) {
        showToast("You don't have permission to view suppliers", "error");
        setExistingSuppliers([]);
        return;
      }
      if (!res.ok) {
        showToast(`Failed to load suppliers (${res.status})`, "error");
        setExistingSuppliers([]);
        return;
      }
      const data = await res.json().catch(() => []);
      setExistingSuppliers(extractArray(data));
    } catch (err) {
      console.error("Error fetching suppliers:", err);
      setExistingSuppliers([]);
    }
  };

  const fetchBranches = async () => {
    try {
      const res = await fetchWithAuth("/api/branches", { method: "GET" });
      if (!res.ok) {
        setBranches([]);
        return;
      }
      const data = await res.json().catch(() => []);
      setBranches(extractArray(data));
    } catch (err) {
      console.error("Error fetching branches:", err);
      setBranches([]);
    }
  };

  const [categories, setCategories] = useState([]);

  const fetchProducts = async () => {
    try {
      const res = await fetchWithAuth("/api/products", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json().catch(() => []);
      setAvailableProducts(Array.isArray(data) ? data : []);
    } catch {
      setAvailableProducts([]);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetchWithAuth("/api/categories", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json().catch(() => []);
      setCategories(Array.isArray(data) ? data : extractArray(data));
    } catch {
      setCategories([]);
    }
  };

  const fetchMaterials = async () => {
    try {
      const res = await fetchWithAuth("/api/raw-materials", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json().catch(() => []);
      setAvailableMaterials(Array.isArray(data) ? data : extractArray(data));
    } catch {
      setAvailableMaterials([]);
    }
  };

  useEffect(() => {
    fetchSuppliers();
    fetchBranches();
    fetchProducts();
    fetchMaterials();
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- what is already in inventory ---
  const materialsByName = useMemo(() => {
    const map = new Map();
    for (const m of availableMaterials) if (m.rm_name && !map.has(lower(m.rm_name))) map.set(lower(m.rm_name), m);
    return map;
  }, [availableMaterials]);

  // Made-to-order dishes have no stock to receive, so they are not offered.
  const buyableProducts = useMemo(
    () => availableProducts.filter((p) => p.track_inventory !== false),
    [availableProducts],
  );
  const productsById = useMemo(() => new Map(buyableProducts.map((p) => [String(p.pro_id), p])), [buyableProducts]);

  const pickerItems = useMemo(() => {
    if (itemType === "product") {
      return buyableProducts.map((p) => ({
        key: p.pro_id, code: code(p.pro_id), name: p.pro_name || "", raw: p,
        meta: `storeroom ${showNum(Number(p.pro_qty) || 0)}`,
      }));
    }
    return availableMaterials
      .filter((m) => categoryOf(m) === itemType)
      .map((m) => ({
        key: m.rm_id, code: code(m.rm_id), name: m.rm_name || "", raw: m,
        meta: `${m.unit} · stock ${showNum(Number(m.stock_qty) || 0)}`,
      }));
  }, [itemType, availableMaterials, buyableProducts]);

  const matchFor = (row) => {
    if (itemType === "product") return row.pro_id ? productsById.get(String(row.pro_id)) || null : null;
    const m = materialsByName.get(lower(row.rm_name));
    return m && categoryOf(m) === itemType ? m : null;
  };

  // --- row editing ---
  const updateRows = (update) => setRowsByType((prev) => ({ ...prev, [itemType]: update(prev[itemType]) }));

  const patchRow = (key, patch) => updateRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const changeName = (row, text) => {
    if (itemType === "product") {
      patchRow(row.key, { pro_name: text, pro_id: "" });
      return;
    }
    // Typing the full name of an item you already stock takes its unit.
    const m = materialsByName.get(lower(text));
    const known = m && categoryOf(m) === itemType;
    patchRow(row.key, { rm_name: text, ...(known ? { unit: m.unit, yield_unit: "", yield_amount: "" } : {}) });
  };

  const pickItem = (row, item) => {
    if (itemType === "product") {
      const cost = Number(item.raw.cost_price);
      patchRow(row.key, {
        pro_id: String(item.key),
        pro_name: item.name,
        ...(row.unit_price === "" && cost > 0 ? { unit_price: String(cost) } : {}),
      });
    } else {
      patchRow(row.key, { rm_name: item.name, unit: item.raw.unit || row.unit, yield_unit: "", yield_amount: "" });
    }
  };

  // Leaving a product box after typing a name that matches exactly counts as choosing it.
  const commitName = (row, text) => {
    if (itemType !== "product" || row.pro_id) return;
    const hit = buyableProducts.find((p) => lower(p.pro_name) === lower(text));
    if (hit) pickItem(row, { key: hit.pro_id, name: hit.pro_name, raw: hit });
  };

  const focusRowName = (key) => {
    document.querySelector(`[data-row="${key}"] input[role="combobox"]`)?.focus();
  };

  const addRow = () => {
    // There is normally an empty line waiting at the bottom already.
    const last = rows[rows.length - 1];
    if (last && !isFilled(last, itemType)) {
      focusRowName(last.key);
      return;
    }
    const fresh = blankFor(itemType);
    updateRows((list) => [...list, fresh]);
    setFocusKey(fresh.key);
  };

  // Enter in the price box moves on to the next line's name.
  const goNext = (key) => {
    const next = rows[rows.findIndex((r) => r.key === key) + 1];
    if (next) focusRowName(next.key);
    else addRow();
  };

  // Like a spreadsheet: once the last line has something in it, a fresh empty one
  // appears beneath, so a long list never needs the Add button.
  useEffect(() => {
    const list = rowsByType[itemType];
    if (isFilled(list[list.length - 1], itemType)) {
      setRowsByType((prev) => ({ ...prev, [itemType]: [...prev[itemType], blankFor(itemType)] }));
    }
  }, [rowsByType, itemType]);

  // A long purchase is not lost to a refresh, a crash or a closed tab.
  const DRAFT_KEY = `inventory-purchase-draft:${user?.u_id ?? "anon"}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      const next = {};
      let any = false;
      for (const t of Object.keys(TABS)) {
        const kept = (Array.isArray(d.rows?.[t]) ? d.rows[t] : [])
          .map((r) => ({ ...blankFor(t), ...r, key: nextKey() }))
          .filter((r) => isFilled(r, t));
        if (kept.length) any = true;
        next[t] = [...kept, blankFor(t)];
      }
      if (!any) return;
      setRowsByType(next);
      pendingSupplier.current = d.supplierId ?? null;
      if (d.paymentByType) {
        setPaymentByType((prev) => ({
          ...prev,
          ...Object.fromEntries(Object.keys(TABS).map((t) => [t, d.paymentByType[t] ? String(d.paymentByType[t]) : ""])),
        }));
      }
      if (d.paymentMethod) setPaymentMethod(d.paymentMethod);
      setDraftRestored(true);
    } catch {
      // A damaged draft is simply ignored.
    }
    // Once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pendingSupplier.current == null || existingSuppliers.length === 0) return;
    const found = existingSuppliers.find((x) => String(x.sup_id) === String(pendingSupplier.current));
    if (found) setSupplier(found);
    pendingSupplier.current = null;
  }, [existingSuppliers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const out = {};
        let any = false;
        for (const t of Object.keys(TABS)) {
          out[t] = rowsByType[t].filter((r) => isFilled(r, t)).map(({ key: _key, ...rest }) => rest);
          if (out[t].length) any = true;
        }
        if (!any) localStorage.removeItem(DRAFT_KEY);
        else {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({
            rows: out, supplierId: supplier.sup_id ?? null, paymentByType, paymentMethod,
          }));
        }
      } catch {
        // Storage may be blocked or full; the draft just isn't kept.
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsByType, supplier.sup_id, paymentByType, paymentMethod]);

  const discardDraft = () => {
    setRowsByType({ ingredient: [blankMaterial()], product: [blankProduct()], supply: [blankMaterial()] });
    setSupplier({ sup_name: "", sup_email: "", sup_contact: "", sup_address: "" });
    setPaymentByType({ ingredient: "", product: "", supply: "" });
    setAttempted(false);
    setDraftRestored(false);
  };

  const removeRow = (key) =>
    updateRows((list) => (list.length > 1 ? list.filter((r) => r.key !== key) : [blankFor(itemType)]));

  const switchTab = (type) => {
    setItemType(type);
    setFocusKey(null);
  };

  const dirtyTabs = useMemo(
    () => Object.fromEntries(Object.keys(TABS).map((t) => [t, rowsByType[t].some((r) => isFilled(r, t))])),
    [rowsByType],
  );

  // Leaving with typed-in rows would lose them.
  useEffect(() => {
    if (!Object.values(dirtyTabs).some(Boolean)) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyTabs]);

  // --- money ---
  const totalCents = rows.reduce(
    (sum, r) => sum + cents(Math.max(0, Number(r.qty) || 0) * Math.max(0, Number(r.unit_price) || 0)),
    0,
  );
  const paidCents = cents(paymentAmount);
  const owedCents = Math.max(0, totalCents - paidCents);
  const filledCount = rows.filter((r) => isFilled(r, itemType)).length;

  // --- validation: everything the server would refuse, caught before anything is saved ---
  const validation = useMemo(() => {
    const rowErrors = {};
    const seen = new Map();
    const filled = [];

    for (const row of rows) {
      if (!isFilled(row, itemType)) continue;
      filled.push(row);
      const e = {};

      const name = (itemType === "product" ? row.pro_name : row.rm_name).trim();
      if (!name) e.name = "Enter the item's name";
      else if (name.length > MAX_NAME) e.name = `Keep the name under ${MAX_NAME} characters`;
      else if (itemType !== "product" && !/^[\w\s\-().&/]+$/.test(name)) {
        e.name = "Use letters, numbers, spaces and - ( ) . & / only";
      }

      if (name && !e.name) {
        const identity = itemType === "product" && row.pro_id ? `id:${row.pro_id}` : `name:${lower(name)}`;
        if (seen.has(identity)) e.name = "Already listed above — combine the quantities into one line";
        seen.set(identity, true);
      }

      if (name && !e.name && itemType !== "product") {
        const other = materialsByName.get(lower(name));
        if (other && categoryOf(other) !== itemType) {
          e.name = `“${other.rm_name}” already exists as ${categoryOf(other) === "supply" ? "a hotel supply" : "an ingredient"} — use that tab`;
        }
      }

      // A brand-new resale product carries its own selling price and warning level.
      if (itemType === "product" && !row.pro_id && !matchFor(row)) {
        if (row.sell_price !== "" && (!isNumber(row.sell_price) || Number(row.sell_price) <= 0 || Number(row.sell_price) > MAX_UNIT_PRICE)) {
          e.sell_price = "Enter a selling price";
        }
        if (row.low_stock !== "" && (!isNumber(row.low_stock) || !Number.isInteger(Number(row.low_stock)) || Number(row.low_stock) < 0)) {
          e.low_stock = "Whole number, 0 or more";
        }
      }

      if (itemType !== "product") {
        const match = matchFor(row);
        if (!(match ? match.unit : row.unit)) e.unit = "Choose a unit";
        if (!match) {
          if (row.record_level !== "" && (!isNumber(row.record_level) || Number(row.record_level) < 0 || Number(row.record_level) > MAX_MIN_STOCK)) {
            e.record_level = "Enter 0 or more";
          }
          const hasYU = Boolean(row.yield_unit);
          const hasYA = row.yield_amount !== "" && row.yield_amount != null;
          if (hasYU || hasYA) {
            if (!hasYU || !hasYA || !(Number(row.yield_amount) > 0)) e.yield = "Give both the recipe unit and how many it makes";
            else if (row.yield_unit === row.unit) e.yield = "The recipe unit is the same as the purchase unit";
          }
        }
      }

      if (!isNumber(row.qty) || Number(row.qty) <= 0) e.qty = "Enter a quantity";
      else if (Number(row.qty) > MAX_QTY) e.qty = `Max ${MAX_QTY.toLocaleString()}`;
      else if (itemType === "product" && !Number.isInteger(Number(row.qty))) e.qty = "Use a whole number";

      if (!isNumber(row.unit_price) || Number(row.unit_price) <= 0) e.unit_price = "Enter the price";
      else if (Number(row.unit_price) > MAX_UNIT_PRICE) e.unit_price = "That's too high";

      if (Object.keys(e).length) rowErrors[row.key] = e;
    }

    const supplierErrors = {};
    let cleanSupplier = null;
    if (isNewSupplier) {
      const name = (supplier.sup_name || "").trim();
      if (name.length < 2 || name.length > 120) supplierErrors.sup_name = "2–120 characters";
      else if (!/^[\w\s\-().&/,]+$/.test(name)) supplierErrors.sup_name = "Contains characters that aren't allowed";

      const contact = String(supplier.sup_contact || "").trim();
      if (!/^[0-9+\-\s()]{7,30}$/.test(contact)) supplierErrors.sup_contact = "7–30 digits (+ - ( ) and spaces allowed)";

      const email = (supplier.sup_email || "").trim();
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150)) {
        supplierErrors.sup_email = "That doesn't look like an email address";
      } else if (email && existingSuppliers.some((s) => lower(s.sup_email) === lower(email))) {
        supplierErrors.sup_email = "A supplier with this email already exists — pick them from the list";
      }

      const address = (supplier.sup_address || "").trim();
      if (address.length > 100) supplierErrors.sup_address = "Keep it under 100 characters";

      if (!Object.keys(supplierErrors).length) {
        cleanSupplier = { sup_name: name, sup_email: email ? email.toLowerCase() : undefined, sup_contact: contact, sup_address: address || null };
      }
    } else if (!supplier.sup_id) {
      supplierErrors.sup_id = "Choose the supplier you bought from";
    }

    let payment = null;
    if (paymentAmount !== "") {
      if (!isNumber(paymentAmount) || Number(paymentAmount) < 0) payment = "Enter 0 or more";
      else if (paidCents > totalCents) payment = `That's more than the order total (${money(totalCents)})`;
    }

    const general = filled.length === 0 ? "Add at least one item before saving." : null;
    const errorCount = Object.values(rowErrors).reduce((n, e) => n + Object.keys(e).length, 0)
      + Object.keys(supplierErrors).length + (payment ? 1 : 0) + (general ? 1 : 0);

    return { rowErrors, filled, supplierErrors, cleanSupplier, payment, general, errorCount };
    // matchFor reads the same inputs listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, itemType, materialsByName, productsById, isNewSupplier, supplier, existingSuppliers, paymentAmount, paidCents, totalCents]);

  const shown = (obj) => (attempted ? obj : {});

  const focusFirstError = () => {
    setTimeout(() => {
      const el = document.querySelector(".ai-input.is-invalid");
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.focus?.({ preventScroll: true });
      }
    }, 0);
  };

  const chooseSupplier = (idText) => {
    const found = existingSuppliers.find((s) => String(s.sup_id) === idText);
    setSupplier(found || { sup_name: "", sup_email: "", sup_contact: "", sup_address: "" });
  };

  // --- saving ---
  const handleSubmit = async () => {
    if (isSaving) return;
    setAttempted(true);
    if (validation.errorCount > 0) {
      focusFirstError();
      return;
    }

    // Pick the branch: the signed-in user's, else the first the API returned.
    const branchCandidate = branches.length > 0 ? branches[0] : null;
    const branchId =
      user?.b_id ?? user?.B_id ?? branchCandidate?.B_id ?? branchCandidate?.b_id ?? branchCandidate?.id ?? null;
    if (!branchId) {
      showToast("No branch available — make sure your account is assigned to a branch.", "error");
      return;
    }

    setIsSaving(true);
    const made = { po: null, materials: [], products: [] };

    // If anything fails part-way, take back what this save created so no
    // half-finished order or empty stock item is left behind. Deleting is
    // best-effort: the server refuses to remove anything that has been received
    // or holds stock, so it can never destroy real records.
    const undo = async () => {
      const quiet = (url) => fetchWithAuth(url, { method: "DELETE" }).catch(() => {});
      if (made.po) await quiet(`/api/purchase-orders/${made.po}`);
      for (const id of [...made.materials].reverse()) await quiet(`/api/raw-materials/${id}`);
      for (const id of [...made.products].reverse()) await quiet(`/api/products/${id}`);
    };

    try {
      // 1) supplier: reuse the chosen one, or create the new one
      let supId = supplier.sup_id;
      if (isNewSupplier) {
        const supRes = await parseBody(await fetchWithAuth("/api/suppliers", {
          method: "POST",
          body: JSON.stringify(validation.cleanSupplier),
        }));
        if (!supRes.ok) throw new Error(supRes.body?.message || `Supplier creation failed (${supRes.status})`);
        supId = supRes.body.sup_id;
        // From here on the supplier is a saved one, so a retry reuses it.
        const savedSupplier = { ...validation.cleanSupplier, ...supRes.body };
        setExistingSuppliers((list) => [...list, savedSupplier]);
        setSupplier(savedSupplier);
        setIsNewSupplier(false);
      }

      // 2) the purchase order, pending until every line is on it
      const poRes = await parseBody(await fetchWithAuth("/api/purchase-orders", {
        method: "POST",
        body: JSON.stringify({ sup_id: supId, B_id: Number(branchId), status: "pending" }),
      }));
      if (!poRes.ok) throw new Error(poRes.body?.message || `Failed to create Purchase Order (${poRes.status})`);
      const poId = poRes.body.po_id;
      made.po = poId;

      // 3) its lines
      let saved = 0;
      for (const row of validation.filled) {
        const qty = Number(row.qty);
        const unitPrice = Number(row.unit_price);
        const line = { po_id: poId, qty, unit_price: unitPrice, price: cents(qty * unitPrice) / 100 };

        if (itemType === "product") {
          let proId = Number(row.pro_id);
          if (!proId) {
            const proRes = await parseBody(await fetchWithAuth("/api/products", {
              method: "POST",
              body: JSON.stringify({
                pro_name: row.pro_name.trim(),
                pro_qty: 0,
                // Selling price is what was typed; left blank it starts at cost and the
                // owner sets the real one under Products.
                pro_price: row.sell_price !== "" ? Number(row.sell_price) : unitPrice,
                cost_price: unitPrice,
                ...(row.low_stock !== "" ? { low_stock: Number(row.low_stock) } : {}),
                ...(row.cat_id ? { cat_id: Number(row.cat_id) } : {}),
                com_id: user?.com_id ?? undefined,
              }),
            }));
            if (!proRes.ok) throw new Error(proRes.body?.message || `Failed to create ${row.pro_name.trim()} (${proRes.status})`);
            proId = proRes.body.pro_id;
            made.products.push(proId);
          }
          line.pro_id = proId;
        } else {
          const name = row.rm_name.trim();
          let rm = materialsByName.get(lower(name));
          if (!rm) {
            const rmRes = await parseBody(await fetchWithAuth("/api/raw-materials", {
              method: "POST",
              body: JSON.stringify({
                rm_name: name,
                unit: row.unit,
                stock_qty: 0, // stock arrives when the order is received, below
                record_level: Number(row.record_level) || 0,
                B_id: Number(branchId),
                com_id: user?.com_id ?? undefined,
                item_category: itemType,
                yield_unit: row.yield_unit || undefined,
                yield_amount: Number(row.yield_amount) || undefined,
              }),
            }));
            if (rmRes.ok) {
              rm = rmRes.body;
              made.materials.push(rm.rm_id);
            } else if (rmRes.status === 409) {
              // Created by someone else since this page loaded.
              const list = await parseBody(await fetchWithAuth("/api/raw-materials", { method: "GET" }));
              const found = (Array.isArray(list.body) ? list.body : extractArray(list.body))
                .find((r) => lower(r.rm_name) === lower(name));
              if (!found) throw new Error(`“${name}” already exists but couldn't be found — refresh and try again`);
              rm = found;
            } else {
              throw new Error(rmRes.body?.message || `Failed to create ${name} (${rmRes.status})`);
            }
          }
          line.rm_id = rm.rm_id;
        }

        const piRes = await parseBody(await fetchWithAuth("/api/purchase-items", { method: "POST", body: JSON.stringify(line) }));
        if (!piRes.ok) throw new Error(piRes.body?.message || `Failed to add a line to the order (${piRes.status})`);
        saved += 1;
      }

      // 4) receive the order: stock goes up and any payment is recorded, together
      const statusRes = await parseBody(await fetchWithAuth(`/api/purchase-orders/${poId}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "received",
          ...(paidCents > 0 ? { payment: { amount: paidCents / 100, method: paymentMethod || "cash" } } : {}),
        }),
      }));
      if (!statusRes.ok) throw new Error(statusRes.body?.message || `Failed to receive the order (${statusRes.status})`);

      const owed = totalCents - paidCents;
      showToast(
        `Saved ${saved} item${saved === 1 ? "" : "s"}, stock updated. ${owed > 0 ? `${money(owed)} is owed to the supplier.` : "Paid in full."}`,
        "success",
      );

      // Optional, dismissible — printSupplierInvoice itself picks the right
      // framing (paid / partial / goods-received-on-credit) from the amounts.
      setReceipt({
        branchName: branchCandidate?.B_name || "",
        supplierName: supplier.sup_name,
        supplierContact: supplier.sup_contact,
        poId,
        items: validation.filled.map((row) => ({
          name: itemType === "product" ? row.pro_name : row.rm_name,
          qty: Number(row.qty),
          unit: itemType === "product" ? "units" : row.unit,
          lineTotal: cents(Number(row.qty) * Number(row.unit_price)) / 100,
        })),
        orderTotal: totalCents / 100,
        paidThisTime: paidCents / 100,
        paidToDate: paidCents / 100,
        method: paidCents > 0 ? paymentMethod : null,
        recordedBy: [user?.u_fname, user?.u_lname].filter(Boolean).join(" ") || user?.u_email || "",
      });

      setRowsByType((prev) => ({ ...prev, [itemType]: [blankFor(itemType)] }));
      setFocusKey(null);
      setPaymentAmount("");
      setAttempted(false);
      fetchSuppliers();
      fetchMaterials();
      fetchProducts();
    } catch (err) {
      console.error("Save failed:", err);
      await undo();
      showToast(`${err.message || "Something went wrong"} — nothing was saved.`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  // --- render ---
  const tab = TABS[itemType];
  const TabIcon = tab.icon;
  const isProduct = itemType === "product";
  const rowErrors = shown(validation.rowErrors);
  const supErr = shown(validation.supplierErrors);
  const payErr = validation.payment;
  const listSizeClass = isProduct ? "is-product" : "is-material";

  return (
    <div style={{ display: "flex", background: "#F9FAFB", minHeight: "100vh" }}>
      <style>{STYLES}</style>
      <Sidebar />
      {toast.show && <ToastMessage message={toast.message} type={toast.type} onClose={closeToast} />}
      {receipt && (
        <div style={{
          position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)",
        }}>
          <div style={{
            background: "#fff", padding: "28px", borderRadius: "20px", width: "100%", maxWidth: "420px",
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", textAlign: "center",
          }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{receipt.paidThisTime > 0 ? "✅" : "📦"}</div>
            <h3 style={{ margin: "0 0 6px 0", color: "#101828" }}>
              {receipt.paidThisTime > 0 ? "Purchase saved & paid" : "Purchase saved"}
            </h3>
            <p style={{ fontSize: "14px", color: "#667085", margin: "0 0 20px" }}>
              Order #{receipt.poId} from {receipt.supplierName} — {money(receipt.orderTotal * 100)}.
              {receipt.paidThisTime > 0
                ? receipt.paidThisTime >= receipt.orderTotal - 0.005 ? " Paid in full." : ` ${money((receipt.orderTotal - receipt.paidThisTime) * 100)} still owed.`
                : " Nothing paid yet — on credit."}
            </p>
            <div style={{ display: "flex", gap: "12px" }}>
              <button onClick={() => setReceipt(null)} style={{
                flex: 1, padding: "10px 16px", borderRadius: 10, border: "1px solid #D0D5DD",
                background: "#fff", color: "#344054", fontWeight: 600, cursor: "pointer",
              }}>
                Done
              </button>
              <button onClick={() => printSupplierInvoice(receipt)} style={{
                flex: 1, padding: "10px 16px", borderRadius: 10, border: "none",
                background: "#155EEF", color: "#fff", fontWeight: 600, cursor: "pointer",
              }}>
                🖨️ Print
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, marginLeft: "var(--sidebar-w, 240px)" }}>
        <Header title="Inventory Items" role="Branch Admin" />
        <main
          className="ai-page"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
        >
          <div className="ai-top">
            <div>
              <h1>Add Inventory Items</h1>
              <p className="ai-sub">Record what you bought from a supplier. Stock goes up when you save.</p>
            </div>
            <div className="ai-tabs" role="tablist" aria-label="What are you adding?">
              {Object.entries(TABS).map(([type, t]) => {
                const Icon = t.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    role="tab"
                    aria-selected={itemType === type ? "true" : "false"}
                    className="ai-tab"
                    onClick={() => switchTab(type)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {t.label}
                    {dirtyTabs[type] && itemType !== type && (
                      <span className="ai-dot" title="Has items you haven't saved" aria-label="has unsaved items" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ai-layout">
            {/* Items */}
            <section className="ai-card ai-items" role="tabpanel" aria-label={tab.label}>
              <div className="ai-card-head">
                <h2 className="ai-card-title"><TabIcon size={18} aria-hidden="true" />{tab.title}</h2>
              </div>
              <p className="ai-card-blurb">{tab.blurb}</p>

              {draftRestored && (
                <div className="ai-notice" role="status">
                  <span>We restored the purchase you were working on.</span>
                  <button type="button" className="ai-link" onClick={discardDraft}>Start over</button>
                </div>
              )}

              {attempted && validation.errorCount > 0 && (
                <div className="ai-banner" role="alert">
                  <CircleAlert size={16} aria-hidden="true" />
                  {validation.general
                    ? validation.general
                    : `Please fix the ${validation.errorCount === 1 ? "highlighted field" : `${validation.errorCount} highlighted fields`} to save.`}
                </div>
              )}

              <div className={`ai-colhead ${listSizeClass}`} aria-hidden="true">
                <span>Item</span>
                {!isProduct && <span>Unit</span>}
                <span>Quantity</span>
                <span>{isProduct ? "Cost price" : "Unit price"}</span>
                <span>Total</span>
                <span />
              </div>

              {rows.map((row) => (
                <PurchaseItemRow
                  key={row.key}
                  kind={itemType}
                  row={row}
                  match={matchFor(row)}
                  items={pickerItems}
                  units={VALID_UNITS}
                  categories={categories}
                  errors={rowErrors[row.key] || {}}
                  autoFocus={focusKey === row.key}
                  onPatch={(patch) => patchRow(row.key, patch)}
                  onNameChange={(text) => changeName(row, text)}
                  onPick={(item) => pickItem(row, item)}
                  onCommit={(text) => commitName(row, text)}
                  onRemove={() => removeRow(row.key)}
                  onNext={() => goNext(row.key)}
                />
              ))}

              <button type="button" className="ai-add" onClick={addRow}>
                <Plus size={16} aria-hidden="true" /> Add another item
              </button>

              {filledCount > 5 && (
                <div className="ai-stickybar">
                  <span><b>{filledCount}</b> items · <b>{money(totalCents)}</b></span>
                  <button type="button" className="ai-primary ai-primary-sm" onClick={handleSubmit} disabled={isSaving}>
                    {isSaving ? "Saving…" : "Save purchase"}
                  </button>
                </div>
              )}
            </section>

            {/* Supplier + summary */}
            <aside className="ai-side">
              <section className="ai-card">
                <div className="ai-card-head">
                  <h2 className="ai-card-title"><Truck size={18} aria-hidden="true" />Supplier</h2>
                  <button
                    type="button"
                    className="ai-link"
                    onClick={() => {
                      setIsNewSupplier((n) => !n);
                      setSupplier({ sup_name: "", sup_email: "", sup_contact: "", sup_address: "" });
                    }}
                  >
                    {isNewSupplier ? "Choose existing" : "+ New supplier"}
                  </button>
                </div>

                {!isNewSupplier ? (
                  <div>
                    <select
                      className={`ai-input${supErr.sup_id ? " is-invalid" : ""}`}
                      aria-label="Supplier"
                      value={supplier.sup_id || ""}
                      onChange={(e) => chooseSupplier(e.target.value)}
                    >
                      <option value="">Choose a supplier…</option>
                      {existingSuppliers.map((s) => <option key={s.sup_id} value={s.sup_id}>{s.sup_name}</option>)}
                    </select>
                    {supErr.sup_id && <span className="ai-err" role="alert">{supErr.sup_id}</span>}
                  </div>
                ) : (
                  <div>
                    {[
                      ["sup_name", "Supplier name *", "text", "e.g. Fresh Farm Traders"],
                      ["sup_contact", "Contact number *", "tel", "e.g. 0771234567"],
                      ["sup_email", "Email (optional)", "email", ""],
                      ["sup_address", "Address (optional)", "text", ""],
                    ].map(([field, label, type, placeholder]) => (
                      <div className="ai-field" key={field}>
                        <label className="ai-label" htmlFor={`sup-${field}`}>{label}</label>
                        <input
                          id={`sup-${field}`}
                          className={`ai-input${supErr[field] ? " is-invalid" : ""}`}
                          type={type}
                          placeholder={placeholder}
                          value={supplier[field] || ""}
                          onChange={(e) => setSupplier({ ...supplier, [field]: e.target.value })}
                        />
                        {supErr[field] && <span className="ai-err" role="alert">{supErr[field]}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="ai-card">
                <div className="ai-card-head">
                  <h2 className="ai-card-title"><Wallet size={18} aria-hidden="true" />Order summary</h2>
                </div>

                <div className="ai-sum-row"><span>Items</span><span>{filledCount}</span></div>
                <div className="ai-sum-row ai-sum-total"><span>Total</span><span>{money(totalCents)}</span></div>

                <div className="ai-field" style={{ marginTop: 16 }}>
                  <label className="ai-label" htmlFor="ai-paid">Paid now (LKR)</label>
                  <input
                    id="ai-paid"
                    className={`ai-input${payErr ? " is-invalid" : ""}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={paymentAmount}
                    onWheel={(e) => e.currentTarget.blur()}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                  />
                  {payErr && <span className="ai-err" role="alert">{payErr}</span>}
                  <div className="ai-chips">
                    <button type="button" className="ai-chip" disabled={totalCents === 0} onClick={() => setPaymentAmount((totalCents / 100).toFixed(2))}>
                      Pay in full
                    </button>
                    <button type="button" className="ai-chip" onClick={() => setPaymentAmount("")}>
                      Pay later
                    </button>
                  </div>
                </div>

                <div className="ai-field">
                  <label className="ai-label" htmlFor="ai-method">Payment method</label>
                  <select
                    id="ai-method"
                    className="ai-input"
                    value={paymentMethod}
                    disabled={paidCents === 0}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    {PAY_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>

                <div className="ai-sum-row">
                  <span>Still owed to supplier</span>
                  <span className={owedCents > 0 ? "ai-owed" : undefined}>{money(owedCents)}</span>
                </div>
                <p className="ai-help">Anything unpaid is added to the supplier's balance. You can pay it later from the Suppliers page.</p>
                <p className="ai-help">Tip: press Enter to move through the fields, and Ctrl+Enter to save.</p>

                <button type="button" className="ai-primary" onClick={handleSubmit} disabled={isSaving}>
                  {isSaving ? (
                    <><LoaderCircle size={18} className="ai-spin" aria-hidden="true" /> Saving…</>
                  ) : (
                    <>Save purchase{totalCents > 0 ? ` · ${money(totalCents)}` : ""}</>
                  )}
                </button>
              </section>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AddRawMaterials;
