import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import ExcelSheet from "../../components/branch-admin/ExcelSheet";
import ItemPicker from "../../components/branch-admin/ItemPicker";
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
    title: "Incoming ingredients",
    blurb: "Food and drink ingredients your recipes use. Stock goes up as soon as you save.",
  },
  product: {
    label: "Resale products",
    title: "Incoming resale products",
    blurb: "Things you buy ready-made and sell as they are, like bottled drinks. They go into the storeroom; put them on the menu from Menu / Products.",
  },
  supply: {
    label: "Hotel supplies",
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
.ai-shell{display:flex;background:#F2F4F7;min-height:100vh;font-family:'Inter',system-ui,sans-serif;color:#0B1220}
.ai-body{flex:1;min-width:0;margin-left:var(--sidebar-w,240px)}
.ai-page{display:flex;gap:22px;align-items:flex-start;padding:22px 28px 32px;max-width:1480px;margin:0 auto;box-sizing:border-box}
.ai-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
.ai-side{width:330px;flex:none;display:flex;flex-direction:column;gap:14px;position:sticky;top:16px}
.ai-top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.ai-top h1{margin:0;font-size:24px;font-weight:650;letter-spacing:-.02em}
.ai-sub{margin:4px 0 0;color:#64748B;font-size:13.5px;max-width:560px}
.ai-tabs{display:inline-flex;gap:2px;padding:3px;background:#E6EAF0;border-radius:11px;max-width:100%;overflow-x:auto}
.ai-tab{height:34px;padding:0 14px;border:0;border-radius:8px;background:transparent;color:#64748B;font:600 13px/1 inherit;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.ai-tab:hover{color:#0B1220}
.ai-tab[aria-selected="true"]{background:#fff;color:#0B1220;box-shadow:0 1px 2px rgba(11,18,32,.12)}
.ai-count{min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:#1D4ED8;color:#fff;font-size:11px;display:inline-flex;align-items:center;justify-content:center}
.ai-tab:focus-visible,.ai-link:focus-visible,.ai-seg button:focus-visible,.ai-pills:focus-visible,.ai-save:focus-visible,.ai-ghost:focus-visible{outline:2px solid #1D4ED8;outline-offset:2px}
.ai-supbar{display:flex;align-items:center;gap:14px;padding:12px 14px;background:#fff;border:1px solid #E4E8EE;border-radius:14px;box-shadow:0 1px 2px rgba(11,18,32,.04)}
.ai-supbar.is-invalid{border-color:#F04438;background:#FFFBFA}
.ai-supchip{width:40px;height:40px;border-radius:11px;background:#EEF1F5;color:#94A3B8;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:none}
.ai-supchip.is-on{background:#1D4ED8;color:#fff}
.ai-supfield{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.ai-supfield .ai-input{height:34px;border:0;padding:0;font-weight:600;font-size:16px;background:transparent;box-shadow:none}
.ai-supfield .ai-input:focus{box-shadow:none}
.ai-supfield .ai-input.is-invalid{background:transparent}
.ai-label-sm{font-size:11px;font-weight:600;color:#64748B;letter-spacing:.05em;text-transform:uppercase}
.ai-owedbefore{display:flex;flex-direction:column;align-items:flex-end;padding-left:14px;border-left:1px solid #EEF1F5;font-size:11px;color:#64748B;white-space:nowrap}
.ai-owedbefore b{font-size:14px;color:#0B1220}
.ai-owedbefore b.is-owed{color:#B45309}
.ai-suplink{white-space:nowrap}
.ai-newsup{flex:1;min-width:0;display:flex;gap:10px;flex-wrap:wrap}
.ai-newsup-f{display:flex;flex-direction:column;gap:4px;flex:1 1 130px;min-width:0}
.ai-newsup-f.ai-w-name{flex:2 1 200px}
.ai-input{width:100%;height:40px;padding:0 10px;border:1px solid #D5DBE4;border-radius:9px;font:400 14px/1 inherit;font-family:inherit;color:#0B1220;background:#fff;box-sizing:border-box}
.ai-input-sm{height:36px;font-size:13.5px}
.ai-input::placeholder{color:#A0AABA}
.ai-input:focus{outline:none;border-color:#1D4ED8;box-shadow:0 0 0 3px rgba(29,78,216,.14)}
.ai-input.is-invalid{border-color:#F04438;background:#FFFBFA}
.ai-err{display:block;font-size:12.5px;color:#B42318}
.ai-link{background:none;border:0;padding:0;color:#1D4ED8;font:600 13px/1.4 inherit;font-family:inherit;cursor:pointer}
.ai-link:hover{text-decoration:underline}
.ai-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:12px;color:#1E40AF;font-size:13px}
.ai-banner{padding:10px 14px;background:#FEF2F2;border:1px solid #FECDCA;border-radius:12px;color:#B42318;font-size:13px}
.ai-help{margin:0;font-size:12px;color:#64748B;line-height:1.5}
.ai-center{text-align:center}
.ai-totalcard{background:#0B1220;color:#fff;border-radius:16px;padding:20px 22px;display:flex;flex-direction:column;gap:12px}
.ai-totalcard-top{display:flex;justify-content:space-between;font-size:12px;color:#94A3B8}
.ai-totalcard-big{font-size:32px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.1)}
.ai-totalcard-line{display:flex;justify-content:space-between;font-size:13px;color:#94A3B8}
.ai-totalcard-line b{color:#fff;font-variant-numeric:tabular-nums}
.ai-totalcard-line b.is-owed{color:#FBBF24}
.ai-totalcard-line b.is-clear{color:#4ADE80}
.ai-paycard{background:#fff;border:1px solid #E4E8EE;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:14px}
.ai-seg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;padding:3px;background:#EEF1F5;border-radius:11px}
.ai-seg button{height:36px;border:0;border-radius:8px;background:transparent;font:600 13px Inter,system-ui,sans-serif;color:#64748B;cursor:pointer}
.ai-seg button.is-on{background:#fff;color:#0B1220;box-shadow:0 1px 2px rgba(11,18,32,.12)}
.ai-seg button:disabled{opacity:.5;cursor:not-allowed}
.ai-paid{display:flex;flex-direction:column;gap:6px}
.ai-moneyfield{display:flex;align-items:center;height:46px;border:1px solid #D5DBE4;border-radius:11px;padding:0 14px;gap:8px;background:#fff}
.ai-moneyfield:focus-within{border-color:#1D4ED8;box-shadow:0 0 0 3px rgba(29,78,216,.14)}
.ai-moneyfield.is-invalid{border-color:#F04438}
.ai-moneyfield>span{font-size:12px;font-weight:600;color:#94A3B8}
.ai-moneyfield input{flex:1;min-width:0;border:0;outline:none;text-align:right;font:600 17px Inter,system-ui,sans-serif;color:#0B1220;background:transparent}
.ai-methods{display:flex;flex-direction:column;gap:6px}
.ai-methods.is-off .ai-pills{opacity:.45}
.ai-pills{display:flex;flex-wrap:wrap;gap:6px;border-radius:10px}
.ai-pills button{height:32px;padding:0 12px;border-radius:999px;border:1px solid #D5DBE4;background:#fff;color:#334155;font:600 12.5px Inter,system-ui,sans-serif;cursor:pointer}
.ai-pills button.is-on{background:#0B1220;border-color:#0B1220;color:#fff}
.ai-pills button:disabled{cursor:not-allowed}
.ai-save{height:52px;border:0;border-radius:12px;background:#1D4ED8;color:#fff;font:600 15px Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;width:100%}
.ai-save:hover:not(:disabled){background:#1E40AF}
.ai-save:disabled{opacity:.65;cursor:wait}
.ai-save kbd{font:600 11px ui-monospace,Consolas,monospace;padding:2px 6px;border-radius:5px;background:rgba(255,255,255,.18)}
.ai-ghost{height:44px;padding:0 18px;border-radius:11px;border:1px solid #D5DBE4;background:#fff;color:#334155;font:600 14px Inter,system-ui,sans-serif;cursor:pointer}
.ai-spin{animation:ai-spin .8s linear infinite}
@keyframes ai-spin{to{transform:rotate(360deg)}}
.ai-modal-back{position:fixed;inset:0;background:rgba(11,18,32,.45);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(3px)}
.ai-modal{background:#fff;padding:28px;border-radius:18px;width:100%;max-width:440px;box-shadow:0 24px 60px rgba(11,18,32,.25);text-align:center;display:flex;flex-direction:column;gap:10px}
.ai-modal h3{margin:0;font-size:20px}
.ai-modal p{margin:0 0 8px;font-size:14px;color:#475569;line-height:1.5}
.ai-modal-tick{width:52px;height:52px;border-radius:50%;background:#ECFDF3;color:#067647;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;align-self:center}
.ai-modal-actions{display:flex;gap:10px}
.ai-modal-actions .ai-ghost{flex:1;height:48px}
.ai-modal-actions .ai-save{flex:2;height:48px}
.ai-picker{position:relative}
.ai-picker-list{position:absolute;top:calc(100% + 6px);left:-54px;min-width:420px;z-index:30;background:#fff;border:1px solid #D5DBE4;border-radius:12px;box-shadow:0 16px 40px rgba(11,18,32,.16);max-height:300px;overflow-y:auto}
.ai-picker-opt{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #F2F4F7}
.ai-picker-opt.is-active{background:#EEF3FE}
.ai-code{display:none}
.ai-picker-name{flex:1;font-size:14px;font-weight:500;color:#0B1220;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-picker-meta{font-size:12px;color:#64748B;white-space:nowrap}
.ai-picker-new{padding:10px 14px;font-size:13px;color:#1D4ED8;background:#fff;cursor:pointer}
.ai-picker-new.is-active{background:#EEF3FE}
@media (max-width:1440px){.ai-side{width:300px}.ai-page{padding:20px 20px 28px;gap:18px}}
@media (max-width:1180px){.ai-page{flex-direction:column}.ai-side{width:100%;position:static}}
@media (max-width:640px){.ai-page{padding:16px}.ai-supbar{flex-wrap:wrap}}
@media (prefers-reduced-motion:reduce){.ai-spin{animation:none}}
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
  // What is typed in the supplier box (keyboard-only entry, see afterSupplier).
  const [supplierText, setSupplierText] = useState("");
  const [branches, setBranches] = useState([]);
  // { sup_id: balance due } — shown beside the chosen supplier.
  const [balances, setBalances] = useState({});
  // Select a cell in the sheet (the first mistake, when saving is refused).
  const [jump, setJump] = useState(null);

  const [paymentByType, setPaymentByType] = useState({ ingredient: "", product: "", supply: "" });
  const paymentAmount = paymentByType[itemType];
  const setPaymentAmount = (value) => setPaymentByType((prev) => ({ ...prev, [itemType]: value }));
  const [paymentMethod, setPaymentMethod] = useState("cash");

  const [draftRestored, setDraftRestored] = useState(false);
  const pendingSupplier = useRef(null);

  const [attempted, setAttempted] = useState(false);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const [isSaving, setIsSaving] = useState(false);
  // Set at once, unlike isSaving: a second Ctrl+Enter in the same moment must
  // not save the purchase twice.
  const savingNow = useRef(false);
  // The newest handleSubmit, for the sheet: Ctrl+Enter while typing in a cell
  // saves after that cell is put in, so it needs the save that can see it.
  const submitRef = useRef(null);
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

  const fetchBalances = async () => {
    try {
      const res = await fetchWithAuth("/api/suppliers/ledger", { method: "GET" });
      if (!res.ok) return;
      const rows = await res.json().catch(() => []);
      setBalances(Object.fromEntries((Array.isArray(rows) ? rows : []).map((x) => [x.sup_id, Number(x.balance_due) || 0])));
    } catch { /* the balance is only shown, never needed */ }
  };

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
    fetchBalances();
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
        meta: "",
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
      // What it cost last time, ready to keep or type over.
      const last = Number(item.raw.last_price);
      patchRow(row.key, {
        rm_name: item.name, unit: item.raw.unit || row.unit, yield_unit: "", yield_amount: "",
        ...(row.unit_price === "" && last > 0 ? { unit_price: String(last) } : {}),
      });
    }
  };

  // Leaving a product box after typing a name that matches exactly counts as choosing it.
  const commitName = (row, text) => {
    if (itemType !== "product" || row.pro_id) return;
    const hit = buyableProducts.find((p) => lower(p.pro_name) === lower(text));
    if (hit) pickItem(row, { key: hit.pro_id, name: hit.pro_name, raw: hit });
  };

  // Rows pasted from Excel: written over the sheet from the line pasted into,
  // each matched to an item already stocked (its unit and last price come
  // with it) or left as a new item to check.
  const pasteRows = (startKey, lines) => {
    updateRows((list) => {
      const out = [...list];
      let at = out.findIndex((r) => r.key === startKey);
      if (at < 0) at = out.length - 1;
      let fresh = 0;
      for (const l of lines) {
        const keep = out[at]?.key ?? nextKey();
        let row;
        if (itemType === "product") {
          const hit = buyableProducts.find((pr) => lower(pr.pro_name) === lower(l.name));
          if (!hit) fresh += 1;
          row = {
            ...blankProduct(), key: keep,
            pro_id: hit ? String(hit.pro_id) : "", pro_name: hit ? hit.pro_name : l.name,
            qty: l.qty === "" ? "" : String(l.qty),
            unit_price: l.price !== "" ? String(l.price) : (Number(hit?.cost_price) > 0 ? String(hit.cost_price) : ""),
          };
        } else {
          const m = materialsByName.get(lower(l.name));
          const known = m && categoryOf(m) === itemType;
          if (!known) fresh += 1;
          row = {
            ...blankMaterial(), key: keep,
            rm_name: known ? m.rm_name : l.name,
            unit: known ? m.unit : (l.unit || ""),
            qty: l.qty === "" ? "" : String(l.qty),
            unit_price: l.price !== "" ? String(l.price) : (known && Number(m.last_price) > 0 ? String(m.last_price) : ""),
          };
        }
        out[at] = row;
        at += 1;
      }
      setTimeout(() => showToast(
        `Pasted ${lines.length} line${lines.length === 1 ? "" : "s"}` +
        (fresh ? ` — ${fresh} not in your items yet (marked "new"), check their names` : ""),
        fresh ? "warning" : "success"), 0);
      return out;
    });
  };

  const focusSheet = () => document.getElementById("ai-sheet")?.focus();




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
    if (found) { setSupplier(found); setSupplierText(found.sup_name || ""); }
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
    setSupplierText("");
    setPaymentByType({ ingredient: "", product: "", supply: "" });
    setAttempted(false);
    setDraftRestored(false);
  };

  const removeRow = (key) =>
    updateRows((list) => (list.length > 1 ? list.filter((r) => r.key !== key) : [blankFor(itemType)]));

  const switchTab = (type) => {
    setItemType(type);
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
        else if (!match && !VALID_UNITS.includes(row.unit)) e.unit = `Use one of: ${VALID_UNITS.join(", ")}`;
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
      if (contact && !/^[0-9+\-\s()]{7,30}$/.test(contact)) supplierErrors.sup_contact = "7–30 digits (+ - ( ) and spaces allowed)";

      const email = (supplier.sup_email || "").trim();
      if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150)) {
        supplierErrors.sup_email = "That doesn't look like an email address";
      } else if (email && existingSuppliers.some((s) => lower(s.sup_email) === lower(email))) {
        supplierErrors.sup_email = "A supplier with this email already exists — pick them from the list";
      }

      const address = (supplier.sup_address || "").trim();
      if (address.length > 100) supplierErrors.sup_address = "Keep it under 100 characters";

      if (!Object.keys(supplierErrors).length) {
        cleanSupplier = { sup_name: name, sup_email: email ? email.toLowerCase() : undefined, sup_contact: contact || undefined, sup_address: address || undefined };
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
    // A line with a mistake: select that cell in the sheet.
    const firstRow = rows.find((r) => validation.rowErrors[r.key]);
    if (firstRow) {
      const e = validation.rowErrors[firstRow.key];
      const col = e.name ? "name" : e.unit ? "unit" : e.qty ? "qty" : e.unit_price ? "price" : "name";
      setJump({ key: firstRow.key, col, tick: Date.now() });
      return;
    }
    setTimeout(() => {
      const el = document.querySelector(".ai-input.is-invalid, .ai-moneyfield.is-invalid input");
      if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.focus?.({ preventScroll: true }); }
    }, 0);
  };

  const chooseSupplier = (idText) => {
    const found = existingSuppliers.find((s) => String(s.sup_id) === idText);
    setSupplier(found || { sup_name: "", sup_email: "", sup_contact: "", sup_address: "" });
    setSupplierText(found ? found.sup_name : "");
  };

  // ── Keyboard only ──
  // The workers here use the keyboard alone, so the whole purchase is typed:
  // supplier, Enter, each line (Enter through its boxes), Enter on an empty
  // line, the amount paid, Enter to save.
  const supplierItems = useMemo(
    () => existingSuppliers.map((s) => ({ key: s.sup_id, code: "", name: s.sup_name || "", meta: s.sup_contact || "", raw: s })),
    [existingSuppliers],
  );
  // At once, not after a tick: a fast typist's next letter must land here.
  const focusFirstLine = () => focusSheet();
  const afterSupplier = () => {
    const text = supplierText.trim();
    if (!text) return;
    const known = existingSuppliers.find((s) => lower(s.sup_name) === lower(text));
    if (known) chooseSupplier(String(known.sup_id));
    else {
      // A supplier not on the list yet: the new-supplier form, name filled in.
      setIsNewSupplier(true);
      setSupplier({ sup_name: text, sup_email: "", sup_contact: "", sup_address: "" });
    }
    focusFirstLine();
  };
  const focusPaid = () => {
    if (filledCount === 0) return;
    document.getElementById("ai-paid")?.focus();
  };
  const onPaidKey = (e) => {
    if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      if (totalCents > 0) setPaymentAmount((totalCents / 100).toFixed(2));
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (Number(paymentAmount) > 0) document.getElementById("ai-method")?.focus();
      else handleSubmit();
    } else if (e.key === "l" || e.key === "L") {
      e.preventDefault();
      setPaymentAmount("");
    }
  };
  useEffect(() => {
    // Arriving from "Reorder", the item is already on the first line: its quantity is next.
    setTimeout(() => (reorderFrom
      ? document.getElementById("ai-sheet")
      : document.getElementById("ai-supplier")?.querySelector("input"))?.focus(), 0);
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- saving ---
  const handleSubmit = async () => {
    if (isSaving || savingNow.current) return;
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

    savingNow.current = true;
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
        setSupplierText(savedSupplier.sup_name || "");
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
      setPaymentAmount("");
      setAttempted(false);
      setDraftRestored(false);
      fetchSuppliers();
      fetchBalances();
      fetchMaterials();
      fetchProducts();
    } catch (err) {
      console.error("Save failed:", err);
      await undo();
      showToast(`${err.message || "Something went wrong"} — nothing was saved.`, "error");
    } finally {
      savingNow.current = false;
      setIsSaving(false);
    }
  };
  submitRef.current = handleSubmit;

  // --- render ---
  const tab = TABS[itemType];
  const rowErrors = shown(validation.rowErrors);
  const supErr = shown(validation.supplierErrors);
  const payErr = validation.payment;
  const owedBefore = !isNewSupplier && supplier.sup_id ? Number(balances[supplier.sup_id] || 0) : 0;
  const supChosen = Boolean(supplier.sup_id) || (isNewSupplier && supplier.sup_name.trim());
  const supInitials = (supplier.sup_name || supplierText || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const fullyPaid = totalCents > 0 && paidCents === totalCents;
  const nothingPaid = totalCents > 0 && paidCents === 0;
  const methodIndex = Math.max(0, PAY_METHODS.findIndex(([v]) => v === paymentMethod));

  return (
    <div className="ai-shell">
      <style>{STYLES}</style>
      <Sidebar />
      {toast.show && <ToastMessage message={toast.message} type={toast.type} onClose={closeToast} />}
      {receipt && (
        <div className="ai-modal-back">
          <div className="ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
            <div className="ai-modal-tick" aria-hidden="true">✓</div>
            <h3 id="ai-modal-title">{receipt.paidThisTime > 0 ? "Purchase saved and paid" : "Purchase saved"}</h3>
            <p>
              Order #{receipt.poId} from {receipt.supplierName} — {money(receipt.orderTotal * 100)}.
              {receipt.paidThisTime > 0
                ? receipt.paidThisTime >= receipt.orderTotal - 0.005 ? " Paid in full." : ` ${money((receipt.orderTotal - receipt.paidThisTime) * 100)} still owed.`
                : " Nothing paid yet — on credit."}
            </p>
            <div className="ai-modal-actions">
              <button type="button" className="ai-ghost" onClick={() => printSupplierInvoice(receipt)}>Print</button>
              <button type="button" className="ai-save" autoFocus onClick={() => {
                setReceipt(null);
                setTimeout(() => document.getElementById("ai-supplier")?.querySelector("input")?.focus(), 0);
              }}>Done · Enter</button>
            </div>
          </div>
        </div>
      )}
      <div className="ai-body">
        <Header title="Inventory Items" role="Branch Admin" />
        <main
          className="ai-page"
          onKeyDown={(e) => {
            // The sheet handles its own Ctrl+Enter and marks it handled.
            if (e.defaultPrevented) return;
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
        >
          <div className="ai-main">
            <div className="ai-top">
              <div>
                <h1>Add inventory items</h1>
                <p className="ai-sub">{tab.blurb}</p>
              </div>
              <div className="ai-tabs" role="tablist" aria-label="What are you adding?">
                {Object.entries(TABS).map(([type, t]) => {
                  const n = rowsByType[type].filter((r) => isFilled(r, type)).length;
                  return (
                    <button key={type} type="button" role="tab" aria-selected={itemType === type ? "true" : "false"} className="ai-tab" onClick={() => switchTab(type)}>
                      {t.label}
                      {n > 0 && <span className="ai-count" aria-label={`${n} unsaved`}>{n}</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {draftRestored && (
              <div className="ai-notice" role="status">
                <span>We kept the purchase you were typing.</span>
                <button type="button" className="ai-link" onClick={discardDraft}>Start over</button>
              </div>
            )}

            <section className={`ai-supbar${supErr.sup_id || supErr.sup_name ? " is-invalid" : ""}`} aria-label="Supplier">
              <div className={`ai-supchip${supChosen ? " is-on" : ""}`} aria-hidden="true">{isNewSupplier ? "+" : (supChosen ? supInitials : "?")}</div>
              {!isNewSupplier ? (
                <div className="ai-supfield" id="ai-supplier">
                  <span className="ai-label-sm">Supplier</span>
                  <ItemPicker
                    value={supplierText}
                    items={supplierItems}
                    placeholder="Type to find a supplier, or a new name"
                    ariaLabel="Supplier"
                    invalid={Boolean(supErr.sup_id)}
                    newLabel="supplier"
                    onChange={(text) => {
                      setSupplierText(text);
                      const known = existingSuppliers.find((s) => lower(s.sup_name) === lower(text.trim()));
                      setSupplier(known || { sup_name: "", sup_email: "", sup_contact: "", sup_address: "" });
                    }}
                    onPick={(item) => { chooseSupplier(String(item.key)); focusFirstLine(); }}
                    onEnter={afterSupplier}
                  />
                </div>
              ) : (
                <div className="ai-newsup">
                  {[
                    ["sup_name", "New supplier", "text", "e.g. Fresh Farm Traders", "ai-w-name"],
                    ["sup_contact", "Phone (optional)", "tel", "0771234567", ""],
                    ["sup_email", "Email (optional)", "email", "orders@…", ""],
                    ["sup_address", "Address (optional)", "text", "Kandy", ""],
                  ].map(([field, label, type, placeholder, cls]) => (
                    <label key={field} className={`ai-newsup-f ${cls}`} htmlFor={`sup-${field}`}>
                      <span className="ai-label-sm">{label}</span>
                      <input
                        id={`sup-${field}`}
                        className={`ai-input ai-input-sm${supErr[field] ? " is-invalid" : ""}`}
                        type={type}
                        placeholder={placeholder}
                        value={supplier[field] || ""}
                        onChange={(e) => setSupplier({ ...supplier, [field]: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusFirstLine(); } }}
                        title={supErr[field] || undefined}
                      />
                    </label>
                  ))}
                </div>
              )}
              {!isNewSupplier && supplier.sup_id && (
                <div className="ai-owedbefore">
                  <span>Owed before this</span>
                  <b className={owedBefore > 0 ? "is-owed" : ""}>{owedBefore > 0 ? money(cents(owedBefore)) : "Nothing"}</b>
                </div>
              )}
              <button
                type="button"
                className="ai-link ai-suplink"
                onClick={() => {
                  setIsNewSupplier((n) => !n);
                  setSupplier({ sup_name: "", sup_email: "", sup_contact: "", sup_address: "" });
                  setSupplierText("");
                }}
              >
                {isNewSupplier ? "Choose existing" : "+ New supplier"}
              </button>
            </section>
            {(supErr.sup_id || supErr.sup_name || supErr.sup_contact || supErr.sup_email || supErr.sup_address) && (
              <span className="ai-err" role="alert">{supErr.sup_id || supErr.sup_name || supErr.sup_contact || supErr.sup_email || supErr.sup_address}</span>
            )}

            {attempted && validation.general && <div className="ai-banner" role="alert">{validation.general}</div>}

            <ExcelSheet
              kind={itemType}
              rows={rows}
              items={pickerItems}
              units={VALID_UNITS}
              categories={categories}
              errors={rowErrors}
              matchFor={matchFor}
              onNameChange={(key, text) => { const r = rows.find((x) => x.key === key); if (r) changeName(r, text); }}
              onPick={(key, item) => { const r = rows.find((x) => x.key === key); if (r) pickItem(r, item); }}
              onPatch={patchRow}
              onRemove={removeRow}
              onPaste={pasteRows}
              onRestore={(snapshot) => updateRows(() => snapshot)}
              onFinish={focusPaid}
              onSave={() => submitRef.current?.()}
              jumpTo={jump}
              startCol={reorderFrom ? (itemType === "product" ? 1 : 2) : 0}
            />
          </div>

          <aside className="ai-side" aria-label="Order summary and payment">
            <div className="ai-totalcard">
              <div className="ai-totalcard-top"><span>This purchase</span><span>{filledCount} item{filledCount === 1 ? "" : "s"}</span></div>
              <div className="ai-totalcard-big">{money(totalCents)}</div>
              <div className="ai-totalcard-line"><span>Paid now</span><b>{money(Math.min(paidCents, totalCents))}</b></div>
              <div className="ai-totalcard-line"><span>Still owed to supplier</span><b className={owedCents > 0 ? "is-owed" : "is-clear"}>{money(owedCents)}</b></div>
            </div>

            <div className="ai-paycard">
              <div className="ai-seg" role="group" aria-label="Payment">
                <button type="button" className={fullyPaid ? "is-on" : ""} disabled={totalCents === 0} onClick={() => setPaymentAmount((totalCents / 100).toFixed(2))}>Pay in full</button>
                <button type="button" className={nothingPaid ? "is-on" : ""} onClick={() => setPaymentAmount("")}>Pay later</button>
              </div>

              <label className="ai-paid" htmlFor="ai-paid">
                <span className="ai-label-sm">Paid now</span>
                <span className={`ai-moneyfield${payErr ? " is-invalid" : ""}`}>
                  <span>LKR</span>
                  <input
                    id="ai-paid"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value.replace(/,/g, "").replace(/[^0-9.]/g, ""))}
                    onKeyDown={onPaidKey}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </span>
              </label>
              {payErr && <span className="ai-err" role="alert">{payErr}</span>}

              <div className={`ai-methods${paidCents === 0 ? " is-off" : ""}`}>
                <span className="ai-label-sm" id="ai-method-label">Payment method</span>
                <div
                  id="ai-method"
                  role="radiogroup"
                  aria-labelledby="ai-method-label"
                  aria-disabled={paidCents === 0}
                  tabIndex={paidCents === 0 ? -1 : 0}
                  className="ai-pills"
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
                      setPaymentMethod(PAY_METHODS[(methodIndex + d + PAY_METHODS.length) % PAY_METHODS.length][0]);
                    } else if (e.key === "Enter" && !e.ctrlKey) { e.preventDefault(); handleSubmit(); }
                  }}
                >
                  {PAY_METHODS.map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={paymentMethod === v} tabIndex={-1} disabled={paidCents === 0} className={paymentMethod === v ? "is-on" : ""} onClick={() => setPaymentMethod(v)}>{l}</button>
                  ))}
                </div>
                {paidCents === 0 && <span className="ai-help">Nothing paid now, so there's no method to choose.</span>}
              </div>

              <button type="button" className="ai-save" onClick={handleSubmit} disabled={isSaving}>
                {isSaving ? <><LoaderCircle size={18} className="ai-spin" aria-hidden="true" /> Saving…</> : <>Save purchase <kbd>Ctrl ↵</kbd></>}
              </button>
              <p className="ai-help ai-center">Anything unpaid goes on the supplier's balance — pay it later from Suppliers.</p>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
};

export default AddRawMaterials;
