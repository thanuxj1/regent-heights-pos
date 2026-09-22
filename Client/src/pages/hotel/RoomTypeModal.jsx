import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRoomType, updateRoomType,
  getRoomFacilities, addRoomFacility, removeRoomFacility,
} from "../../services/api";
import { money, readImageFile } from "./ui";

const MAX_PHOTOS = 6;

const STYLES = `
.rt-backdrop{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.55)}
.rt-modal{display:flex;flex-direction:column;width:100%;max-width:760px;max-height:92vh;overflow:hidden;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);font-family:inherit}
.rt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 28px 16px;border-bottom:1px solid #EEF2F6}
.rt-head h2{margin:0;font-size:20px;font-weight:700;color:#0F172A}
.rt-head p{margin:4px 0 0;font-size:13px;color:#64748B}
.rt-x{flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:0;border-radius:9px;background:transparent;color:#94A3B8;font-size:18px;cursor:pointer}
.rt-x:hover{background:#F1F5F9;color:#475569}
.rt-body{flex:1;overflow-y:auto;padding:4px 28px 20px}
.rt-sec{padding:22px 0;border-bottom:1px solid #F1F5F9}
.rt-sec:last-child{border-bottom:0}
.rt-sec-title{margin:0 0 14px;font-size:11.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#1565C0}
.rt-grid{display:grid;gap:14px}
.rt-g-name{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}
.rt-g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.rt-g2{grid-template-columns:repeat(2,minmax(0,1fr))}
.rt-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.rt-label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:600;color:#334155}
.rt-req{color:#DC2626}
.rt-input{width:100%;height:44px;padding:0 14px;box-sizing:border-box;border:1px solid #DDE3EA;border-radius:10px;background:#fff;color:#0F172A;font:400 14px/1.2 inherit;font-family:inherit;transition:border-color .15s,box-shadow .15s}
textarea.rt-input{height:auto;min-height:76px;padding:11px 14px;line-height:1.5;resize:vertical}
.rt-input::placeholder{color:#A3AEBD}
.rt-input:focus{outline:none;border-color:#1565C0;box-shadow:0 0 0 3px rgba(21,101,192,.14)}
.rt-input:disabled{background:#F8FAFC;color:#94A3B8;cursor:not-allowed}
.rt-input.is-invalid{border-color:#DC2626;background:#FFFBFB}
.rt-input.is-invalid:focus{box-shadow:0 0 0 3px rgba(220,38,38,.14)}
.rt-input[type=number]{-moz-appearance:textfield;appearance:textfield}
.rt-input[type=number]::-webkit-inner-spin-button,.rt-input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.rt-money{position:relative}
.rt-money>span{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:12.5px;font-weight:600;color:#64748B;pointer-events:none}
.rt-money .rt-input{padding-left:48px}
.rt-hint{font-size:12px;line-height:1.45;color:#64748B}
.rt-hint.is-warn{color:#B45309}
.rt-err{font-size:12px;line-height:1.4;color:#DC2626}
.rt-count{font-size:11.5px;font-weight:500;color:#94A3B8}
.rt-pill{padding:2px 9px;border-radius:999px;background:#EFF6FF;color:#1565C0;font-size:11px;font-weight:600;white-space:nowrap}
.rt-link{padding:0;border:0;background:none;color:#1565C0;font:500 12px/1.4 inherit;font-family:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.rt-summary{margin-top:16px;padding:13px 16px;border:1px solid #DBEAFE;border-radius:12px;background:#F5F9FF;color:#334155;font-size:13px;line-height:1.65}
.rt-summary b{color:#0F172A}
.rt-summary .rt-total{color:#1565C0;font-size:15px}
.rt-chips{display:flex;flex-wrap:wrap;gap:8px}
.rt-chip{display:inline-flex;align-items:center;border:1px solid #E2E8F0;border-radius:999px;background:#fff;transition:background .15s,border-color .15s}
.rt-chip.is-on{border-color:#1565C0;background:#EFF6FF}
.rt-chip.is-legacy{border-style:dashed}
.rt-chip>button{border:0;background:transparent;font:400 13px/1 inherit;font-family:inherit;color:#64748B;cursor:pointer}
.rt-chip>button.rt-chip-main{padding:8px 14px;border-radius:999px}
.rt-chip.is-on>button.rt-chip-main{color:#1565C0;font-weight:600}
.rt-chip.is-editing>button.rt-chip-main{padding-right:6px}
.rt-chip-del{padding:8px 11px 8px 2px;color:#94A3B8;font-size:15px!important}
.rt-chip-del:hover{color:#DC2626}
.rt-add-row{display:flex;gap:8px;margin-top:14px;max-width:460px}
.rt-add-row .rt-input{height:40px}
.rt-drop{padding:20px 16px;border:2px dashed #DDE3EA;border-radius:12px;background:#F8FAFC;text-align:center;cursor:pointer;transition:background .15s,border-color .15s}
.rt-drop.is-over{border-color:#1565C0;background:#EFF6FF}
.rt-drop b{display:block;font-size:13.5px;color:#334155}
.rt-drop span{display:block;margin-top:2px;font-size:12px;color:#94A3B8}
.rt-photos{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
.rt-photo{position:relative;width:96px;height:72px}
.rt-photo img{width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid #E2E8F0}
.rt-photo-cover{position:absolute;left:4px;bottom:4px;padding:1px 6px;border-radius:4px;background:rgba(21,101,192,.92);color:#fff;font-size:9.5px;font-weight:700}
.rt-photo-make{position:absolute;left:4px;bottom:4px;padding:1px 6px;border:0;border-radius:4px;background:rgba(15,23,42,.72);color:#fff;font-size:9.5px;font-weight:600;cursor:pointer;opacity:0;transition:opacity .15s}
.rt-photo:hover .rt-photo-make,.rt-photo-make:focus-visible{opacity:1}
.rt-photo-del{position:absolute;top:-7px;right:-7px;width:22px;height:22px;border:0;border-radius:50%;background:#DC2626;color:#fff;font-size:11px;cursor:pointer}
.rt-foot{display:flex;align-items:center;gap:12px;padding:16px 28px;border-top:1px solid #EEF2F6;background:#fff}
.rt-foot-msg{flex:1;min-width:0;font-size:13px;color:#DC2626;line-height:1.4}
.rt-btn{height:42px;padding:0 22px;border-radius:10px;border:1px solid transparent;font:600 14px/1 inherit;font-family:inherit;cursor:pointer;white-space:nowrap}
.rt-btn.is-primary{background:#1565C0;color:#fff}
.rt-btn.is-primary:hover:not(:disabled){background:#0F4F9A}
.rt-btn.is-primary:disabled{opacity:.65;cursor:not-allowed}
.rt-btn.is-ghost{background:#fff;color:#475569;border-color:#DDE3EA}
.rt-btn.is-ghost:hover{border-color:#94A3B8}
.rt-btn.is-outline{background:#fff;color:#1565C0;border-color:#1565C0}
.rt-btn.is-outline:hover:not(:disabled){background:#EFF6FF}
.rt-btn.is-outline:disabled{color:#94A3B8;border-color:#DDE3EA;cursor:not-allowed}
.rt-btn.is-small{height:40px;padding:0 16px;font-size:13px}
.rt-x:focus-visible,.rt-btn:focus-visible,.rt-link:focus-visible,.rt-chip>button:focus-visible{outline:2px solid #1565C0;outline-offset:2px}
@media (max-width:640px){
  .rt-head,.rt-body,.rt-foot{padding-left:18px;padding-right:18px}
  .rt-g-name,.rt-g3,.rt-g2{grid-template-columns:minmax(0,1fr)}
  .rt-foot{flex-wrap:wrap}
  .rt-foot-msg{flex-basis:100%}
  .rt-btn{flex:1}
}
@media (prefers-reduced-motion:reduce){.rt-input,.rt-chip{transition:none}}
`;

