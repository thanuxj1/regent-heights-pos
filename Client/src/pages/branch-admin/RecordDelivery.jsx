// pages/branch-admin/RecordDelivery.jsx
//
// Record a delivery — the page behind "Add Inventory Item".
//
// The people who receive deliveries use the keyboard alone, and most
// deliveries are the same supplier bringing much the same things. So:
//   1. Who delivered? Type a few letters, Enter.
//   2. The sheet fills itself with what that supplier usually brings (their
//      last three deliveries), each line with last time's quantity as a hint
//      and last time's price filled in. Type today's quantities, Enter after
//      each. Lines left empty are simply not saved.
//   3. Anything else: the "+" line finds any item in stock by name, or adds a
//      new one (its type and unit asked once). Rows pasted from Excel land here
//      too.
//   4. F paid · P part · L on credit — the supplier's usual is chosen already.
//      Ctrl+Enter saves.
// One delivery can mix ingredients, resale products and hotel supplies: each
// line knows its type. It is saved exactly as the old page saved a purchase:
// one purchase order, its lines, then received (stock up, payment recorded).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import { useAuth } from "../../context/AuthContext";
import { printSupplierInvoice } from "../../utils/printSupplierInvoice";
import { parsePastedRows } from "../../components/branch-admin/PurchaseSheet";

