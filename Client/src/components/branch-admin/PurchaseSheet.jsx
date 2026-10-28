// components/branch-admin/PurchaseSheet.jsx
import React, { useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

/**
 * A purchase typed in like a spreadsheet. The people who receive deliveries use
 * the keyboard alone and know Excel, so the lines are a grid of cells:
 *
 *   typing fills the cell (what was there is replaced) · Tab / Enter → next cell
 *   ↑ ↓ → same column, line above / below · ← → at the edge of a cell → next cell
 *   item names complete as you type (grey text; Tab or Enter takes it, ↑ ↓ pick
 *   another while typing) · units complete the same way (k → kg)
 *   Enter on an empty item cell → onFinish (the payment box)
 *   Ctrl+Delete → remove the line · pasting rows copied from Excel fills lines
 *
 * The rows are the page's own (rm_name / pro_name, unit, qty, unit_price, …);
 * this only edits them through the callbacks, so saving, drafts and validation
 * are unchanged.
 */

const num = (v) => (v === "" || v == null ? 0 : Number(v) || 0);
const money = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (n) => String(Number(Number(n).toFixed(3)));
const cleanNum = (s) => String(s).replace(/,/g, "").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

// Rows copied from Excel (or any sheet): tab-separated cells, one line each.
// Each line gives a name, maybe a unit, and its numbers: quantity, then price
// (a third number — the line total — is ignored). Header rows are skipped.
export function parsePastedRows(text, units) {
  const toNum = (c) => {
    const t = String(c).replace(/(rs\.?|lkr)/gi, "").replace(/,/g, "").trim();
    return t !== "" && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
  };
  const out = [];
  for (const line of String(text).replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const cells = line.split("\t").map((c) => c.trim());
    let name = "";
    let unit = "";
    const nums = [];
    for (const c of cells) {
      if (c === "") continue;
      // "5 kg" in one cell: the number and the unit.
      const withUnit = c.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
      if (withUnit && units.includes(withUnit[2].toLowerCase())) {
        nums.push(Number(withUnit[1]));
        unit = withUnit[2].toLowerCase();
        continue;
      }
      const n = toNum(c);
      if (n !== null) nums.push(n);
      else if (!unit && units.includes(c.toLowerCase())) unit = c.toLowerCase();
      else if (!name) name = c;
    }
    if (!name) continue;
    // A header row: words only, and words a header would use.
    if (!nums.length && /^(item|description|name|product)s?$/i.test(name)) continue;
    out.push({ name, unit, qty: nums[0] ?? "", price: nums[1] ?? "" });
  }
  return out;
}

export default function PurchaseSheet({
  kind,
  rows,
  items,          // [{ key, code, name, meta, raw }] — what can be picked
  units,
  categories = [],
  errors = {},    // { [rowKey]: { name, unit, qty, unit_price, … } }
  matchFor,
  onNameChange,   // (key, text)
  onPick,         // (key, item)
  onPatch,        // (key, patch)
  onRemove,       // (key)
  onPaste,        // (key, parsedRows)
  onFinish,
}) {
  const isProduct = kind === "product";
  const cols = isProduct ? ["name", "qty", "price"] : ["name", "unit", "qty", "price"];
  const gridRef = useRef(null);
  const [active, setActive] = useState({ key: rows[0]?.key, col: "name" });
  // While typing an item name: the suggestions, and which one Tab/Enter takes.
  const [sugg, setSugg] = useState({ key: null, list: [], i: 0 });

  const nameOf = (r) => (isProduct ? r.pro_name : r.rm_name) || "";

  const cellEl = (key, col) => gridRef.current?.querySelector(`[data-row="${key}"] [data-col="${col}"]`);
  const focusCell = (key, col) => {
    const el = cellEl(key, col);
    if (el) { el.focus(); el.select?.(); }
  };

  const suggestionsFor = (text) => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((it) => it.name.toLowerCase().includes(q) || (it.code || "").toLowerCase() === q)
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q))
        || a.name.length - b.name.length)
      .slice(0, 6);
  };

  // The cell after this one, in reading order — skipping a unit that is fixed.
  const nextOf = (rowIdx, col, dir) => {
    let r = rowIdx;
    let c = cols.indexOf(col);
    for (;;) {
      c += dir;
      if (c >= cols.length) { c = 0; r += 1; }
      if (c < 0) { c = cols.length - 1; r -= 1; }
      if (r < 0) return null;
      if (r >= rows.length) return { key: rows[rows.length - 1].key, col: "name" };
      const row = rows[r];
      if (cols[c] === "unit" && matchFor(row)) continue;
      return { key: row.key, col: cols[c] };
    }
  };

  const takeSuggestion = (row) => {
    if (sugg.key !== row.key || !sugg.list.length) return false;
    const pick = sugg.list[sugg.i] || sugg.list[0];
    const typed = nameOf(row).trim().toLowerCase();
    // Only when what was typed is the start of it (or it was chosen with ↑↓):
    // a name typed out in full that matches nothing stays a new item.
    if (!pick.name.toLowerCase().includes(typed)) return false;
    onPick(row.key, pick);
    setSugg({ key: null, list: [], i: 0 });
    return true;
  };

  const go = (target) => {
    if (!target) return;
    setActive(target);
    // After the row has re-rendered with what the last cell filled in.
    setTimeout(() => focusCell(target.key, target.col), 0);
  };

  const onKey = (e, row, rowIdx, col) => {
    const k = e.key;
    const el = e.currentTarget;
    const typingName = col === "name" && sugg.key === row.key && sugg.list.length > 0;

    if ((k === "Delete" || k === "Backspace") && e.ctrlKey) {
      e.preventDefault();
      const next = rows[rowIdx + 1] || rows[rowIdx - 1];
      onRemove(row.key);
      if (next) go({ key: next.key, col });
      return;
    }
    if (k === "Escape") { setSugg({ key: null, list: [], i: 0 }); return; }

    if (k === "Enter" || k === "Tab") {
      e.preventDefault();
      const back = k === "Tab" && e.shiftKey;
      if (col === "name" && !back) {
        if (!nameOf(row).trim()) {
          // An empty line: the list is done.
          if (k === "Enter") onFinish?.();
          return;
        }
        const took = takeSuggestion(row);
        // A picked item has its unit already: straight to the quantity.
        if (took) return go({ key: row.key, col: "qty" });
      }
      if (col === "unit" && !back) {
        const typed = String(row.unit || "").toLowerCase();
        const hit = units.find((u) => u === typed) || units.find((u) => typed && u.startsWith(typed));
        if (hit && hit !== row.unit) onPatch(row.key, { unit: hit });
      }
      return go(nextOf(rowIdx, col, back ? -1 : 1));
    }

    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      if (typingName) {
        const n = sugg.list.length;
        setSugg((s) => ({ ...s, i: (s.i + (k === "ArrowDown" ? 1 : -1) + n) % n }));
        return;
      }
      const to = rows[rowIdx + (k === "ArrowDown" ? 1 : -1)];
      if (to) go({ key: to.key, col: col === "unit" && matchFor(to) ? "name" : col });
      return;
    }
    if (k === "ArrowRight" && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
      e.preventDefault();
      return go(nextOf(rowIdx, col, 1));
    }
    if (k === "ArrowLeft" && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault();
      return go(nextOf(rowIdx, col, -1));
    }
  };

  const onPasteCell = (e, row) => {
    const text = e.clipboardData?.getData("text") || "";
    // One value into one cell is an ordinary paste; rows or columns fill lines.
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const parsed = parsePastedRows(text, units);
    if (parsed.length) onPaste(row.key, parsed);
  };

  const activeRow = rows.find((r) => r.key === active.key) || null;
  const activeMatch = activeRow ? matchFor(activeRow) : null;
  const errorList = useMemo(() => {
    const out = [];
    rows.forEach((r, i) => {
      const e = errors[r.key];
      if (e) out.push(`Line ${i + 1}: ${Object.values(e).join(" · ")}`);
    });
    return out;
  }, [rows, errors]);

  const ghostFor = (row) => {
    if (sugg.key !== row.key || !sugg.list.length) return "";
    const typed = nameOf(row);
    const pick = sugg.list[sugg.i] || sugg.list[0];
    return pick.name.toLowerCase().startsWith(typed.toLowerCase()) ? pick.name.slice(typed.length) : "";
  };
  const unitGhost = (row) => {
    const typed = String(row.unit || "").toLowerCase();
    if (!typed || units.includes(typed)) return "";
    const hit = units.find((u) => u.startsWith(typed));
    return hit ? hit.slice(typed.length) : "";
  };

  let lineTotalSum = 0;

  return (
    <div className="ps">
      <div className="ps-scroll">
        <table className="ps-grid" ref={gridRef}>
          <colgroup>
            <col style={{ width: 36 }} />
            <col />
            {!isProduct && <col style={{ width: 82 }} />}
            <col style={{ width: 92 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 34 }} />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th>Item</th>
              {!isProduct && <th>Unit</th>}
              <th className="ps-num">Qty</th>
              <th className="ps-num">{isProduct ? "Cost price" : "Price"}</th>
              <th className="ps-num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const match = matchFor(row);
              const e = errors[row.key] || {};
              const lineTotal = Math.round(num(row.qty) * num(row.unit_price) * 100) / 100;
              lineTotalSum += lineTotal;
              const name = nameOf(row);
              const isNew = Boolean(name.trim()) && !match && !(isProduct && row.pro_id);
              const showSugg = sugg.key === row.key && sugg.list.length > 0 && active.key === row.key && active.col === "name";
              return (
                <tr key={row.key} data-row={row.key} className={active.key === row.key ? "is-active" : undefined}>
                  <td className="ps-rn">{i + 1}</td>
                  <td className={`ps-td${e.name ? " is-invalid" : ""}`}>
                    <div className="ps-namecell">
                      <span className="ps-ghostwrap">
                        <input
                          data-col="name"
                          role="combobox"
                          aria-label={`Line ${i + 1} item`}
                          aria-expanded={showSugg ? "true" : "false"}
                          className={`ps-in${e.name ? " is-invalid" : ""}`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={i === rows.length - 1 ? "Type an item…" : ""}
                          value={name}
                          title={e.name}
                          onFocus={(ev) => { setActive({ key: row.key, col: "name" }); ev.currentTarget.select(); }}
                          onBlur={() => setTimeout(() => setSugg((s) => (s.key === row.key ? { key: null, list: [], i: 0 } : s)), 120)}
                          onChange={(ev) => {
                            onNameChange(row.key, ev.target.value);
                            setSugg({ key: row.key, list: suggestionsFor(ev.target.value), i: 0 });
                          }}
                          onKeyDown={(ev) => onKey(ev, row, i, "name")}
                          onPaste={(ev) => onPasteCell(ev, row)}
                        />
                        <span className="ps-ghost" aria-hidden="true"><span>{name}</span>{ghostFor(row)}</span>
                      </span>
                      {isNew && <span className="ps-new" title="Not in your items yet — it will be added">new</span>}
                    </div>
                    {showSugg && (
                      <div className="ps-sugg" role="listbox">
                        {sugg.list.map((s, j) => (
                          <div
                            key={s.key}
                            role="option"
                            aria-selected={j === sugg.i ? "true" : "false"}
                            className={`ps-opt${j === sugg.i ? " is-on" : ""}`}
                            onMouseDown={(ev) => {
                              ev.preventDefault();
                              onPick(row.key, s);
                              setSugg({ key: null, list: [], i: 0 });
                              go({ key: row.key, col: "qty" });
                            }}
                          >
                            <span>{s.name}</span><span className="ps-meta">{s.meta}</span>
                          </div>
                        ))}
                        <div className="ps-opt-hint">Tab / Enter takes it · ↑ ↓ another · Esc keeps what you typed</div>
                      </div>
                    )}
                  </td>
                  {!isProduct && (
                    <td className={`ps-td${e.unit ? " is-invalid" : ""}`}>
                      {match ? (
                        <span className="ps-fixed" title="This item already has a unit">{match.unit}</span>
                      ) : (
                        <span className="ps-ghostwrap">
                          <input
                            data-col="unit"
                            aria-label={`Line ${i + 1} unit`}
                            className={`ps-in${e.unit ? " is-invalid" : ""}`}
                            autoComplete="off"
                            spellCheck={false}
                            value={row.unit || ""}
                            title={e.unit}
                            onFocus={(ev) => { setActive({ key: row.key, col: "unit" }); ev.currentTarget.select(); }}
                            onChange={(ev) => onPatch(row.key, { unit: ev.target.value.trim().toLowerCase() })}
                            onKeyDown={(ev) => onKey(ev, row, i, "unit")}
                            onPaste={(ev) => onPasteCell(ev, row)}
                          />
                          <span className="ps-ghost" aria-hidden="true"><span>{row.unit || ""}</span>{unitGhost(row)}</span>
                        </span>
                      )}
                    </td>
                  )}
                  <td className={`ps-td${e.qty ? " is-invalid" : ""}`}>
                    <input
                      data-col="qty"
                      aria-label={`Line ${i + 1} quantity`}
                      inputMode="decimal"
                      className={`ps-in ps-num${e.qty ? " is-invalid" : ""}`}
                      autoComplete="off"
                      value={row.qty}
                      title={e.qty}
                      onFocus={(ev) => { setActive({ key: row.key, col: "qty" }); ev.currentTarget.select(); }}
                      onChange={(ev) => onPatch(row.key, { qty: cleanNum(ev.target.value) })}
                      onKeyDown={(ev) => onKey(ev, row, i, "qty")}
                      onPaste={(ev) => onPasteCell(ev, row)}
                    />
                  </td>
                  <td className={`ps-td${e.unit_price ? " is-invalid" : ""}`}>
                    <input
                      data-col="price"
                      aria-label={`Line ${i + 1} price`}
                      inputMode="decimal"
                      className={`ps-in ps-num${e.unit_price ? " is-invalid" : ""}`}
                      autoComplete="off"
                      value={row.unit_price}
                      title={e.unit_price}
                      onFocus={(ev) => { setActive({ key: row.key, col: "price" }); ev.currentTarget.select(); }}
                      onChange={(ev) => onPatch(row.key, { unit_price: cleanNum(ev.target.value) })}
                      onKeyDown={(ev) => onKey(ev, row, i, "price")}
                      onPaste={(ev) => onPasteCell(ev, row)}
                    />
                  </td>
                  <td className="ps-td ps-num ps-total">{lineTotal ? money(lineTotal) : ""}</td>
                  <td className="ps-td ps-del">
                    {(name || row.qty || row.unit_price) && (
                      <button type="button" tabIndex={-1} className="ps-x" aria-label={`Remove line ${i + 1}`} title="Remove line (Ctrl+Delete)" onClick={() => onRemove(row.key)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td colSpan={isProduct ? 3 : 4} className="ps-foot-label">Total</td>
              <td className="ps-num ps-foot">{money(lineTotalSum)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* About the line the cursor is on: what it does to stock, and the few
          extra details a brand-new item can carry. */}
      {activeRow && nameOf(activeRow).trim() && (
        <div className="ps-detail">
          <b>{nameOf(activeRow)}</b>
          {activeMatch || (isProduct && activeRow.pro_id) ? (
            isProduct ? (
              <span>Existing product — the quantity is added to its stock.</span>
            ) : (
              <span>
                In stock {show(num(activeMatch.stock_qty))} {activeMatch.unit}
                {num(activeRow.qty) > 0 && <> → <b>{show(num(activeMatch.stock_qty) + num(activeRow.qty))} {activeMatch.unit}</b> after saving</>}
              </span>
            )
          ) : isProduct ? (
            <>
              <span className="ps-new">new product</span>
              <label>Selling price <input className="ps-mini" inputMode="decimal" value={activeRow.sell_price || ""} placeholder="= cost" onChange={(ev) => onPatch(activeRow.key, { sell_price: cleanNum(ev.target.value) })} /></label>
              <label>Warn at <input className="ps-mini" inputMode="numeric" value={activeRow.low_stock || ""} placeholder="10" onChange={(ev) => onPatch(activeRow.key, { low_stock: ev.target.value.replace(/\D/g, "") })} /> pcs</label>
              {categories.length > 0 && (
                <label>Category
                  <select className="ps-mini ps-cat" value={activeRow.cat_id || ""} onChange={(ev) => onPatch(activeRow.key, { cat_id: ev.target.value })}>
                    <option value="">None yet</option>
                    {categories.map((c) => <option key={c.cat_id} value={c.cat_id}>{c.cat_name}</option>)}
                  </select>
                </label>
              )}
            </>
          ) : (
            <>
              <span className="ps-new">new item</span>
              <label>Warn when stock drops to <input className="ps-mini" inputMode="decimal" value={activeRow.record_level || ""} placeholder="0" onChange={(ev) => onPatch(activeRow.key, { record_level: cleanNum(ev.target.value) })} /> {activeRow.unit || ""}</label>
              {kind === "ingredient" && (
                <label>Recipes count it in
                  <select className="ps-mini" value={activeRow.yield_unit || ""} onChange={(ev) => onPatch(activeRow.key, { yield_unit: ev.target.value })}>
                    <option value="">the same unit</option>
                    {units.filter((u) => u !== activeRow.unit).map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  {activeRow.yield_unit && (
                    <> 1 {activeRow.unit || "unit"} = <input className="ps-mini" inputMode="decimal" value={activeRow.yield_amount || ""} placeholder="500" onChange={(ev) => onPatch(activeRow.key, { yield_amount: cleanNum(ev.target.value) })} /> {activeRow.yield_unit}</>
                  )}
                </label>
              )}
            </>
          )}
        </div>
      )}

      {errorList.length > 0 && (
        <ul className="ps-errors" role="alert">
          {errorList.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}