const blankForm = () => ({
  type_name: "", type_code: "", description: "",
  base_rate: "", size_sqft: "", bed_config: "",
  max_adults: "", max_children: "", included_guests: "",
  extra_adult_rate: "", extra_child_rate: "",
  amenities: [], images: [],
});

const fromRecord = (r) => ({
  type_name: r.type_name || "", type_code: r.type_code || "", description: r.description || "",
  base_rate: r.base_rate ?? "", size_sqft: r.size_sqft ?? "", bed_config: r.bed_config || "",
  max_adults: r.max_adults ?? "", max_children: r.max_children ?? "", included_guests: r.included_guests ?? "",
  extra_adult_rate: Number(r.extra_adult_rate) ? r.extra_adult_rate : "",
  extra_child_rate: Number(r.extra_child_rate) ? r.extra_child_rate : "",
  amenities: Array.isArray(r.amenities) ? r.amenities : [], images: Array.isArray(r.images) ? r.images : [],
});

const blank = (v) => String(v ?? "").trim() === "";
const toNum = (v) => (blank(v) ? null : Number(v));
const wholeNumber = (v) => Number.isInteger(v) && v >= 0;
const noWheel = (e) => e.currentTarget.blur();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Who the rate covers when nobody has said otherwise: everyone the room holds.
 * Left blank until there is at least one adult to count, and adults + children
 * as soon as there is.
 */