const UNITS = ["kg", "g", "mg", "l", "ml", "pcs", "units", "dozen", "box", "pack", "bag", "bottle", "can"];
const TYPE_LABEL = { ingredient: "Ingredient", supply: "Hotel supply", resale: "Resale product" };
const TYPE_STYLE = {
  ingredient: { color: "#065F46", background: "#ECFDF5" },
  resale: { color: "#6D28D9", background: "#F5F3FF" },
  supply: { color: "#92400E", background: "#FFFBEB" },
};
const PAY_LABEL = { F: "Paid", P: "Part", L: "On credit" };
const METHODS = [["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["cheque", "Cheque"], ["card", "Card"]];
const NAME_OK = /^[\w\s\-().&/]+$/;

const lower = (s) => String(s ?? "").trim().toLowerCase();
const num = (v) => (v === "" || v == null ? 0 : Number(v) || 0);
const clean = (v) => String(v).replace(/,/g, "").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
const cents = (n) => Math.round((Number(n) || 0) * 100);
const fmt = (n) => Number(n || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n) => `LKR ${fmt(n)}`;
const show = (n) => String(Number(Number(n).toFixed(3)));
let seq = 0;
const nextKey = () => ++seq;

const STYLES = `
.rd{display:flex;background:#F5F6F8;min-height:100vh;font-family:'Inter',system-ui,sans-serif;color:#0F172A}
.rd-main{flex:1;min-width:0;margin-left:var(--sidebar-w,240px)}
.rd-page{padding:22px 28px 40px;max-width:1320px;margin:0 auto}
.rd-pick{display:flex;justify-content:center;padding-top:40px}
.rd-pick-box{width:min(680px,100%);display:flex;flex-direction:column;gap:16px}
.rd-h1{margin:0;font-size:30px;font-weight:700;letter-spacing:-.02em;text-align:center}
.rd-sub{margin:0;font-size:14px;color:#475569;text-align:center}
.rd-card{background:#fff;border:1px solid #E5E7EB;border-radius:14px}
.rd-search{display:flex;align-items:center;gap:12px;padding:0 18px;height:64px;border-bottom:1px solid #EEF0F3}
.rd-search input{flex:1;border:0;outline:none;font:500 20px Inter,sans-serif;color:#0F172A;background:transparent;min-width:0}
.rd-kbd{font:600 11px ui-monospace,Consolas,monospace;padding:2px 6px;border:1px solid #CBD5E1;border-bottom-width:2px;border-radius:5px;background:#F8FAFC;color:#334155;white-space:nowrap}
.rd-sup{width:calc(100% - 16px);margin:0 8px 4px;padding:12px;border-radius:12px;border:0;background:#fff;display:flex;gap:14px;align-items:center;text-align:left;font-family:inherit;color:#0F172A;cursor:pointer}
.rd-sup.is-on{background:#EFF6FF}
.rd-chip{width:42px;height:42px;border-radius:11px;background:#F1F5F9;color:#334155;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex:none}
.rd-sup.is-on .rd-chip{background:#2563EB;color:#fff}
.rd-sup-name{font-size:15px;font-weight:600}
.rd-sup-meta{font-size:12px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd-tag{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;white-space:nowrap}
.rd-keys{display:flex;gap:16px;flex-wrap:wrap;justify-content:center;font-size:12px;color:#64748B}
.rd-keys b{color:#334155}
.rd-layout{display:flex;gap:22px;align-items:flex-start}
.rd-left{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
.rd-right{width:312px;flex:none;display:flex;flex-direction:column;gap:14px;position:sticky;top:16px}
.rd-supbar{padding:12px 16px;display:flex;align-items:center;gap:12px}
.rd-label{font-size:11px;font-weight:600;color:#64748B;letter-spacing:.04em;text-transform:uppercase}
.rd-btn{height:34px;padding:0 12px;border-radius:8px;border:1px solid #CBD5E1;background:#fff;font:600 12px Inter,sans-serif;color:#0F172A;cursor:pointer;white-space:nowrap}
.rd-btn:hover{border-color:#2563EB;color:#1D4ED8}
.rd-note{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#F8FBFF;border-bottom:1px solid #E6EEFB;border-radius:14px 14px 0 0;font-size:13px;color:#334155}
.rd-grid{display:grid;grid-template-columns:40px minmax(0,1fr) 64px 118px 100px 112px 112px 132px;align-items:center}
.rd-head{font-size:11px;font-weight:600;color:#64748B;letter-spacing:.04em;background:#F8FAFC;border-bottom:1px solid #EEF0F3}
.rd-head>div{padding:8px 10px}
.rd-row{min-height:50px;border-bottom:1px solid #F1F3F5;font-size:14px}
.rd-row.is-off .rd-name,.rd-row.is-off .rd-after{color:#94A3B8}
.rd-row.is-active{background:#FAFCFF}
.rd-n{text-align:center;color:#94A3B8;font-size:12px}
.rd-namecell{padding:4px 10px;display:flex;flex-direction:column;gap:3px;min-width:0}
.rd-name{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rd-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.rd-typebtn{border:0;cursor:pointer;font:600 11px Inter,sans-serif;padding:1px 7px;border-radius:999px;white-space:nowrap}
.rd-select{height:26px;border-radius:6px;border:1px solid #C4B5FD;padding:0 4px;font:500 12px Inter,sans-serif;color:#4C1D95;background:#F5F3FF}
.rd-last{padding:0 10px;color:#94A3B8;font-size:13px;font-variant-numeric:tabular-nums}
.rd-in{width:100%;height:34px;box-sizing:border-box;border-radius:8px;border:1px solid #CBD5E1;padding:0 10px;text-align:right;font:700 14px Inter,sans-serif;color:#0F172A;background:#fff}
.rd-in::placeholder{color:#B8C2D0;font-weight:400;font-size:12px}
.rd-in:focus,.rd-price:focus,.rd-extra:focus,.rd-select:focus,.rd-field:focus{outline:2px solid #2563EB;outline-offset:0;border-color:#2563EB}
.rd-price{width:100%;height:30px;box-sizing:border-box;border-radius:7px;border:1px solid transparent;padding:0 8px;text-align:right;font:400 14px Inter,sans-serif;color:#0F172A;background:transparent}
.rd-price.is-needed{border-color:#C4B5FD}
.rd-price::placeholder{color:#A78BFA}
.rd-delta{font-size:11px;font-weight:600;color:#B45309;padding-right:8px;margin-top:-2px}
.rd-total{padding:0 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.rd-after{padding:0 10px;font-size:12px;color:#475569}
.rd-plus{position:relative;display:flex;align-items:center;gap:10px;padding:8px 12px 8px 14px}
.rd-plusmark{width:22px;height:22px;border-radius:6px;border:1.5px dashed #94A3B8;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#64748B;flex:none}
.rd-extra{flex:1;height:36px;border:1px solid #E2E8F0;border-radius:8px;padding:0 10px;font:400 14px Inter,sans-serif;color:#0F172A;background:#fff}
.rd-finder{position:absolute;left:46px;right:12px;top:calc(100% - 4px);background:#fff;border:1px solid #D0D5DD;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.16);overflow:hidden;z-index:30}
.rd-opt{width:100%;border:0;background:#fff;padding:9px 12px;display:flex;align-items:center;gap:10px;text-align:left;font-family:inherit;cursor:pointer}
.rd-opt.is-on{background:#EFF6FF}
.rd-opt.is-new{color:#6D28D9}
.rd-opt.is-new.is-on{background:#F5F3FF}
.rd-opt-hint{padding:7px 12px;border-top:1px solid #F1F5F9;font-size:11px;color:#64748B}
.rd-sum{padding:20px;display:flex;flex-direction:column;gap:12px}
.rd-big{font-size:34px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.rd-line{display:flex;justify-content:space-between;font-size:13px;color:#475569}
.rd-line b{color:#0F172A}
.rd-warn{background:#FFFBEB;border:1px solid #FDE68A;border-radius:14px;padding:12px 16px;font-size:13px;color:#78350F}
.rd-pay{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.rd-paybtn{height:46px;border-radius:9px;border:1px solid #E2E8F0;background:#fff;color:#334155;font:600 13px Inter,sans-serif;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}
.rd-paybtn.is-on{border:2px solid #2563EB;background:#EFF6FF;color:#1E3A8A}
.rd-field{height:38px;border-radius:8px;border:1px solid #CBD5E1;padding:0 10px;font:600 15px Inter,sans-serif;width:100%;box-sizing:border-box}
.rd-save{height:52px;border:0;border-radius:12px;background:#2563EB;color:#fff;font:600 15px Inter,sans-serif;display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;width:100%}
.rd-save:hover{background:#1D4ED8}
.rd-save:disabled{opacity:.6;cursor:wait}
.rd-save .rd-kbd{background:rgba(255,255,255,.18);border-color:transparent;color:#fff}
.rd-err{font-size:12.5px;color:#B42318;background:#FEF3F2;border:1px solid #FECDCA;border-radius:10px;padding:8px 12px}
.rd-help{font-size:12px;color:#64748B;line-height:1.45}
.rd-done{max-width:540px;margin:56px auto 0;padding:32px;display:flex;flex-direction:column;gap:16px;text-align:center}
.rd-tick{width:56px;height:56px;border-radius:50%;background:#ECFDF5;color:#047857;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;align-self:center}
.rd-notice{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 14px;background:#EFF8FF;border:1px solid #B2DDFF;border-radius:10px;color:#175CD3;font-size:13px}
.rd-link{background:none;border:0;padding:0;color:#1565C0;font:600 13px Inter,sans-serif;text-decoration:underline;cursor:pointer}
@media (max-width:1100px){.rd-layout{flex-direction:column}.rd-right{width:100%;position:static}}
`;

export default function RecordDelivery() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;
  const draftKey = `delivery-draft:${user?.u_id ?? "anon"}`;

  // ── what is known ──
  const [book, setBook] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [products, setProducts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");

  // ── the delivery being typed ──
  const [screen, setScreen] = useState("pick"); // pick | sheet | done
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [sup, setSup] = useState(null);         // a book entry, or { sup_id: null, sup_name } for a new one
  const [rows, setRows] = useState([]);
  const [extra, setExtra] = useState("");
  const [exHi, setExHi] = useState(0);
  const [exOpen, setExOpen] = useState(false);
  const [pay, setPay] = useState("L");
  const [part, setPart] = useState("");
  const [method, setMethod] = useState("cash");
  const [active, setActive] = useState(null);   // the line the cursor is on
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [draftRestored, setDraftRestored] = useState(false);

  // Focus moves after the screen has re-rendered with what the last key did.
  const pendingFocus = useRef(null);
  const focusNow = (id) => {
    const el = document.getElementById(id);
    if (el) { el.focus(); if (el.select) el.select(); }
  };
  const focusNext = (id) => { pendingFocus.current = id; };
  useEffect(() => {
    if (!pendingFocus.current) return;
    const id = pendingFocus.current;
    pendingFocus.current = null;
    focusNow(id);
  });

  const authFetch = useCallback((url, opts = {}) => {
    const token = localStorage.getItem("token");
    return fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
      credentials: "include",
    });
  }, []);
  const call = useCallback(async (url, opts) => {
    const res = await authFetch(url, opts);
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { ok: res.ok, status: res.status, body };
  }, [authFetch]);
  const asList = (b) => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []);

  const loadAll = useCallback(async () => {
    const [b, m, p] = await Promise.all([
      call("/api/suppliers/delivery-book"), call("/api/raw-materials"), call("/api/products"),
    ]);
    if (!b.ok) setLoadError(b.status === 403 ? "You don't have permission to record deliveries." : "Couldn't load your suppliers — refresh to try again.");
    setBook(asList(b.body));
    setMaterials(asList(m.body));
    setProducts(asList(p.body));
    setLoaded(true);
  }, [call]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // ── every item that can be bought, of all three kinds ──
  const catalog = useMemo(() => {
    const out = [];
    for (const m of materials) {
      out.push({
        kind: "rm", id: m.rm_id, name: m.rm_name, type: m.item_category === "supply" ? "supply" : "ingredient",
        unit: m.unit, lastPrice: Number(m.last_price) || 0, stock: Number(m.stock_qty) || 0,
      });
    }
    for (const p of products) {
      if (p.track_inventory === false) continue; // made to order: no stock to receive
      out.push({
        kind: "pro", id: p.pro_id, name: p.pro_name, type: "resale", unit: "pcs",
        lastPrice: Number(p.cost_price) || 0, stock: Number(p.pro_qty) || 0,
      });
    }
    return out;
  }, [materials, products]);
  const findItem = useCallback((kind, id) => catalog.find((c) => c.kind === kind && c.id === id), [catalog]);

  const rowFrom = (c, lastQty, isExtra, price) => ({
    key: nextKey(), kind: c.kind, id: c.id, name: c.name, type: c.type, origType: c.type, typeEdit: false,
    unit: c.unit, lastQty: lastQty ?? "", lastPrice: c.lastPrice, stock: c.stock,
    qty: "", price: price !== undefined && price !== "" ? String(price) : (c.lastPrice ? String(c.lastPrice) : ""),
    isExtra, isNew: false,
  });
  const newRow = (name, extraFields = {}) => ({
    key: nextKey(), kind: null, id: null, name, type: "ingredient", origType: "ingredient", typeEdit: false,
    unit: "kg", lastQty: "", lastPrice: 0, stock: 0, qty: "", price: "", isExtra: true, isNew: true, ...extraFields,
  });

  // ── a draft survives a refresh ──
  useEffect(() => {
    if (!loaded) return;
    try {
      const d = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (!d || !Array.isArray(d.rows) || !d.rows.some((r) => num(r.qty) > 0)) return;
      const s = d.sup?.sup_id ? book.find((x) => x.sup_id === d.sup.sup_id) || d.sup : d.sup;
      if (!s) return;
      setSup(s);
      setRows(d.rows.map((r) => ({ ...r, key: nextKey() })));
      setPay(d.pay || "L"); setPart(d.part || ""); setMethod(d.method || "cash");
      setScreen("sheet");
      setDraftRestored(true);
    } catch { /* a damaged draft is ignored */ }
    // Once, when everything has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  useEffect(() => {
    if (screen !== "sheet") return;
    const t = setTimeout(() => {
      try {
        if (rows.some((r) => num(r.qty) > 0)) {
          localStorage.setItem(draftKey, JSON.stringify({ sup, rows: rows.map(({ key: _k, ...r }) => r), pay, part, method }));
        } else localStorage.removeItem(draftKey);
      } catch { /* storage full or blocked: no draft */ }
    }, 400);
    return () => clearTimeout(t);
  }, [screen, sup, rows, pay, part, method, draftKey]);
  const clearDraft = () => { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } };

  // ── step 1: who delivered? ──
  const supMatches = useMemo(() => {
    const t = lower(q);
    const list = book.filter((s) => !t || lower(s.sup_name).includes(t));
    list.sort((a, b) => Number(!lower(a.sup_name).startsWith(t)) - Number(!lower(b.sup_name).startsWith(t)));
    const opts = list.slice(0, 8).map((s) => ({ kind: "sup", s }));
    if (q.trim() && !book.some((s) => lower(s.sup_name) === t)) opts.push({ kind: "new", name: q.trim().replace(/\s+/g, " ") });
    return opts;
  }, [book, q]);

  const startWith = (s, empty) => {
    const usual = empty ? [] : (s.usual || [])
      .map((u) => { const c = findItem(u.kind, u.id); return c ? rowFrom(c, u.last_qty, false, u.last_price) : null; })
      .filter(Boolean);
    setSup(s);
    setRows(usual);
    setPay(s.habit || "L");
    setPart(""); setMethod("cash"); setExtra(""); setExOpen(false); setError("");
    setScreen("sheet");
    setDraftRestored(false);
    focusNext(usual.length ? "rd-qty-0" : "rd-extra");
  };
  const pickOption = (o, empty) => {
    if (!o) return;
    if (o.kind === "sup") startWith(o.s, empty);
    else startWith({ sup_id: null, sup_name: o.name, balance_due: 0, usual: [], habit: null }, true);
  };
  const onPickKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!supMatches.length) return;
      const d = e.key === "ArrowDown" ? 1 : -1;
      setHi((h) => (Math.min(h, supMatches.length - 1) + d + supMatches.length) % supMatches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pickOption(supMatches[Math.min(hi, supMatches.length - 1)], e.shiftKey);
    }
  };
  const changeSupplier = () => { setScreen("pick"); setQ(""); setHi(0); focusNext("rd-sup"); };

  // ── step 2: the sheet ──
  const setRow = (i, patch) => { setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r))); setError(""); };
  const fillLast = () => {
    setRows((list) => list.map((r) => (r.qty === "" && r.lastQty !== "" ? { ...r, qty: String(r.lastQty) } : r)));
    focusNext("rd-qty-0");
  };
  const editType = (i) => {
    const r = rows[i];
    if (!r || r.isNew || r.kind !== "rm") return; // a resale product's type is changed on the Products page
    setRow(i, { typeEdit: true });
    focusNext(`rd-type-${i}`);
  };
  const choosePay = (k) => {
    setPay(k);
    if (k === "P") focusNext("rd-part");
    else if (k === "F") focusNext("rd-method");
  };
  const nextAfter = (i) => (i + 1 < rows.length ? `rd-qty-${i + 1}` : "rd-extra");
  const payKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (/^[fplFPL]$/.test(e.key)) { e.preventDefault(); choosePay(e.key.toUpperCase()); return true; }
    return false;
  };
  const onQtyKey = (e, i) => {
    if (payKey(e)) return;
    const r = rows[i];
    if (e.key === "Enter" && r?.isNew && !num(r.price)) { e.preventDefault(); focusNow(`rd-price-${i}`); return; }
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focusNow(nextAfter(i)); }
    else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); focusNow(`rd-qty-${i - 1}`); }
  };
  const onPriceKey = (e, i) => {
    if (payKey(e)) return;
    if (e.key === "Enter") { e.preventDefault(); focusNow(nextAfter(i)); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusNow(i + 1 < rows.length ? `rd-price-${i + 1}` : "rd-extra"); }
    else if (e.key === "ArrowUp" && i > 0) { e.preventDefault(); focusNow(`rd-price-${i - 1}`); }
  };
  const onTypeKey = (e, i) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    const r = rows[i];
    if (r.isNew) { focusNow(r.type === "resale" ? `rd-qty-${i}` : `rd-unit-${i}`); return; }
    setRow(i, { typeEdit: false });
    focusNext(`rd-qty-${i}`);
  };
  const onUnitKey = (e, i) => {
    if (e.key === "Enter") { e.preventDefault(); focusNow(`rd-qty-${i}`); }
  };
  const removeRow = (i) => {
    setRows((list) => list.filter((_, j) => j !== i));
    focusNext(i < rows.length - 1 ? `rd-qty-${i}` : (i > 0 ? `rd-qty-${i - 1}` : "rd-extra"));
  };

  // The "+" line: any item, by name; the last option adds a new one.
  const finder = useMemo(() => {
    const t = lower(extra);
    if (!t) return [];
    const inSheet = new Set(rows.map((r) => (r.kind ? `${r.kind}:${r.id}` : `new:${lower(r.name)}`)));
    const hits = catalog
      .filter((c) => lower(c.name).includes(t) && !inSheet.has(`${c.kind}:${c.id}`))
      .sort((a, b) => Number(!lower(a.name).startsWith(t)) - Number(!lower(b.name).startsWith(t)))
      .slice(0, 7)
      .map((c) => ({ kind: "item", c }));
    if (!catalog.some((c) => lower(c.name) === t) && !inSheet.has(`new:${t}`)) {
      hits.push({ kind: "new", name: extra.trim().replace(/\s+/g, " ") });
    }
    return hits;
  }, [extra, catalog, rows]);
  const addFromFinder = (o) => {
    if (!o) return;
    const at = rows.length;
    if (o.kind === "item") {
      setRows((list) => [...list, rowFrom(o.c, "", true)]);
      focusNext(`rd-qty-${at}`);
    } else {
      setRows((list) => [...list, newRow(o.name)]);
      focusNext(`rd-type-${at}`);
    }
    setExtra(""); setExHi(0); setExOpen(false);
  };
  const onExtraKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!finder.length || !exOpen) {
        if (e.key === "ArrowUp" && rows.length) focusNow(`rd-qty-${rows.length - 1}`);
        return;
      }
      const d = e.key === "ArrowDown" ? 1 : -1;
      setExHi((h) => (Math.min(h, finder.length - 1) + d + finder.length) % finder.length);
    } else if (e.key === "Escape") {
      setExOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (finder.length && exOpen) addFromFinder(finder[Math.min(exHi, finder.length - 1)]);
      else if (!extra.trim()) {
        // An empty "+" line: the list is done — to the payment.
        focusNow(pay === "P" ? "rd-part" : pay === "F" ? "rd-method" : "rd-save");
      }
    }
  };
  // Rows copied from Excel and pasted into the "+" line.
  const onExtraPaste = (e) => {
    const text = e.clipboardData?.getData("text") || "";
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const parsed = parsePastedRows(text, UNITS);
    if (!parsed.length) return;
    setRows((list) => {
      const out = [...list];
      for (const l of parsed) {
        const c = catalog.find((x) => lower(x.name) === lower(l.name));
        const at = c ? out.findIndex((r) => r.kind === c.kind && r.id === c.id) : -1;
        const qty = l.qty === "" ? "" : String(l.qty);
        if (at >= 0) out[at] = { ...out[at], qty, ...(l.price !== "" ? { price: String(l.price) } : {}) };
        else if (c) out.push({ ...rowFrom(c, "", true, l.price), qty });
        else out.push(newRow(l.name, { unit: l.unit || "kg", qty, price: l.price === "" ? "" : String(l.price) }));
      }
      return out;
    });
  };

  // ── money ──
  const got = rows.filter((r) => num(r.qty) > 0);
  const totalCents = got.reduce((s, r) => s + cents(num(r.qty) * num(r.price)), 0);
  const total = totalCents / 100;
  const paidCents = pay === "F" ? totalCents : pay === "P" ? Math.min(cents(part), totalCents) : 0;
  const owedAfter = (sup?.balance_due || 0) + (totalCents - paidCents) / 100;
  const byType = (t) => {
    const ls = got.filter((r) => r.type === t);
    return ls.length ? `${ls.length} · ${fmt(ls.reduce((s, r) => s + num(r.qty) * num(r.price), 0))}` : "—";
  };
  const dearer = got.filter((r) => r.lastPrice && num(r.price) > r.lastPrice).length;
  const ranOut = rows.filter((r) => !r.isExtra && !r.isNew && r.stock <= 0 && !(num(r.qty) > 0)).map((r) => r.name);

  // ── saving: one purchase order, its lines, received ──
  const problems = () => {
    if (!got.length) return "Type at least one quantity first.";
    for (const r of got) {
      if (!(num(r.price) > 0)) return `Give a price for ${r.name}.`;
      if (r.isNew) {
        if (!r.name.trim() || r.name.length > 120) return `“${r.name}” needs a name under 120 letters.`;
        if (r.type !== "resale" && !NAME_OK.test(r.name)) return `“${r.name}”: use letters, numbers, spaces and - ( ) . & / only.`;
      }
    }
    if (pay === "P" && !(cents(part) > 0)) return "Type how much was paid now, or choose Paid (F) or On credit (L).";
    if (pay === "P" && cents(part) > totalCents) return "That's more than the delivery total.";
    if (!sup?.sup_id && (!sup?.sup_name || sup.sup_name.length < 2)) return "Choose who delivered.";
    return "";
  };

  const save = async () => {
    if (saving || screen !== "sheet") return;
    const p = problems();
    if (p) { setError(p); return; }
    if (!branchId) { setError("Your account isn't assigned to a property."); return; }
    setSaving(true); setError("");
    const made = { po: null, materials: [], products: [] };
    const undo = async () => {
      const quiet = (url) => authFetch(url, { method: "DELETE" }).catch(() => {});
      if (made.po) await quiet(`/api/purchase-orders/${made.po}`);
      for (const id of [...made.materials].reverse()) await quiet(`/api/raw-materials/${id}`);
      for (const id of [...made.products].reverse()) await quiet(`/api/products/${id}`);
    };
    try {
      let supId = sup.sup_id;
      if (!supId) {
        const r = await call("/api/suppliers", { method: "POST", body: JSON.stringify({ sup_name: sup.sup_name }) });
        if (!r.ok) throw new Error(r.body?.message || `Couldn't add the supplier (${r.status})`);
        supId = r.body.sup_id;
        setSup((s) => ({ ...s, sup_id: supId }));
      }
      // A type changed on an existing item: it is that item's type from now on.
      for (const r of got.filter((x) => x.kind === "rm" && x.type !== x.origType)) {
        const u = await call(`/api/raw-materials/${r.id}`, { method: "PUT", body: JSON.stringify({ item_category: r.type }) });
        if (!u.ok) throw new Error(u.body?.message || `Couldn't change ${r.name}'s type (${u.status})`);
      }
      const po = await call("/api/purchase-orders", { method: "POST", body: JSON.stringify({ sup_id: supId, B_id: Number(branchId), status: "pending" }) });
      if (!po.ok) throw new Error(po.body?.message || `Couldn't start the order (${po.status})`);
      made.po = po.body.po_id;

      for (const r of got) {
        const qty = num(r.qty), unitPrice = num(r.price);
        const line = { po_id: made.po, qty, unit_price: unitPrice, price: cents(qty * unitPrice) / 100 };
        if (r.type === "resale") {
          let proId = r.kind === "pro" ? r.id : null;
          if (!proId) {
            const c = await call("/api/products", { method: "POST", body: JSON.stringify({
              pro_name: r.name.trim(), pro_qty: 0, pro_price: unitPrice, cost_price: unitPrice, com_id: user?.com_id ?? undefined,
            }) });
            if (!c.ok) throw new Error(c.body?.message || `Couldn't add ${r.name} (${c.status})`);
            proId = c.body.pro_id;
            made.products.push(proId);
          }
          line.pro_id = proId;
        } else {
          let rmId = r.kind === "rm" ? r.id : null;
          if (!rmId) {
            const c = await call("/api/raw-materials", { method: "POST", body: JSON.stringify({
              rm_name: r.name.trim(), unit: r.unit, stock_qty: 0, record_level: 0, B_id: Number(branchId),
              com_id: user?.com_id ?? undefined, item_category: r.type,
            }) });
            if (c.ok) { rmId = c.body.rm_id; made.materials.push(rmId); }
            else if (c.status === 409) {
              const again = await call("/api/raw-materials");
              const found = asList(again.body).find((m) => lower(m.rm_name) === lower(r.name));
              if (!found) throw new Error(`“${r.name}” already exists but couldn't be found — refresh and try again`);
              rmId = found.rm_id;
            } else throw new Error(c.body?.message || `Couldn't add ${r.name} (${c.status})`);
          }
          line.rm_id = rmId;
        }
        const pi = await call("/api/purchase-items", { method: "POST", body: JSON.stringify(line) });
        if (!pi.ok) throw new Error(pi.body?.message || `Couldn't add ${r.name} to the order (${pi.status})`);
      }

      const rec = await call(`/api/purchase-orders/${made.po}/status`, { method: "PATCH", body: JSON.stringify({
        status: "received",
        ...(paidCents > 0 ? { payment: { amount: paidCents / 100, method } } : {}),
      }) });
      if (!rec.ok) throw new Error(rec.body?.message || `Couldn't receive the order (${rec.status})`);

      clearDraft();
      const methodLabel = (METHODS.find(([v]) => v === method) || [])[1] || "";
      setReceipt({
        branchName: "",
        supplierName: sup.sup_name,
        supplierContact: sup.sup_contact,
        poId: made.po,
        items: got.map((r) => ({ name: r.name, qty: num(r.qty), unit: r.type === "resale" ? "pcs" : r.unit, lineTotal: cents(num(r.qty) * num(r.price)) / 100 })),
        orderTotal: total,
        paidThisTime: paidCents / 100,
        paidToDate: paidCents / 100,
        method: paidCents > 0 ? method : null,
        recordedBy: [user?.u_fname, user?.u_lname].filter(Boolean).join(" ") || user?.u_email || "",
        summary: `${sup.sup_name} · ${got.length} item${got.length === 1 ? "" : "s"} · ${money(total)} · `
          + (pay === "F" ? `paid in full by ${methodLabel.toLowerCase()}` : pay === "P" ? `${money(paidCents / 100)} paid by ${methodLabel.toLowerCase()}, the rest on credit` : "on credit")
          + `. ${sup.sup_name} is owed ${money(owedAfter)}.`,
      });
      setScreen("done");
      focusNext("rd-again");
      loadAll();
    } catch (err) {
      await undo();
      setError(`${err.message || "Something went wrong"} — nothing was saved.`);
    } finally {
      setSaving(false);
    }
  };

  const restart = () => {
    setReceipt(null); setRows([]); setSup(null); setQ(""); setHi(0); setError("");
    setScreen("pick");
    focusNext("rd-sup");
  };
  const startOver = () => { clearDraft(); restart(); setDraftRestored(false); };

  // Keys that work anywhere on the page.
  const onPageKey = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const k = e.key.toLowerCase();
    if (k === "enter" && screen === "sheet") { e.preventDefault(); save(); }
    else if (k === "l" && screen === "sheet") { e.preventDefault(); fillLast(); }
    else if (k === "k" && screen === "sheet") { e.preventDefault(); changeSupplier(); }
    else if (k === "t" && screen === "sheet" && active != null) { e.preventDefault(); editType(active); }
  };

  useEffect(() => { if (loaded && screen === "pick") focusNow("rd-sup"); }, [loaded, screen]);

  const initials = (n) => String(n || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const hiIdx = Math.min(hi, Math.max(supMatches.length - 1, 0));
  const exIdx = Math.min(exHi, Math.max(finder.length - 1, 0));

  return (
    <div className="rd" onKeyDown={onPageKey}>
      <style>{STYLES}</style>
      <Sidebar />
      <div className="rd-main">
        <Header title="Record a delivery" role="Branch Admin" />
        <main className="rd-page">
          {loadError && <div className="rd-err" role="alert">{loadError}</div>}

          {screen === "pick" && (
            <div className="rd-pick">
              <div className="rd-pick-box">
                <h1 className="rd-h1">Who delivered?</h1>
                <p className="rd-sub">Pick the supplier and the sheet fills with what they usually bring.</p>
                <div className="rd-card" style={{ boxShadow: "0 18px 48px rgba(15,23,42,.10)", overflow: "hidden" }}>
                  <div className="rd-search">
                    <label htmlFor="rd-sup" style={{ position: "absolute", left: -9999 }}>Supplier</label>
                    <input id="rd-sup" autoComplete="off" placeholder={loaded ? "Type the supplier's name…" : "Loading…"}
                      value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} onKeyDown={onPickKey} />
                    <span className="rd-kbd">Enter to pick</span>
                  </div>
                  <div style={{ padding: "8px 0" }} role="listbox" aria-label="Suppliers">
                    {supMatches.map((o, i) => (o.kind === "sup" ? (
                      <button key={o.s.sup_id} type="button" role="option" aria-selected={i === hiIdx}
                        className={`rd-sup${i === hiIdx ? " is-on" : ""}`} onMouseEnter={() => setHi(i)} onClick={() => pickOption(o, false)}>
                        <span className="rd-chip">{initials(o.s.sup_name)}</span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span className="rd-sup-name">{o.s.sup_name}</span>
                            {o.s.usually_today && <span className="rd-tag" style={{ color: "#065F46", background: "#ECFDF5" }}>Usually today</span>}
                          </span>
                          <span className="rd-sup-meta">
                            {o.s.usual?.length ? `Usually brings: ${o.s.usual.map((u) => u.name).join(", ")}` : "No deliveries recorded yet"}
                          </span>
                        </span>
                        <span style={{ textAlign: "right", flex: "none" }}>
                          <span style={{ display: "block", fontSize: 12, color: "#64748B" }}>
                            {o.s.last_delivery ? `Last: ${new Date(o.s.last_delivery).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: o.s.balance_due > 0 ? "#B45309" : "#64748B" }}>
                            {o.s.balance_due > 0 ? `Owed ${fmt(o.s.balance_due)}` : "Settled"}
                          </span>
                        </span>
                      </button>
                    ) : (
                      <button key="new" type="button" role="option" aria-selected={i === hiIdx}
                        className={`rd-sup${i === hiIdx ? " is-on" : ""}`} onMouseEnter={() => setHi(i)} onClick={() => pickOption(o, true)}>
                        <span className="rd-chip" style={{ border: "1.5px dashed #94A3B8", background: "#fff", color: "#64748B" }}>+</span>
                        <span className="rd-sup-name">New supplier “{o.name}”</span>
                      </button>
                    )))}
                    {loaded && !supMatches.length && <div style={{ padding: "14px 20px", color: "#64748B", fontSize: 14 }}>Type the supplier's name.</div>}
                  </div>
                </div>
                <div className="rd-keys">
                  <span><b>↑ ↓</b> choose</span><span><b>Enter</b> pick and fill the sheet</span><span><b>Shift+Enter</b> pick, empty sheet</span>
                </div>
              </div>
            </div>
          )}

          {screen === "sheet" && sup && (
            <div className="rd-layout">
              <div className="rd-left">
                {draftRestored && (
                  <div className="rd-notice"><span>We kept the delivery you were typing.</span><button type="button" className="rd-link" onClick={startOver}>Start over</button></div>
                )}
                <div className="rd-card rd-supbar">
                  <span className="rd-chip" style={{ background: "#2563EB", color: "#fff" }}>{initials(sup.sup_name)}</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span className="rd-label">Supplier{sup.sup_id ? "" : " · new"}</span>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{sup.sup_name}</span>
                  </span>
                  <span style={{ marginLeft: "auto", textAlign: "right" }}>
                    <span style={{ display: "block", fontSize: 11, color: "#64748B" }}>Owed before this</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#B45309" }}>{sup.balance_due > 0 ? money(sup.balance_due) : "Nothing"}</span>
                  </span>
                  <button type="button" className="rd-btn" onClick={changeSupplier}>Change · Ctrl+K</button>
                </div>

                <div className="rd-card">
                  <div className="rd-note">
                    <span>
                      {rows.some((r) => !r.isExtra)
                        ? <><b>Filled with what {sup.sup_name} usually brings.</b> Type today's quantities — empty lines aren't saved. Each line knows whether it's an ingredient, resale product or hotel supply.</>
                        : <><b>Type what came in on the + line</b> — or paste rows copied from Excel.</>}
                    </span>
                    {rows.some((r) => r.lastQty !== "") && (
                      <button type="button" className="rd-btn" style={{ marginLeft: "auto" }} onClick={fillLast}>Same as last time · Ctrl+L</button>
                    )}
                  </div>
                  <div className="rd-grid rd-head">
                    <div style={{ textAlign: "center" }}>#</div><div>ITEM</div><div>UNIT</div><div>LAST TIME</div>
                    <div style={{ textAlign: "right" }}>TODAY</div><div style={{ textAlign: "right" }}>PRICE</div>
                    <div style={{ textAlign: "right" }}>TOTAL</div><div>STOCK AFTER</div>
                  </div>

                  {rows.map((r, i) => {
                    const has = num(r.qty) > 0;
                    const lt = num(r.qty) * num(r.price);
                    const d = r.lastPrice && num(r.price) && num(r.price) !== r.lastPrice
                      ? Math.round(((num(r.price) - r.lastPrice) / r.lastPrice) * 100) : 0;
                    const ts = TYPE_STYLE[r.type];
                    const unit = r.type === "resale" ? "pcs" : r.unit;
                    return (
                      <div key={r.key} className={`rd-grid rd-row${has || r.isExtra ? "" : " is-off"}${active === i ? " is-active" : ""}`} onFocus={() => setActive(i)}>
                        <div className="rd-n">{i + 1}</div>
                        <div className="rd-namecell">
                          <span className="rd-name">{r.name}</span>
                          <span className="rd-meta">
                            {r.isNew || r.typeEdit ? (
                              <>
                                <label htmlFor={`rd-type-${i}`} style={{ fontSize: 11, color: "#6D28D9", fontWeight: 600 }}>{r.isNew ? "New item:" : "Type:"}</label>
                                <select id={`rd-type-${i}`} className="rd-select" value={r.type} onChange={(e) => setRow(i, { type: e.target.value })} onKeyDown={(e) => onTypeKey(e, i)} onBlur={() => !r.isNew && setRow(i, { typeEdit: false })}>
                                  <option value="ingredient">Ingredient</option>
                                  {(r.isNew || r.type !== "resale") && <option value="supply">Hotel supply</option>}
                                  {r.isNew && <option value="resale">Resale product</option>}
                                </select>
                              </>
                            ) : r.kind === "rm" ? (
                              <button type="button" className="rd-typebtn" style={ts} title="Change its type (Ctrl+T)" onClick={() => editType(i)}>{TYPE_LABEL[r.type]} ▾</button>
                            ) : (
                              <span className="rd-tag" style={ts} title="A resale product — its type is set on the Products page">{TYPE_LABEL[r.type]}</span>
                            )}
                            {!r.isNew && r.type !== r.origType && <span style={{ fontSize: 11, color: "#B45309" }}>changed from {TYPE_LABEL[r.origType].toLowerCase()}</span>}
                            {r.isExtra && !r.isNew && <span className="rd-tag" style={{ color: "#475569", background: "#F1F5F9" }}>Extra today</span>}
                            <button type="button" className="rd-link" style={{ fontSize: 11, fontWeight: 500, color: "#94A3B8", textDecoration: "none" }} tabIndex={-1} onClick={() => removeRow(i)} aria-label={`Remove ${r.name}`}>remove</button>
                          </span>
                        </div>
                        <div style={{ padding: "0 6px", color: "#64748B" }}>
                          {r.isNew && r.type !== "resale" ? (
                            <>
                              <label htmlFor={`rd-unit-${i}`} style={{ position: "absolute", left: -9999 }}>{r.name} unit</label>
                              <select id={`rd-unit-${i}`} className="rd-select" style={{ width: "100%", height: 32 }} value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} onKeyDown={(e) => onUnitKey(e, i)}>
                                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                              </select>
                            </>
                          ) : <span style={{ padding: "0 4px" }}>{unit}</span>}
                        </div>
                        <div className="rd-last">{r.lastQty !== "" ? `${show(r.lastQty)} · ${fmt(r.lastPrice).replace(/\.00$/, "")}` : r.lastPrice ? `— · ${fmt(r.lastPrice).replace(/\.00$/, "")}` : "never bought"}</div>
                        <div style={{ padding: "0 6px" }}>
                          <label htmlFor={`rd-qty-${i}`} style={{ position: "absolute", left: -9999 }}>{r.name} quantity today</label>
                          <input id={`rd-qty-${i}`} className="rd-in" autoComplete="off" inputMode="decimal"
                            placeholder={r.lastQty !== "" ? `last ${show(r.lastQty)}` : ""}
                            value={r.qty} onChange={(e) => setRow(i, { qty: clean(e.target.value) })} onKeyDown={(e) => onQtyKey(e, i)} onFocus={(e) => e.target.select()} />
                        </div>
                        <div style={{ padding: "0 6px", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                          <label htmlFor={`rd-price-${i}`} style={{ position: "absolute", left: -9999 }}>{r.name} price</label>
                          <input id={`rd-price-${i}`} className={`rd-price${r.isNew && !num(r.price) ? " is-needed" : ""}`} autoComplete="off" inputMode="decimal"
                            placeholder="price" value={r.price} onChange={(e) => setRow(i, { price: clean(e.target.value) })} onKeyDown={(e) => onPriceKey(e, i)} onFocus={(e) => e.target.select()} />
                          {d !== 0 && <span className="rd-delta">{d > 0 ? "▲" : "▼"} {Math.abs(d)}% vs last</span>}
                        </div>
                        <div className="rd-total">{has && lt ? fmt(lt) : ""}</div>
                        <div className="rd-after">{has ? `${show(r.stock)} → ${show(r.stock + num(r.qty))} ${unit}` : r.isNew ? "new item" : "not today"}</div>
                      </div>
                    );
                  })}

                  <div className="rd-plus">
                    <span className="rd-plusmark">+</span>
                    <label htmlFor="rd-extra" style={{ position: "absolute", left: -9999 }}>Add an item</label>
                    <input id="rd-extra" className="rd-extra" autoComplete="off"
                      placeholder={rows.length ? "Something else today? Type to find any item, or paste rows from Excel" : "Type an item's name, or paste rows from Excel"}
                      value={extra} onChange={(e) => { setExtra(e.target.value); setExHi(0); setExOpen(true); }}
                      onKeyDown={onExtraKey} onPaste={onExtraPaste} onBlur={() => setTimeout(() => setExOpen(false), 150)} onFocus={() => setActive(null)} />
                    {exOpen && finder.length > 0 && (
                      <div className="rd-finder" role="listbox" aria-label="Items">
                        {finder.map((o, j) => (o.kind === "item" ? (
                          <button key={`${o.c.kind}:${o.c.id}`} type="button" role="option" aria-selected={j === exIdx}
                            className={`rd-opt${j === exIdx ? " is-on" : ""}`} onMouseDown={(e) => { e.preventDefault(); addFromFinder(o); }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: "#0F172A", flex: 1 }}>{o.c.name}</span>
                            <span className="rd-tag" style={TYPE_STYLE[o.c.type]}>{TYPE_LABEL[o.c.type]}</span>
                            <span style={{ fontSize: 12, color: "#64748B", minWidth: 170, textAlign: "right" }}>
                              {o.c.unit}{o.c.lastPrice ? ` · last ${fmt(o.c.lastPrice).replace(/\.00$/, "")}` : ""} · {show(o.c.stock)} in stock
                            </span>
                          </button>
                        ) : (
                          <button key="new" type="button" role="option" aria-selected={j === exIdx}
                            className={`rd-opt is-new${j === exIdx ? " is-on" : ""}`} onMouseDown={(e) => { e.preventDefault(); addFromFinder(o); }}>
                            <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>+ Add “{o.name}” as a new item</span>
                            <span style={{ fontSize: 12, color: "#64748B" }}>you'll pick its type and unit</span>
                          </button>
                        )))}
                        <div className="rd-opt-hint">↑ ↓ choose · Enter adds it · Esc closes</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rd-keys" style={{ justifyContent: "flex-start" }}>
                  <span><b>Enter / ↓</b> next quantity</span><span><b>↑</b> line above</span><span><b>Tab</b> to the price</span>
                  <span><b>Ctrl+L</b> same as last time</span><span><b>Ctrl+T</b> change a line's type</span>
                  <span><b>F · P · L</b> paid · part · credit</span><span><b>Ctrl+K</b> change supplier</span><span><b>Ctrl+Enter</b> save</span>
                </div>
              </div>

              <aside className="rd-right">
                <div className="rd-card rd-sum">
                  <span className="rd-label">This delivery</span>
                  <span className="rd-big">{money(total)}</span>
                  <div className="rd-line"><span>Ingredients</span><b>{byType("ingredient")}</b></div>
                  <div className="rd-line"><span>Resale products</span><b>{byType("resale")}</b></div>
                  <div className="rd-line"><span>Hotel supplies</span><b>{byType("supply")}</b></div>
                  <div className="rd-line"><span>Dearer than last time</span><b style={{ color: "#B45309" }}>{dearer} item{dearer === 1 ? "" : "s"}</b></div>
                </div>
                {ranOut.length > 0 && (
                  <div className="rd-warn"><b>Worth a look:</b> {ranOut.join(", ")} {ranOut.length === 1 ? "has" : "have"} run out and none came today.</div>
                )}
                <div className="rd-card rd-sum" style={{ gap: 10 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="rd-label">Payment</span><span style={{ fontSize: 11, color: "#64748B" }}>no mouse needed</span>
                  </span>
                  <div className="rd-pay">
                    {["F", "P", "L"].map((k) => (
                      <button key={k} type="button" className={`rd-paybtn${pay === k ? " is-on" : ""}`} onClick={() => choosePay(k)}>
                        <span className="rd-kbd">{k}</span>{PAY_LABEL[k]}
                      </button>
                    ))}
                  </div>
                  {pay === "P" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label htmlFor="rd-part" style={{ fontSize: 12, color: "#475569" }}>Paid now (LKR) — Enter when done</label>
                      <input id="rd-part" className="rd-field" autoComplete="off" inputMode="decimal" value={part}
                        onChange={(e) => setPart(clean(e.target.value))}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey) { e.preventDefault(); focusNow("rd-method"); } }} />
                    </div>
                  )}
                  {(pay === "F" || pay === "P") && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label htmlFor="rd-method" style={{ fontSize: 12, color: "#475569" }}>Paid by — ↑ ↓ to change, Enter when done</label>
                      <select id="rd-method" className="rd-field" style={{ fontWeight: 500 }} value={method} onChange={(e) => setMethod(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey) { e.preventDefault(); focusNow("rd-save"); } }}>
                        {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  )}
                  <span className="rd-help">
                    {sup.habit
                      ? pay === sup.habit ? `${sup.sup_name} is usually “${PAY_LABEL[sup.habit].toLowerCase()}”, so it was chosen for you.` : `Changed from ${sup.sup_name}'s usual (${PAY_LABEL[sup.habit].toLowerCase()}).`
                      : "Choose how this delivery was paid."}
                  </span>
                  <div className="rd-line" style={{ borderTop: "1px solid #F1F3F5", paddingTop: 10 }}>
                    <span>Owed to {sup.sup_name} after</span><b style={{ color: "#B45309" }}>{money(owedAfter)}</b>
                  </div>
                </div>
                {error && <div className="rd-err" role="alert">{error}</div>}
                <button id="rd-save" type="button" className="rd-save" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : <>Save delivery <span className="rd-kbd">Ctrl+Enter</span></>}
                </button>
                <span className="rd-help" style={{ textAlign: "center" }}>Works from anywhere on the page. Stock goes up the moment you save.</span>
              </aside>
            </div>
          )}

          {screen === "done" && receipt && (
            <div className="rd-card rd-done">
              <div className="rd-tick">✓</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>Delivery saved</div>
              <div style={{ fontSize: 15, color: "#475569", lineHeight: 1.6 }}>{receipt.summary}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="rd-btn" style={{ flex: 1, height: 48, fontSize: 14 }} onClick={() => printSupplierInvoice(receipt)}>Print the bill</button>
                <button id="rd-again" type="button" className="rd-save" style={{ flex: 2, height: 48 }} onClick={restart}>Record another delivery · Enter</button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
