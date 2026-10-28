// components/branch-admin/ExcelSheet.jsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { parsePastedRows } from "./PurchaseSheet";

/**
 * The lines of a purchase, worked exactly like an Excel sheet. The people who
 * receive deliveries use the keyboard alone and know Excel, so the sheet has a
 * selected cell, not a form with a caret:
 *
 *   arrows move the selection, always · Ctrl+arrow to the edge · Home / End
 *   typing replaces the cell (Enter mode — an arrow then finishes it and moves)
 *   F2 or a double-click edits what is there (Edit mode — ← → move in the text)
 *   Tab / Shift+Tab across, then on to the next line · Enter goes down and back
 *   to the column the tabbing began in · Delete clears · Esc cancels
 *   Ctrl+Z undo · Ctrl+C / Ctrl+V a cell or rows from Excel · Ctrl+D fill down
 *   Ctrl+Delete removes the line · Tab or Enter on the empty last line → onFinish
 *
 * Item names complete as they are typed (grey text and a list of matches; Tab
 * or Enter takes it with its unit and last price). The unit is chosen from a
 * list (type, or Alt+↓); anything that is not a unit is refused. Quantity and
 * price take numbers only. The rows are the page's own;
 * every change goes back through the callbacks, so validation, drafts and
 * saving are untouched.
 */

const NAMES = { name: "Item", unit: "Unit", qty: "Quantity", price: "Unit price" };
const num = (v) => (v === "" || v == null ? 0 : Number(v) || 0);
const clean = (v) => String(v).replace(/,/g, "").replace(/(rs\.?|lkr)/gi, "").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (n) => String(Number(Number(n).toFixed(3)));
const lower = (s) => String(s ?? "").trim().toLowerCase();
const onlyNumber = (v) => String(v).replace(/,/g, "").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
// commit() / setValue() give this back when the text is not a unit.
const BAD = "bad";
// Shown beside each unit in the list, and searched too ("kilo" finds kg).
const UNIT_HINT = {
  kg: "kilograms", g: "grams", mg: "milligrams", l: "litres", ml: "millilitres",
  pcs: "pieces", units: "units", dozen: "dozens", box: "boxes", pack: "packets",
  bag: "bags, sacks", bottle: "bottles", can: "cans, tins",
};