const coveredByDefault = (adults, children) => {
  if (!wholeNumber(adults) || adults < 1) return "";
  return String(adults + (wholeNumber(children) ? children : 0));
};

function Field({ label, required, aside, hint, warn, error, children }) {
  return (
    <label className="rt-field">
      <span className="rt-label">
        <span>{label}{required && <span className="rt-req"> *</span>}</span>
        {aside}
      </span>
      {children}
      {error ? <span className="rt-err" role="alert">{error}</span>
        : hint ? <span className={`rt-hint${warn ? " is-warn" : ""}`}>{hint}</span> : null}
    </label>
  );
}

export default function RoomTypeModal({ branchId, initial, types = [], onClose, onSaved }) {
  const [form, setForm] = useState(() => (initial ? fromRecord(initial) : blankForm()));
  // "Included in the rate" follows adults + children until the owner types their own.
  const [includedManual, setIncludedManual] = useState(() => {
    if (!initial) return false;
    const f = fromRecord(initial);
    return String(f.included_guests) !== coveredByDefault(toNum(f.max_adults), toNum(f.max_children));
  });
  const snapshot = useRef(JSON.stringify({ form, includedManual }));

  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState("");
  const bodyRef = useRef(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // ─── guests and rates ──────────────────────────────────────────────────────
  const adults = toNum(form.max_adults);
  const children = toNum(form.max_children);
  const autoIncluded = coveredByDefault(adults, children);
  const included = includedManual ? form.included_guests : autoIncluded;
  const includedN = blank(included) ? null : Number(included);
  const includedOk = Number.isInteger(includedN) && includedN >= 1;
  const capacity = wholeNumber(adults) && wholeNumber(children) ? adults + children : null;
  // The rate covers the first `included` guests. A guest past that is charged,
  // even one past what the room normally holds: the desk is warned about an extra
  // bed, not stopped, and the guest pays the extra rate. So these two only wait
  // on the rate saying who it covers.
  const extrasApply = includedOk;

  const worked = useMemo(() => {
    const rate = toNum(form.base_rate);
    if (rate == null || !Number.isFinite(rate)) return null;
    const a = wholeNumber(adults) ? adults : 0;
    const c = wholeNumber(children) ? children : 0;
    if (a < 1) return null;

    const party = [plural(a, "adult", "adults"), c ? plural(c, "child", "children") : null].filter(Boolean).join(" and ");
    if (!includedOk) return { party, total: rate, lines: [] };

    const adultsIn = Math.min(a, includedN);
    const childrenIn = Math.min(c, includedN - adultsIn);
    const lines = [];
    if (a - adultsIn > 0) lines.push({ n: a - adultsIn, what: a - adultsIn === 1 ? "adult" : "adults", each: Number(form.extra_adult_rate) || 0 });
    if (c - childrenIn > 0) lines.push({ n: c - childrenIn, what: c - childrenIn === 1 ? "child" : "children", each: Number(form.extra_child_rate) || 0 });
    return { party, total: rate + lines.reduce((s, l) => s + l.n * l.each, 0), lines };
  }, [form.base_rate, form.extra_adult_rate, form.extra_child_rate, adults, children, includedOk, includedN]);

  // ─── checks: the same rules the server applies ─────────────────────────────
  const errors = useMemo(() => {
    const e = {};
    if (!form.type_name.trim()) e.type_name = "Give the room type a name.";
    else if (form.type_name.trim().length > 100) e.type_name = "Up to 100 characters.";

    if (blank(form.base_rate) || !Number.isFinite(Number(form.base_rate)) || Number(form.base_rate) < 0) {
      e.base_rate = "Set the rate per night — every booking starts from it.";
    }
    if (!blank(form.size_sqft) && (!Number.isFinite(Number(form.size_sqft)) || Number(form.size_sqft) < 0)) {
      e.size_sqft = "Enter a number of square feet.";
    }
    if (!blank(form.max_adults) && (!wholeNumber(adults) || adults < 1)) e.max_adults = "At least 1 adult, or leave blank for no limit.";
    if (!blank(form.max_children) && !wholeNumber(children)) e.max_children = "A whole number, or leave blank for no limit.";
    if (includedManual && !blank(form.included_guests)) {
      if (!Number.isInteger(includedN) || includedN < 1) e.included_guests = "At least 1 guest, or leave blank.";
      else if (capacity != null && includedN > capacity) e.included_guests = `The room only holds ${capacity}.`;
    }
    for (const [key, label] of [["extra_adult_rate", "amount"], ["extra_child_rate", "amount"]]) {
      if (!blank(form[key]) && (!Number.isFinite(Number(form[key])) || Number(form[key]) < 0)) e[key] = `Enter an ${label} of 0 or more.`;
    }
    return e;
  }, [form, adults, children, includedManual, includedN, capacity]);
  const errorCount = Object.keys(errors).length;
  const shown = attempted ? errors : {};

  // ─── facilities: the property's own list ───────────────────────────────────
  const [fac, setFac] = useState({ list: [], loading: true, error: "" });
  const [editList, setEditList] = useState(false);
  const [newFacility, setNewFacility] = useState("");
  const [facErr, setFacErr] = useState("");
  const [adding, setAdding] = useState(false);

  const loadFacilities = useCallback(async () => {
    setFac((f) => ({ ...f, loading: true, error: "" }));
    try {
      const list = await getRoomFacilities(branchId ? { b_id: branchId } : {});
      setFac({ list, loading: false, error: "" });
    } catch (ex) {
      setFac({ list: [], loading: false, error: ex?.response?.data?.message || "Couldn't load your facilities list." });
    }
  }, [branchId]);
  useEffect(() => { loadFacilities(); }, [loadFacilities]);

  const key = (s) => String(s).trim().toLowerCase();
  // A facility this room type already has, but that is no longer on the list.
  const legacy = form.amenities.filter((a) => !fac.list.some((f) => key(f.name) === key(a)));
  const isOn = (name) => form.amenities.some((a) => key(a) === key(name));
  const toggleFacility = (name) =>
    setForm((f) => ({
      ...f,
      amenities: f.amenities.some((a) => key(a) === key(name))
        ? f.amenities.filter((a) => key(a) !== key(name))
        : [...f.amenities, name],
    }));

  const addFacility = async () => {
    const name = newFacility.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (name.length > 40) { setFacErr("A facility name can be up to 40 characters."); return; }
    if (adding) return;
    setFacErr("");
    setAdding(true);
    try {
      const saved = await addRoomFacility(name, branchId ? { b_id: branchId } : {});
      setForm((f) => (f.amenities.some((a) => key(a) === key(saved.name)) ? f : { ...f, amenities: [...f.amenities, saved.name] }));
      setNewFacility("");
      // If the list never loaded, reload all of it — appending to nothing would
      // show a list of one and leave the error message in place.
      if (fac.error || fac.loading) await loadFacilities();
      else setFac((f) => (f.list.some((x) => x.facility_id === saved.facility_id) ? f : { ...f, list: [...f.list, saved] }));
    } catch (ex) {
      if (ex?.response) {
        setFacErr(ex.response.data?.message || "Couldn't add that facility.");
      } else {
        // No answer came back, so the facility may or may not have been saved:
        // say so, and read the list again so what is shown is what is stored.
        setFacErr("That took too long, so it may not have saved. Check the list above, then try again if it isn't there.");
        loadFacilities();
      }
    } finally {
      setAdding(false);
    }
  };

  const deleteFacility = async (item) => {
    setFacErr("");
    try {
      await removeRoomFacility(item.facility_id);
      setFac((f) => ({ ...f, list: f.list.filter((x) => x.facility_id !== item.facility_id) }));
      setForm((f) => ({ ...f, amenities: f.amenities.filter((a) => key(a) !== key(item.name)) }));
    } catch (ex) {
      setFacErr(ex?.response?.data?.message || "Couldn't remove that facility.");
    }
  };

  // ─── photos ────────────────────────────────────────────────────────────────
  const [imageUrl, setImageUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imgError, setImgError] = useState("");
  const fileRef = useRef(null);

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setImgError("");
    const room = MAX_PHOTOS - form.images.length;
    if (room <= 0) { setImgError(`A room type can have up to ${MAX_PHOTOS} photos.`); return; }
    setUploading(true);
    const added = [];
    for (const f of files.slice(0, room)) {
      try { added.push(await readImageFile(f)); } catch (ex) { setImgError(ex.message); }
    }
    if (files.length > room) setImgError(`Only ${MAX_PHOTOS} photos fit — the rest were skipped.`);
    if (added.length) setForm((f) => ({ ...f, images: [...f.images, ...added] }));
    setUploading(false);
  };

  const addImageUrl = () => {
    const u = imageUrl.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) { setImgError("A photo address starts with http:// or https://"); return; }
    if (form.images.length >= MAX_PHOTOS) { setImgError(`A room type can have up to ${MAX_PHOTOS} photos.`); return; }
    setImgError("");
    setForm((f) => ({ ...f, images: [...f.images, u] }));
    setImageUrl("");
  };

  const makeCover = (i) =>
    setForm((f) => ({ ...f, images: [f.images[i], ...f.images.filter((_, j) => j !== i)] }));

  // ─── closing, saving ───────────────────────────────────────────────────────
  const dirty = JSON.stringify({ form, includedManual }) !== snapshot.current;
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty && !window.confirm("Discard your changes to this room type?")) return;
    onClose();
  }, [busy, dirty, onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") requestClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [requestClose]);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setAttempted(true);
    setServerErr("");
    if (errorCount > 0) {
      setTimeout(() => {
        const el = bodyRef.current?.querySelector(".is-invalid");
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.focus?.({ preventScroll: true });
      }, 0);
      return;
    }

    setBusy(true);
    const payload = {
      b_id: branchId,
      type_name: form.type_name.trim(),
      type_code: form.type_code.trim().toUpperCase(),
      description: form.description.trim(),
      base_rate: Number(form.base_rate),
      size_sqft: blank(form.size_sqft) ? null : Number(form.size_sqft),
      bed_config: form.bed_config.trim(),
      max_adults: adults,
      max_children: children,
      included_guests: includedOk ? includedN : null,
      extra_adult_rate: Number(form.extra_adult_rate) || 0,
      extra_child_rate: Number(form.extra_child_rate) || 0,
      amenities: form.amenities,
      images: form.images,
    };
    try {
      if (initial) await updateRoomType(initial.room_type_id, payload);
      else await createRoomType(payload);
      onSaved();
    } catch (ex) {
      setServerErr(ex?.response?.data?.message || "Couldn't save the room type. Please try again.");
      setBusy(false);
    }
  };

  const bedSuggestions = useMemo(
    () => [...new Set(types.map((t) => (t.bed_config || "").trim()).filter(Boolean))],
    [types],
  );

  // ─── render ────────────────────────────────────────────────────────────────
  return (
    <div className="rt-backdrop">
      <style>{STYLES}</style>
      <form className="rt-modal" onSubmit={submit} noValidate role="dialog" aria-modal="true" aria-labelledby="rt-title">
        <div className="rt-head">
          <div>
            <h2 id="rt-title">{initial ? "Edit room type" : "Add room type"}</h2>
            <p>Set the rate, who the room holds and what it offers. Individual rooms pick from these.</p>
          </div>
          <button type="button" className="rt-x" onClick={requestClose} aria-label="Close">✕</button>
        </div>

        <div className="rt-body" ref={bodyRef}>
          {/* Basics */}
          <section className="rt-sec">
            <h3 className="rt-sec-title">Basics</h3>
            <div className="rt-grid rt-g-name">
              <Field label="Type name" required error={shown.type_name}>
                <input className={`rt-input${shown.type_name ? " is-invalid" : ""}`} value={form.type_name}
                  maxLength={100} autoFocus={!initial} placeholder="e.g. Deluxe Double Room"
                  onChange={(e) => set("type_name", e.target.value)} />
              </Field>
              <Field label="Code">
                <input className="rt-input" value={form.type_code} maxLength={20} placeholder="e.g. DBL"
                  onChange={(e) => set("type_code", e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))} />
              </Field>
            </div>
            <div style={{ marginTop: 14 }}>
              <Field label="Description" aside={<span className="rt-count">{form.description.length}/500</span>}>
                <textarea className="rt-input" rows={3} maxLength={500} value={form.description}
                  placeholder="What makes this room special…"
                  onChange={(e) => set("description", e.target.value)} />
              </Field>
            </div>
          </section>

          {/* Rate and room */}
          <section className="rt-sec">
            <h3 className="rt-sec-title">Rate &amp; room</h3>
            <div className="rt-grid rt-g3">
              <Field label="Base rate / night" required error={shown.base_rate}
                hint={!blank(form.base_rate) && Number(form.base_rate) === 0 ? "Free: every booking of this type charges nothing for the room." : null}
                warn>
                <div className="rt-money">
                  <span>LKR</span>
                  <input className={`rt-input${shown.base_rate ? " is-invalid" : ""}`} type="number" inputMode="decimal"
                    min="0" step="0.01" value={form.base_rate} placeholder="0.00" onWheel={noWheel}
                    onChange={(e) => set("base_rate", e.target.value)} />
                </div>
              </Field>
              <Field label="Bed configuration">
                <input className="rt-input" list="rt-bed-options" value={form.bed_config} maxLength={60}
                  placeholder="e.g. 1 king bed" onChange={(e) => set("bed_config", e.target.value)} />
                <datalist id="rt-bed-options">
                  {bedSuggestions.map((b) => <option key={b} value={b} />)}
                </datalist>
              </Field>
              <Field label="Size (sqft)" error={shown.size_sqft}>
                <input className={`rt-input${shown.size_sqft ? " is-invalid" : ""}`} type="number" inputMode="numeric"
                  min="0" value={form.size_sqft} placeholder="optional" onWheel={noWheel}
                  onChange={(e) => set("size_sqft", e.target.value)} />
              </Field>
            </div>
          </section>

          {/* Guests */}
          <section className="rt-sec">
            <h3 className="rt-sec-title">Guests</h3>
            <div className="rt-grid rt-g3">
              <Field label="Adults (max)" error={shown.max_adults}>
                <input className={`rt-input${shown.max_adults ? " is-invalid" : ""}`} type="number" inputMode="numeric"
                  min="1" value={form.max_adults} placeholder="no limit" onWheel={noWheel}
                  onChange={(e) => set("max_adults", e.target.value)} />
              </Field>
              <Field label="Children (max)" error={shown.max_children}>
                <input className={`rt-input${shown.max_children ? " is-invalid" : ""}`} type="number" inputMode="numeric"
                  min="0" value={form.max_children} placeholder="no limit" onWheel={noWheel}
                  onChange={(e) => set("max_children", e.target.value)} />
              </Field>
              <Field
                label="Included in the rate"
                error={shown.included_guests}
                aside={!includedManual && includedOk ? <span className="rt-pill">Auto</span> : null}
                hint={includedManual
                  ? (
                    <>
                      {includedOk ? `The rate covers ${plural(includedN, "guest", "guests")}; anyone more is charged below.` : "Blank: the rate covers the room, nobody is charged per head."}
                      {autoIncluded !== "" && (
                        <> <button type="button" className="rt-link" onClick={() => setIncludedManual(false)}>Use adults + children ({autoIncluded})</button></>
                      )}
                    </>
                  )
                  : includedOk
                    ? `Adds up from the guests above: ${plural(adults, "adult", "adults")}${wholeNumber(children) && children ? ` + ${plural(children, "child", "children")}` : ""}.`
                    : "Fills in by itself once you set the adults the room holds."}
              >
                <input className={`rt-input${shown.included_guests ? " is-invalid" : ""}`} type="number" inputMode="numeric"
                  min="1" value={included} placeholder="anyone" onWheel={noWheel}
                  onChange={(e) => { setIncludedManual(true); set("included_guests", e.target.value); }} />
              </Field>
            </div>

            <div className="rt-grid rt-g2" style={{ marginTop: 14, opacity: extrasApply ? 1 : 0.6 }}>
              <Field label="Extra adult / night" error={shown.extra_adult_rate}>
                <div className="rt-money">
                  <span>LKR</span>
                  <input className={`rt-input${shown.extra_adult_rate ? " is-invalid" : ""}`} type="number" inputMode="decimal"
                    min="0" step="0.01" value={form.extra_adult_rate} placeholder="0.00" disabled={!extrasApply} onWheel={noWheel}
                    onChange={(e) => set("extra_adult_rate", e.target.value)} />
                </div>
              </Field>
              <Field label="Extra child / night" error={shown.extra_child_rate}>
                <div className="rt-money">
                  <span>LKR</span>
                  <input className={`rt-input${shown.extra_child_rate ? " is-invalid" : ""}`} type="number" inputMode="decimal"
                    min="0" step="0.01" value={form.extra_child_rate} placeholder="0.00" disabled={!extrasApply} onWheel={noWheel}
                    onChange={(e) => set("extra_child_rate", e.target.value)} />
                </div>
              </Field>
            </div>
            <p className="rt-hint" style={{ margin: "8px 0 0" }}>
              {includedOk
                ? `Charged per night for each guest past the ${includedN} the rate covers — an extra bed, say.`
                : "The rate covers the room, whoever is in it — nobody is charged per guest."}
            </p>

            {worked && (
              <div className="rt-summary">
                <b>A full room — {worked.party}</b> — costs <b className="rt-total">{money(worked.total)}</b> a night.
                {worked.lines.length === 0 ? (
                  <>
                    {" "}The rate covers everyone the room holds.
                    {includedOk && (Number(form.extra_adult_rate) > 0 || Number(form.extra_child_rate) > 0) && (
                      <>
                        {" "}A guest past the {includedN} it covers adds {money(Number(form.extra_adult_rate) || 0)} per adult
                        or {money(Number(form.extra_child_rate) || 0)} per child a night.
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {" "}That is {money(Number(form.base_rate))} for the room
                    {worked.lines.map((l) => (
                      <span key={l.what}>, plus {money(l.each)} × {l.n} {l.what} past the {includedN} the rate covers</span>
                    ))}
                    . Nights are multiplied on top, and tax is charged on the room only.
                  </>
                )}
              </div>
            )}
          </section>

          {/* Facilities */}
          <section className="rt-sec">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <h3 className="rt-sec-title">Facilities</h3>
              {!fac.loading && !fac.error && fac.list.length > 0 && (
                <button type="button" className="rt-link" onClick={() => setEditList((v) => !v)}>
                  {editList ? "Done editing list" : "Edit list"}
                </button>
              )}
            </div>

            {fac.loading ? (
              <p className="rt-hint">Loading your facilities…</p>
            ) : fac.error ? (
              <p className="rt-err">{fac.error} <button type="button" className="rt-link" onClick={loadFacilities}>Try again</button></p>
            ) : (
              <div className="rt-chips">
                {fac.list.map((f) => (
                  <span key={f.facility_id} className={`rt-chip${isOn(f.name) ? " is-on" : ""}${editList ? " is-editing" : ""}`}>
                    <button type="button" className="rt-chip-main" aria-pressed={isOn(f.name)} onClick={() => toggleFacility(f.name)}>
                      {isOn(f.name) ? "✓ " : ""}{f.name}
                    </button>
                    {editList && (
                      <button type="button" className="rt-chip-del" onClick={() => deleteFacility(f)}
                        title={`Remove “${f.name}” from your list`} aria-label={`Remove ${f.name} from your list`}>×</button>
                    )}
                  </span>
                ))}
                {legacy.map((name) => (
                  <span key={name} className="rt-chip is-on is-legacy" title="On this room type, but no longer on your list">
                    <button type="button" className="rt-chip-main" aria-pressed="true" onClick={() => toggleFacility(name)}>✓ {name}</button>
                  </span>
                ))}
              </div>
            )}

            <div className="rt-add-row">
              <input className="rt-input" value={newFacility} maxLength={40} placeholder="Add your own — plunge pool, prayer mat…"
                onChange={(e) => setNewFacility(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFacility(); } }} />
              <button type="button" className="rt-btn is-outline is-small" onClick={addFacility} disabled={!newFacility.trim() || adding}>
                {adding ? "Adding…" : "+ Add"}
              </button>
            </div>
            {facErr && <p className="rt-err" style={{ margin: "8px 0 0" }} role="alert">{facErr}</p>}
            <p className="rt-hint" style={{ margin: "8px 0 0" }}>
              Your list is shared by every room type. Removing a facility from it doesn't take it off room types that already have it.
            </p>
          </section>

          {/* Photos */}
          <section className="rt-sec">
            <h3 className="rt-sec-title">Photos</h3>
            <div
              className={`rt-drop${dragging ? " is-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileRef.current?.click(); } }}
            >
              <b>{uploading ? "Processing…" : "Choose photos from your computer"}</b>
              <span>or drag them here · JPG or PNG · up to {MAX_PHOTOS} · resized automatically</span>
              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </div>

            <div className="rt-add-row" style={{ maxWidth: "none" }}>
              <input className="rt-input" style={{ fontSize: 13 }} value={imageUrl} placeholder="…or paste an image address"
                onChange={(e) => setImageUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addImageUrl(); } }} />
              <button type="button" className="rt-btn is-outline is-small" onClick={addImageUrl} disabled={!imageUrl.trim()}>+ Add</button>
            </div>
            {imgError && <p className="rt-err" style={{ margin: "8px 0 0" }} role="alert">{imgError}</p>}

            {form.images.length > 0 && (
              <div className="rt-photos">
                {form.images.map((img, i) => (
                  <div className="rt-photo" key={`${i}-${img.slice(-24)}`}>
                    <img src={img} alt={`Room photo ${i + 1}`} />
                    {i === 0
                      ? <span className="rt-photo-cover">COVER</span>
                      : <button type="button" className="rt-photo-make" onClick={() => makeCover(i)}>Make cover</button>}
                    <button type="button" className="rt-photo-del" aria-label={`Remove photo ${i + 1}`}
                      onClick={() => set("images", form.images.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {form.images.length > 1 && (
              <p className="rt-hint" style={{ margin: "8px 0 0" }}>The cover photo is the one shown on the room-type card.</p>
            )}
          </section>
        </div>

        <div className="rt-foot">
          <div className="rt-foot-msg" role="alert">
            {serverErr || (attempted && errorCount > 0
              ? `Please fix the ${errorCount === 1 ? "highlighted field" : `${errorCount} highlighted fields`} to continue.`
              : "")}
          </div>
          <button type="button" className="rt-btn is-ghost" onClick={requestClose}>Cancel</button>
          <button type="submit" className="rt-btn is-primary" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save changes" : "Create room type"}
          </button>
        </div>
      </form>
    </div>
  );
}