const STYLES = `
.xs{display:flex;flex-direction:column;min-height:0;background:#fff;border:1px solid #E4E8EE;border-radius:14px;box-shadow:0 1px 2px rgba(11,18,32,.04),0 10px 30px rgba(11,18,32,.04);overflow:hidden}
.xs-fx{display:flex;align-items:center;height:42px;border-bottom:1px solid #E4E8EE;background:#FBFCFD;flex:none}
.xs-ref{width:170px;height:100%;display:flex;align-items:center;padding:0 14px;border-right:1px solid #E4E8EE;font:600 12px ui-monospace,Consolas,monospace;color:#1D4ED8;white-space:nowrap;overflow:hidden}
.xs-fxmark{padding:0 12px;font:italic 600 13px Georgia,serif;color:#94A3B8}
.xs-fxval{flex:1;min-width:0;font-size:14px;color:#0B1220;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xs-fxnote{padding:0 14px;font-size:12px;color:#64748B;white-space:nowrap}
.xs-grid{flex:1;min-height:180px;overflow:auto;outline:none;position:relative}
.xs-grid:focus-visible{box-shadow:inset 0 0 0 2px rgba(29,78,216,.25)}
.xs-row{display:grid;border-bottom:1px solid #EDF0F4;min-width:min-content}
.xs-head{position:sticky;top:0;z-index:3;background:#F6F8FA;border-bottom:1px solid #DCE2EA}
.xs-hcell{height:34px;display:flex;align-items:center;padding:0 12px;font-size:11.5px;font-weight:600;letter-spacing:.04em;color:#64748B;border-right:1px solid #E4E8EE;text-transform:uppercase}
.xs-hcell.is-on{color:#1D4ED8;background:#E8EFFE;box-shadow:inset 0 -2px 0 #1D4ED8}
.xs-num{height:44px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#94A3B8;background:#F6F8FA;border-right:1px solid #E4E8EE}
.xs-num.is-on{background:#DCE7FD;color:#1D4ED8;font-weight:700}
.xs-cell{position:relative;height:44px;border-right:1px solid #EDF0F4;background:#fff}
.xs-row.is-on .xs-cell{background:#FBFCFE}
.xs-cell.is-sel{background:#F3F7FF !important}
.xs-cell.is-bad{background:#FEF2F2 !important}
.xs-cell.is-bad::after{content:"";position:absolute;right:0;top:0;border-style:solid;border-width:0 8px 8px 0;border-color:transparent #F04438 transparent transparent}
.xs-btn{width:100%;height:100%;border:0;background:transparent;padding:0 12px;display:flex;align-items:center;gap:8px;font:400 14.5px Inter,system-ui,sans-serif;color:#0B1220;cursor:cell;text-align:left;overflow:hidden}
.xs-btn.is-num{justify-content:flex-end;font-variant-numeric:tabular-nums}
.xs-btn.is-qty{font-weight:600}
.xs-btn.is-name{font-weight:500}
.xs-btn.is-muted{color:#64748B}
.xs-btn.is-ph{color:#A0AABA}
.xs-txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.xs-chip{flex:none;font:600 11px Inter,system-ui,sans-serif;padding:2px 7px;border-radius:999px;color:#475569;background:#EEF1F5}
.xs-chip.is-new{color:#1D4ED8;background:#E8EFFE}
.xs-sel{position:absolute;left:-1px;right:-1px;top:-1px;bottom:-1px;border:2px solid #1D4ED8;pointer-events:none;z-index:3}
.xs-handle{position:absolute;right:-4px;bottom:-4px;width:7px;height:7px;background:#1D4ED8;border:1.5px solid #fff;z-index:4;pointer-events:none}
.xs-edit{position:absolute;inset:0;z-index:2;background:#fff}
.xs-ghost{position:absolute;inset:0;padding:0 12px;display:flex;align-items:center;white-space:pre;pointer-events:none;font:inherit}
.xs-ghost>span:first-child{color:transparent}
.xs-ghost>span:last-child{color:#A0AABA}
.xs-in{position:relative;width:100%;height:100%;box-sizing:border-box;border:0;padding:0 12px;background:transparent;font:inherit;color:#0B1220;outline:none}
.xs-sugg{position:fixed;width:440px;z-index:6;background:#fff;border:1px solid #C9D2DE;border-radius:12px;box-shadow:0 16px 40px rgba(11,18,32,.18);overflow:hidden}
.xs-opt{width:100%;border:0;background:#fff;padding:9px 12px;display:flex;align-items:center;gap:10px;font:500 14px Inter,system-ui,sans-serif;color:#0B1220;cursor:pointer;text-align:left}
.xs-opt.is-on{background:#EEF3FE}
.xs-opt-meta{font-size:12px;color:#64748B;white-space:nowrap}
.xs-units{width:250px}
.xs-opt-list{max-height:262px;overflow-y:auto}
.xs-opt-bad{padding:8px 12px;background:#FEF2F2;border-bottom:1px solid #FECDCA;color:#B42318;font-size:12.5px;font-weight:500}
.xs-opt-empty{padding:10px 12px;font-size:13px;color:#64748B}
.xs-tip{position:fixed;z-index:6;white-space:nowrap;padding:6px 10px;border-radius:0 0 8px 8px;background:#B42318;color:#fff;font-size:12px;font-weight:500;box-shadow:0 6px 16px rgba(11,18,32,.18)}
.xs-caret{margin-left:auto;flex:none;width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#1D4ED8;background:#E8EFFE;cursor:pointer}
.xs-opt-hint{padding:6px 12px;border-top:1px solid #EEF1F5;font-size:11px;color:#64748B}
.xs-total{height:44px;display:flex;align-items:center;justify-content:flex-end;padding:0 12px;font:600 14px Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums;color:#0B1220;background:#FAFBFC}
.xs-detail{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;padding:10px 14px;border-top:1px solid #E4E8EE;background:#FBFCFD;font-size:13px;color:#475569;flex:none}
.xs-detail label{display:inline-flex;align-items:center;gap:6px}
.xs-mini{width:84px;height:30px;padding:0 8px;border:1px solid #D5DBE4;border-radius:7px;font:400 13px Inter,system-ui,sans-serif;color:#0B1220;background:#fff}
.xs-mini:focus{outline:2px solid #1D4ED8;outline-offset:0;border-color:#1D4ED8}
select.xs-mini{width:auto;min-width:120px}
.xs-mini.is-bad{border-color:#F04438}
.xs-new{font-size:11px;font-weight:600;color:#1D4ED8;background:#E8EFFE;padding:2px 8px;border-radius:999px}
.xs-status{height:34px;flex:none;display:flex;align-items:center;gap:18px;padding:0 14px;border-top:1px solid #E4E8EE;background:#F6F8FA;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden}
.xs-mode{display:inline-flex;align-items:center;gap:6px;font-weight:600}
.xs-mode i{width:7px;height:7px;border-radius:50%;background:currentColor}
.xs-keys{margin-left:auto;color:#64748B;overflow:hidden;text-overflow:ellipsis}
.xs-errs{margin:0;padding:8px 14px 8px 30px;border-top:1px solid #FECDCA;background:#FEF3F2;color:#B42318;font-size:12.5px;flex:none}
`;

export default function ExcelSheet({
  kind,
  rows,
  items,
  units,
  categories = [],
  errors = {},
  matchFor,
  onNameChange,
  onPick,
  onPatch,
  onRemove,
  onPaste,
  onRestore,
  onFinish,
  onSave,
  jumpTo,          // { key, col, tick } — select this cell (the first mistake)
  startCol = 0,
}) {
  const isProduct = kind === "product";
  const cols = useMemo(() => (isProduct ? ["name", "qty", "price"] : ["name", "unit", "qty", "price"]), [isProduct]);
  const [sel, setSel] = useState({ r: 0, c: startCol });
  const [mode, setMode] = useState("ready"); // ready | enter | edit
  const [draft, setDraft] = useState("");
  const [sugIdx, setSugIdx] = useState(0);
  const [note, setNote] = useState(""); // what was wrong with the last thing typed
  const [pop, setPop] = useState(null);   // where the list under the cell goes
  const tabStart = useRef(null);
  const history = useRef([]);
  const gridRef = useRef(null);
  const editRef = useRef(null);
  const wantGrid = useRef(false);

  // A different tab is a different sheet.
  useEffect(() => { setSel({ r: 0, c: 0 }); setMode("ready"); history.current = []; tabStart.current = null; }, [kind]);
  useEffect(() => {
    if (!jumpTo) return;
    const r = rows.findIndex((x) => x.key === jumpTo.key);
    if (r >= 0) { setSel({ r, c: Math.max(0, cols.indexOf(jumpTo.col)) }); setMode("ready"); gridRef.current?.focus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpTo?.tick]);
  // The selection never points past the last line.
  useEffect(() => {
    if (sel.r > rows.length - 1) setSel((s) => ({ ...s, r: Math.max(rows.length - 1, 0) }));
  }, [rows.length, sel.r]);
  useEffect(() => {
    if (mode !== "ready" && editRef.current && document.activeElement !== editRef.current) {
      const el = editRef.current;
      el.focus();
      const n = el.value.length;
      el.setSelectionRange(n, n);
    } else if (mode === "ready" && wantGrid.current) {
      wantGrid.current = false;
      gridRef.current?.focus({ preventScroll: true });
    }
  });
  useEffect(() => {
    gridRef.current?.querySelector(".xs-opt.is-on")?.scrollIntoView({ block: "nearest" });
  }, [sugIdx, mode]);
  // Lists and notes float over the page, under the cell (above it near the
  // bottom of the screen), so the sheet's own scrolling box never cuts them off.
  useLayoutEffect(() => {
    if (mode === "ready" && !note) { setPop(null); return undefined; }
    const place = () => {
      const cell = gridRef.current?.querySelector(`[data-cell="${sel.r}-${sel.c}"]`);
      if (!cell) return;
      const b = cell.getBoundingClientRect();
      const up = b.bottom + 340 > window.innerHeight && b.top > 340;
      setPop(up ? { left: b.left - 1, bottom: window.innerHeight - b.top } : { left: b.left - 1, top: b.bottom });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [mode, note, sel.r, sel.c, rows.length]);
  const popStyle = pop || { display: "none" };
  // Keep the selected cell in view.
  useEffect(() => {
    gridRef.current?.querySelector(`[data-cell="${sel.r}-${sel.c}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel.r, sel.c]);

  const nameOf = (row) => (isProduct ? row.pro_name : row.rm_name) || "";
  const valueOf = (row, key) => {
    if (!row) return "";
    if (key === "name") return nameOf(row);
    if (key === "unit") { const m = matchFor(row); return (m ? m.unit : row.unit) || ""; }
    if (key === "qty") return row.qty ?? "";
    return row.unit_price ?? "";
  };
  const locked = (row, key) => key === "unit" && Boolean(matchFor(row));

  const suggestions = (text) => {
    const t = lower(text);
    if (!t) return [];
    return items
      .filter((it) => lower(it.name).includes(t) || lower(it.code) === t)
      .sort((a, b) => Number(!lower(a.name).startsWith(t)) - Number(!lower(b.name).startsWith(t)) || a.name.length - b.name.length)
      .slice(0, 6);
  };

  // Units for the list, best first: the unit starts with the text ("k" → kg),
  // then its name does ("li" → litres, "tin" → can), then either contains it.
  // Nothing typed: every unit.
  const unitMatches = (text) => {
    const t = lower(text);
    if (!t) return units;
    const rank = (u) => {
      const hint = UNIT_HINT[u] || "";
      if (u.startsWith(t)) return 0;
      if (hint.split(/[ ,]+/).some((w) => w.startsWith(t))) return 1;
      return u.includes(t) || hint.includes(t) ? 2 : 9;
    };
    return units.filter((u) => rank(u) < 9).sort((x, y) => rank(x) - rank(y));
  };
  const unitFor = (text) => {
    const t = lower(text);
    return units.includes(t) ? t : units.find((u) => u.startsWith(t)) || null;
  };

  const remember = () => {
    history.current.push(rows.map((x) => ({ ...x })));
    if (history.current.length > 80) history.current.shift();
  };
  // Put a value into a cell, as the page understands it.
  const setValue = (row, key, value) => {
    if (!row) return null;
    if (key === "name") {
      const exact = items.find((it) => lower(it.name) === lower(value));
      if (exact) { onPick(row.key, exact); return exact; }
      onNameChange(row.key, value.trim());
      return null;
    }
    if (key === "unit") {
      if (locked(row, key)) return null;
      if (!lower(value)) { onPatch(row.key, { unit: "" }); return null; }
      const u = unitFor(value);
      if (!u) { setNote(`“${String(value).trim()}” isn't a unit`); return BAD; }
      onPatch(row.key, { unit: u });
      return null;
    }
    onPatch(row.key, key === "qty" ? { qty: clean(value) } : { unit_price: clean(value) });
    return null;
  };

  const select = (r, c) => {
    r = Math.max(0, Math.min(r, rows.length - 1));
    c = Math.max(0, Math.min(c, cols.length - 1));
    setSel({ r, c });
    setMode("ready");
    setDraft("");
    setSugIdx(0);
    setNote("");
    wantGrid.current = true;
  };
  // One step across, wrapping onto the next or previous line.
  const step = (r, c, dir) => {
    c += dir;
    if (c >= cols.length) { c = 0; r += 1; }
    if (c < 0) { c = cols.length - 1; r -= 1; }
    select(r, c);
  };
  const startEdit = (m, text) => {
    const row = rows[sel.r];
    if (locked(row, cols[sel.c])) return;
    setMode(m);
    setDraft(text);
    setSugIdx(0);
  };
  // Finish the cell being typed in. Returns the item it became, if any.
  const commit = (takeSuggestion) => {
    const row = rows[sel.r];
    const key = cols[sel.c];
    if (key === "unit") {
      // Only a unit from the list: the highlighted one, or exactly what was typed.
      if (!lower(draft)) { remember(); onPatch(row.key, { unit: "" }); return null; }
      const list = unitMatches(draft);
      const u = units.includes(lower(draft)) ? lower(draft) : list[Math.min(sugIdx, list.length - 1)];
      if (!u) { setNote(`“${draft.trim()}” isn't a unit — pick one from the list`); return BAD; }
      remember();
      onPatch(row.key, { unit: u });
      return null;
    }
    remember();
    if (key === "name" && takeSuggestion) {
      const s = suggestions(draft);
      const pick = s[Math.min(sugIdx, s.length - 1)];
      if (pick && (lower(pick.name).startsWith(lower(draft)) || sugIdx > 0)) { onPick(row.key, pick); return pick; }
    }
    return setValue(row, key, draft);
  };

  const onGridKey = (e) => {
    if (mode !== "ready") return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const row = rows[sel.r];
    const key = cols[sel.c];
    const lastEmpty = sel.r === rows.length - 1 && !nameOf(row) && !row?.qty && !row?.unit_price;

    if (ctrl && k === "Enter") { e.preventDefault(); onSave?.(); return; }
    if (ctrl && (k === "z" || k === "Z")) { e.preventDefault(); const prev = history.current.pop(); if (prev) onRestore(prev); return; }
    if (ctrl && (k === "c" || k === "C")) { try { navigator.clipboard?.writeText(valueOf(row, key)); } catch { /* no clipboard */ } return; }
    if (ctrl && (k === "d" || k === "D")) {
      e.preventDefault();
      if (sel.r > 0) { remember(); setValue(row, key, valueOf(rows[sel.r - 1], key)); }
      return;
    }
    if (ctrl && (k === "Delete" || k === "Backspace")) {
      e.preventDefault();
      remember();
      onRemove(row.key);
      wantGrid.current = true;
      return;
    }
    if (e.altKey && k === "ArrowDown" && key === "unit") { e.preventDefault(); startEdit("enter", ""); return; }
    if (k.startsWith("Arrow")) {
      e.preventDefault();
      tabStart.current = null;
      if (ctrl) {
        if (k === "ArrowDown") select(rows.length - 1, sel.c);
        else if (k === "ArrowUp") select(0, sel.c);
        else if (k === "ArrowLeft") select(sel.r, 0);
        else select(sel.r, cols.length - 1);
      } else {
        select(sel.r + (k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0), sel.c + (k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0));
      }
      return;
    }
    if (k === "Home") { e.preventDefault(); select(ctrl ? 0 : sel.r, 0); return; }
    if (k === "End") { e.preventDefault(); select(ctrl ? rows.length - 1 : sel.r, cols.length - 1); return; }
    if (k === "Tab") {
      if (!e.shiftKey && sel.c === 0 && lastEmpty) { onFinish?.(); return; } // leave the sheet the normal way
      e.preventDefault();
      if (tabStart.current == null) tabStart.current = sel.c;
      step(sel.r, sel.c, e.shiftKey ? -1 : 1);
      return;
    }
    if (k === "Enter") {
      e.preventDefault();
      if (sel.c === 0 && lastEmpty) { onFinish?.(); return; }
      const back = tabStart.current ?? sel.c;
      tabStart.current = null;
      select(sel.r + (e.shiftKey ? -1 : 1), back);
      return;
    }
    if (k === "F2") { e.preventDefault(); startEdit("edit", valueOf(row, key)); return; }
    if (k === "Delete") { e.preventDefault(); if (!locked(row, key)) { remember(); setValue(row, key, ""); } return; }
    if (k === "Backspace") { e.preventDefault(); startEdit("enter", ""); return; }
    if (k.length === 1 && !ctrl && !e.altKey) {
      e.preventDefault();
      if (key === "unit" && !/[a-z]/i.test(k)) {
        // A number in the unit: open the list instead, and say why.
        startEdit("enter", "");
        setNote("Units are words — pick one from the list");
        return;
      }
      if ((key === "qty" || key === "price") && !/[0-9.]/.test(k)) { setNote(`${NAMES[key]} takes numbers only`); return; }
      setNote("");
      startEdit("enter", k);
    }
  };

  const onEditKey = (e) => {
    e.stopPropagation();
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = cols[sel.c];
    const sugg = key === "name" ? suggestions(draft) : key === "unit" ? unitMatches(draft) : [];
    if (ctrl && k === "Enter") { e.preventDefault(); if (commit(true) === BAD) return; setMode("ready"); wantGrid.current = true; setTimeout(() => onSave?.(), 0); return; }
    if (k === "Escape") { e.preventDefault(); setMode("ready"); setDraft(""); setNote(""); wantGrid.current = true; return; }
    if ((k === "ArrowDown" || k === "ArrowUp") && sugg.length) {
      e.preventDefault();
      setSugIdx((i) => (i + (k === "ArrowDown" ? 1 : -1) + sugg.length) % sugg.length);
      return;
    }
    if (k === "Tab") {
      e.preventDefault();
      const picked = commit(true);
      if (picked === BAD) return;
      if (tabStart.current == null) tabStart.current = sel.c;
      // A known item brings its unit: straight on to the quantity.
      if (picked && !e.shiftKey && cols[sel.c + 1] === "unit") select(sel.r, sel.c + 2);
      else step(sel.r, sel.c, e.shiftKey ? -1 : 1);
      return;
    }
    if (k === "Enter") {
      e.preventDefault();
      if (commit(true) === BAD) return;
      const back = tabStart.current ?? sel.c;
      tabStart.current = null;
      select(sel.r + (e.shiftKey ? -1 : 1), back);
      return;
    }
    if (k.startsWith("Arrow") && (mode === "enter" || k === "ArrowDown" || k === "ArrowUp")) {
      // Enter mode: an arrow finishes the cell and moves, as in Excel. Edit mode
      // (F2): left and right move inside the text.
      e.preventDefault();
      if (commit(key === "name" && k === "ArrowRight") === BAD) return;
      tabStart.current = null;
      select(sel.r + (k === "ArrowDown" ? 1 : k === "ArrowUp" ? -1 : 0), sel.c + (k === "ArrowRight" ? 1 : k === "ArrowLeft" ? -1 : 0));
    }
  };

  const onGridPaste = (e) => {
    if (mode !== "ready") return;
    const text = e.clipboardData?.getData("text") || "";
    if (!text) return;
    e.preventDefault();
    const row = rows[sel.r];
    remember();
    if (!/[\t\n]/.test(text.trim())) { setValue(row, cols[sel.c], text.trim()); return; }
    const parsed = parsePastedRows(text, units);
    if (parsed.length) onPaste(row.key, parsed);
  };

  // ── what is shown ──
  const selRow = rows[sel.r];
  const selKey = cols[sel.c];
  const selMatch = selRow ? matchFor(selRow) : null;
  const editing = mode !== "ready";
  // The item column keeps room for a name; on a narrow screen the sheet scrolls sideways.
  const gridCols = isProduct ? "44px minmax(180px,1fr) 110px 124px 120px" : "44px minmax(180px,1fr) 84px 100px 116px 120px";
  const filledRows = rows.filter((x) => nameOf(x) || x.qty !== "" || x.unit_price !== "");
  const sum = filledRows.reduce((s, x) => s + num(x.qty) * num(x.unit_price), 0);
  const errorList = rows.flatMap((x, i) => (errors[x.key] ? [`Line ${i + 1}: ${Object.values(errors[x.key]).join(" · ")}`] : []));
  const sugg = !editing ? [] : selKey === "name" ? suggestions(draft) : selKey === "unit" ? unitMatches(draft) : [];
  const si = Math.min(sugIdx, Math.max(sugg.length - 1, 0));
  let ghost = "";
  if (editing && selKey === "name" && sugg[si] && lower(sugg[si].name).startsWith(lower(draft))) ghost = sugg[si].name.slice(draft.length);
  if (editing && selKey === "unit" && draft && sugg[si]?.startsWith(lower(draft))) ghost = sugg[si].slice(draft.length);
  const stockOf = (m) => num(isProduct ? (m.pro_qty ?? m.stock_qty) : m.stock_qty);
  const unitOf = (row, m) => (isProduct ? "pcs" : (m ? m.unit : row.unit) || "");

  return (
    <div className="xs">
      <style>{STYLES}</style>
      <div className="xs-fx">
        <div className="xs-ref">Line {sel.r + 1} · {selKey === "price" && isProduct ? "Cost price" : NAMES[selKey]}</div>
        <div className="xs-fxmark" aria-hidden="true">fx</div>
        <div className="xs-fxval">{editing ? draft : (selKey === "price" && selRow?.unit_price ? fmt(selRow.unit_price) : valueOf(selRow, selKey))}</div>
        <div className="xs-fxnote">
          {selKey === "unit" && selMatch ? "comes with the item" : selKey === "name" && selMatch ? `${showStock(selMatch)} in stock` : ""}
        </div>
      </div>

      <div
        ref={gridRef}
        id="ai-sheet"
        className="xs-grid"
        role="grid"
        aria-label="Items bought"
        tabIndex={0}
        onKeyDown={onGridKey}
        onPaste={onGridPaste}
      >
        <div className="xs-row xs-head" style={{ gridTemplateColumns: gridCols }} role="row">
          <div className="xs-hcell" />
          {cols.map((key, c) => (
            <div key={key} role="columnheader" className={`xs-hcell${c === sel.c ? " is-on" : ""}`} style={key === "qty" || key === "price" ? { justifyContent: "flex-end" } : undefined}>
              {key === "price" && isProduct ? "Cost price" : NAMES[key]}
            </div>
          ))}
          <div className="xs-hcell" style={{ justifyContent: "flex-end" }}>Total</div>
        </div>

        {rows.map((row, r) => {
          const m = matchFor(row);
          const e = errors[row.key] || {};
          const name = nameOf(row);
          const lineTotal = num(row.qty) * num(row.unit_price);
          return (
            <div key={row.key} role="row" className={`xs-row${r === sel.r ? " is-on" : ""}`} style={{ gridTemplateColumns: gridCols }} data-row={row.key}>
              <div className={`xs-num${r === sel.r ? " is-on" : ""}`}>{r + 1}</div>
              {cols.map((key, c) => {
                const isSel = r === sel.r && c === sel.c;
                const isEdit = isSel && editing;
                const bad = Boolean(e[key === "price" ? "unit_price" : key]);
                const numeric = key === "qty" || key === "price";
                let text = valueOf(row, key);
                let cls = "xs-btn";
                if (numeric) cls += " is-num";
                if (key === "qty") cls += " is-qty";
                if (key === "name") cls += " is-name";
                if (key === "unit" && m) cls += " is-muted";
                if (key === "price" && text !== "") text = fmt(text);
                if (key === "name" && !name && r === rows.length - 1 && !isSel) { text = "Type an item…"; cls += " is-ph"; }
                const unitPick = key === "unit" && isSel && !editing && !m;
                if (unitPick && !text) { text = "kg, pcs…"; cls += " is-ph"; }
                let chip = null;
                if (unitPick) {
                  chip = (
                    <span
                      className="xs-caret"
                      title="Choose a unit (Alt+↓)"
                      onMouseDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); startEdit("enter", ""); }}
                    >▾</span>
                  );
                }
                if (key === "name" && name) {
                  if (m && (m.stock_qty != null || m.pro_qty != null)) {
                    const have = stockOf(m);
                    chip = <span className="xs-chip">{num(row.qty) > 0 ? `${show(have)} → ${show(have + num(row.qty))} ${unitOf(row, m)}` : `${show(have)} ${unitOf(row, m)} in stock`}</span>;
                  } else if (!m) chip = <span className="xs-chip is-new">New</span>;
                }
                return (
                  <div key={key} role="gridcell" aria-selected={isSel} data-cell={`${r}-${c}`} className={`xs-cell${isSel ? " is-sel" : ""}${bad ? " is-bad" : ""}`} title={bad ? e[key === "price" ? "unit_price" : key] : undefined}>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={cls}
                      aria-label={`Line ${r + 1} ${NAMES[key]}${text ? `: ${text}` : ""}`}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        if (editing) commit(false);
                        tabStart.current = null;
                        select(r, c);
                      }}
                      onDoubleClick={(ev) => { ev.preventDefault(); select(r, c); setTimeout(() => { if (!locked(row, key)) { setMode("edit"); setDraft(valueOf(row, key)); } }, 0); }}
                    >
                      <span className="xs-txt">{text}</span>
                      {chip}
                    </button>
                    {isEdit && (
                      <div className="xs-edit" style={{ font: key === "qty" ? "600 14.5px Inter,system-ui,sans-serif" : key === "name" ? "500 14.5px Inter,system-ui,sans-serif" : "400 14.5px Inter,system-ui,sans-serif" }}>
                        <span className="xs-ghost" style={numeric ? { justifyContent: "flex-end" } : undefined}><span>{draft}</span><span>{ghost}</span></span>
                        <input
                          ref={editRef}
                          className="xs-in"
                          style={numeric ? { textAlign: "right" } : undefined}
                          autoComplete="off"
                          spellCheck={false}
                          inputMode={numeric ? "decimal" : undefined}
                          aria-label={`Line ${r + 1} ${NAMES[key]}`}
                          value={draft}
                          onChange={(ev) => {
                            let v = ev.target.value;
                            if (key === "unit") {
                              const only = v.replace(/[^a-zA-Z]/g, "");
                              setNote(only === v ? "" : "Units are words — pick one from the list");
                              v = only;
                            } else if (numeric) {
                              const only = onlyNumber(v);
                              setNote(only === v.replace(/,/g, "") ? "" : `${NAMES[key]} takes numbers only`);
                              v = only;
                            }
                            setDraft(v);
                            setSugIdx(0);
                          }}
                          onKeyDown={onEditKey}
                          // Leaving the cell with something that is not a unit drops it.
                          onBlur={() => { if (mode !== "ready") { commit(false); setMode("ready"); setNote(""); } }}
                        />
                      </div>
                    )}
                    {isSel && <><div className="xs-sel" /><div className="xs-handle" /></>}
                    {isEdit && key === "unit" && (
                      <div className="xs-sugg xs-units" role="listbox" aria-label="Units" style={popStyle}>
                        {note && <div className="xs-opt-bad" role="alert">{note}</div>}
                        <div className="xs-opt-list">
                          {sugg.length ? sugg.map((u, j) => (
                            <button
                              key={u}
                              type="button"
                              tabIndex={-1}
                              role="option"
                              aria-selected={j === si}
                              className={`xs-opt${j === si ? " is-on" : ""}`}
                              onMouseDown={(ev) => {
                                ev.preventDefault();
                                remember();
                                onPatch(row.key, { unit: u });
                                setMode("ready");
                                select(r, c + 1);
                              }}
                            >
                              <span style={{ flex: 1, fontWeight: 600 }}>{u}</span>
                              <span className="xs-opt-meta">{UNIT_HINT[u]}</span>
                            </button>
                          )) : <div className="xs-opt-empty">No unit matches “{draft}”</div>}
                        </div>
                        <div className="xs-opt-hint">↑ ↓ choose · Tab or Enter takes it · Esc cancels</div>
                      </div>
                    )}
                    {isSel && note && !(isEdit && key === "unit") && <div className="xs-tip" role="alert" style={popStyle}>{note}</div>}
                    {isEdit && key === "name" && sugg.length > 0 && (
                      <div className="xs-sugg" role="listbox" aria-label="Matching items" style={popStyle}>
                        {sugg.map((s, j) => (
                          <button
                            key={s.key}
                            type="button"
                            tabIndex={-1}
                            role="option"
                            aria-selected={j === si}
                            className={`xs-opt${j === si ? " is-on" : ""}`}
                            onMouseDown={(ev) => {
                              ev.preventDefault();
                              remember();
                              onPick(row.key, s);
                              setMode("ready");
                              select(r, cols.indexOf("qty"));
                            }}
                          >
                            <span style={{ flex: 1 }}>{s.name}</span>
                            <span className="xs-opt-meta">{s.meta}</span>
                          </button>
                        ))}
                        <div className="xs-opt-hint">Tab or Enter takes it · ↑ ↓ another · Esc cancels</div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="xs-total">{lineTotal ? fmt(lineTotal) : ""}</div>
            </div>
          );
        })}
      </div>

      {/* The line the cursor is on: the few details a new item can take. */}
      {selRow && nameOf(selRow) && !selMatch && (
        <div className="xs-detail">
          <span className="xs-new">New {isProduct ? "product" : "item"}</span>
          <b style={{ color: "#0B1220" }}>{nameOf(selRow)}</b>
          {isProduct ? (
            <>
              <label>Selling price <input className={`xs-mini${errors[selRow.key]?.sell_price ? " is-bad" : ""}`} inputMode="decimal" placeholder="= cost" value={selRow.sell_price || ""} onChange={(ev) => onPatch(selRow.key, { sell_price: clean(ev.target.value) })} /></label>
              <label>Warn when stock drops to <input className={`xs-mini${errors[selRow.key]?.low_stock ? " is-bad" : ""}`} inputMode="numeric" placeholder="10" value={selRow.low_stock || ""} onChange={(ev) => onPatch(selRow.key, { low_stock: ev.target.value.replace(/\D/g, "") })} /> pcs</label>
              {categories.length > 0 && (
                <label>Category
                  <select className="xs-mini" value={selRow.cat_id || ""} onChange={(ev) => onPatch(selRow.key, { cat_id: ev.target.value })}>
                    <option value="">None yet</option>
                    {categories.map((c) => <option key={c.cat_id} value={c.cat_id}>{c.cat_name}</option>)}
                  </select>
                </label>
              )}
            </>
          ) : (
            <>
              <label>Warn when stock drops to <input className={`xs-mini${errors[selRow.key]?.record_level ? " is-bad" : ""}`} inputMode="decimal" placeholder="0" value={selRow.record_level || ""} onChange={(ev) => onPatch(selRow.key, { record_level: clean(ev.target.value) })} /> {selRow.unit || ""}</label>
              {kind === "ingredient" && (
                <label>Recipes count it in
                  <select className={`xs-mini${errors[selRow.key]?.yield ? " is-bad" : ""}`} value={selRow.yield_unit || ""} onChange={(ev) => onPatch(selRow.key, { yield_unit: ev.target.value })}>
                    <option value="">the same unit</option>
                    {units.filter((u) => u !== selRow.unit).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  {selRow.yield_unit && <> · 1 {selRow.unit || "unit"} = <input className="xs-mini" inputMode="decimal" placeholder="500" value={selRow.yield_amount || ""} onChange={(ev) => onPatch(selRow.key, { yield_amount: clean(ev.target.value) })} /> {selRow.yield_unit}</>}
                </label>
              )}
            </>
          )}
        </div>
      )}

      {errorList.length > 0 && <ul className="xs-errs" role="alert">{errorList.map((t) => <li key={t}>{t}</li>)}</ul>}

      <div className="xs-status">
        <span className="xs-mode" style={{ color: mode === "ready" ? "#16A34A" : "#1D4ED8" }}><i />{mode === "ready" ? "Ready" : mode === "enter" ? "Enter" : "Edit"}</span>
        <span>{filledRows.length ? `${filledRows.length} line${filledRows.length === 1 ? "" : "s"}  ·  Sum LKR ${fmt(sum)}` : "Click a cell, or just start typing"}</span>
        <span className="xs-keys">Tab →  ·  Enter ↓  ·  F2 edit  ·  Ctrl+Z undo  ·  Ctrl+V paste rows  ·  Ctrl+D fill down  ·  Ctrl+Del remove line</span>
      </div>
    </div>
  );

  function showStock(m) { return `${show(stockOf(m))} ${unitOf(selRow, m)}`; }
}
