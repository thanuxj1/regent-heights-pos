// components/branch-admin/PurchaseItemRow.jsx
import React, { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import ItemPicker from "./ItemPicker";

const num = (v) => (v === "" || v == null ? 0 : Number(v) || 0);
const show = (n) => String(Number(Number(n).toFixed(3)));
const money = (n) =>
  `LKR ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Field({ label, error, className = "", children }) {
  return (
    <div className={`ai-cell ${className}`}>
      <span className="ai-mlabel">{label}</span>
      {children}
      {error && <span className="ai-err" role="alert">{error}</span>}
    </div>
  );
}

const noWheel = (e) => e.currentTarget.blur();

/**
 * One line of a purchase. Ingredients, hotel supplies and resale products all use
 * it, so the three tabs look and behave the same; the columns that do not apply
 * to a kind (unit and minimum stock for resale products) are simply left out.
 *
 * `match` is the item already in inventory that this line's name points at, or
 * null when the line will create something new.
 */
export default function PurchaseItemRow({
  kind,
  row,
  match,
  items,
  units,
  categories = [],
  errors = {},
  autoFocus = false,
  onPatch,
  onNameChange,
  onPick,
  onCommit,
  onRemove,
  onNext,
}) {
  const isProduct = kind === "product";
  const isIngredient = kind === "ingredient";
  const [yieldOpen, setYieldOpen] = useState(Boolean(row.yield_unit || row.yield_amount));
  const rowRef = useRef(null);

  // Keyboard flow for long lists: after the name, Enter goes to the unit (new
  // items) or straight to the quantity; Enter in quantity goes to the price;
  // Enter in the price goes to the next line.
  const focusIn = (selector) => rowRef.current?.querySelector(selector)?.focus();
  const afterName = () => {
    const unitBox = rowRef.current?.querySelector(".ai-c-unit select");
    if (unitBox && !unitBox.disabled) unitBox.focus();
    else focusIn(".ai-c-qty input");
  };
  // Picking fills the unit (and the price when known), so go straight to the
  // quantity — once the row has re-rendered with what the pick filled in.
  const focusQtyNext = useRef(false);
  const pick = (item) => {
    focusQtyNext.current = true;
    onPick(item);
  };
  useEffect(() => {
    if (!focusQtyNext.current) return;
    focusQtyNext.current = false;
    focusIn(".ai-c-qty input");
  });

  const name = isProduct ? row.pro_name : row.rm_name;
  const qty = num(row.qty);
  const lineTotal = Math.round(qty * num(row.unit_price) * 100) / 100;

  const unit = match ? match.unit : row.unit;
  const unitOptions = unit && !units.includes(unit) ? [unit, ...units] : units;

  const onEnterTo = (next) => (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (typeof next === "string") focusIn(next);
    else next?.();
  };

  let hint = null;
  if (name.trim()) {
    if (isProduct) {
      if (match) {
        const have = num(match.pro_qty);
        hint = (
          <>
            <span className="ai-tag is-existing">Existing product</span>
            In the storeroom: <b>{show(have)}</b>
            {qty > 0 && <> → <b>{show(have + qty)}</b> after saving</>}
          </>
        );
      } else {
        hint = (
          <>
            <span className="ai-tag is-new">New product</span>
            <label className="ai-inline">
              Selling price
              <input
                className={`ai-input ai-sell${errors.sell_price ? " is-invalid" : ""}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder={row.unit_price !== "" ? Number(row.unit_price).toFixed(2) : "= cost"}
                aria-label="Selling price"
                value={row.sell_price || ""}
                onWheel={noWheel}
                onChange={(e) => onPatch({ sell_price: e.target.value })}
              />
            </label>
            <label className="ai-inline">
              Warn me when stock drops to
              <input
                className={`ai-input ai-min${errors.low_stock ? " is-invalid" : ""}`}
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="10"
                aria-label="Low-stock warning level"
                value={row.low_stock || ""}
                onWheel={noWheel}
                onChange={(e) => onPatch({ low_stock: e.target.value })}
              />
              pcs
            </label>
            {categories.length > 0 && (
              <label className="ai-inline">
                Category
                <select
                  className="ai-input ai-cat"
                  aria-label="Category"
                  value={row.cat_id || ""}
                  onChange={(e) => onPatch({ cat_id: e.target.value })}
                >
                  <option value="">None yet</option>
                  {categories.map((c) => <option key={c.cat_id} value={c.cat_id}>{c.cat_name}</option>)}
                </select>
              </label>
            )}
            {(errors.sell_price || errors.low_stock) && <span className="ai-err" role="alert">{errors.sell_price || errors.low_stock}</span>}
          </>
        );
      }
    } else if (match) {
      const have = num(match.stock_qty);
      hint = (
        <>
          <span className="ai-tag is-existing">Existing item</span>
          In stock: <b>{show(have)} {match.unit}</b>
          {qty > 0 && <> → <b>{show(have + qty)} {match.unit}</b> after saving</>}
        </>
      );
    } else {
      hint = (
        <>
          <span className="ai-tag is-new">New item</span>
          <label className="ai-inline">
            Warn me when stock drops to
            <input
              className={`ai-input ai-min${errors.record_level ? " is-invalid" : ""}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="0"
              aria-label="Low-stock warning level"
              value={row.record_level}
              onWheel={noWheel}
              onChange={(e) => onPatch({ record_level: e.target.value })}
            />
            {row.unit || "units"}
          </label>
          {errors.record_level && <span className="ai-err" role="alert">{errors.record_level}</span>}
          {isIngredient && (
            <button type="button" className="ai-link" onClick={() => setYieldOpen((o) => !o)} aria-expanded={yieldOpen}>
              {yieldOpen ? "Hide recipe conversion" : "Recipes use a different unit?"}
            </button>
          )}
        </>
      );
    }
  }

  return (
    <div ref={rowRef} data-row={row.key} className={`ai-row ${isProduct ? "is-product" : "is-material"}`}>
      <div className="ai-grid">
        <Field label="Item" error={errors.name} className="ai-c-name">
          <ItemPicker
            value={name}
            items={items}
            placeholder={isProduct ? "Search or type a product name" : "Search or type an item name"}
            ariaLabel="Item name"
            invalid={Boolean(errors.name)}
            autoFocus={autoFocus}
            onChange={onNameChange}
            onPick={pick}
            onCommit={onCommit}
            onEnter={afterName}
          />
        </Field>

        {!isProduct && (
          <Field label="Unit" error={errors.unit} className="ai-c-unit">
            <select
              className={`ai-input${errors.unit ? " is-invalid" : ""}`}
              aria-label="Unit"
              value={unit}
              disabled={Boolean(match)}
              title={match ? "This item already has a unit" : undefined}
              onChange={(e) => onPatch({ unit: e.target.value })}
            >
              <option value="" disabled>Select</option>
              {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        )}

        <Field label="Quantity" error={errors.qty} className="ai-c-qty">
          <input
            className={`ai-input${errors.qty ? " is-invalid" : ""}`}
            type="number"
            inputMode={isProduct ? "numeric" : "decimal"}
            min="0"
            step={isProduct ? "1" : "any"}
            placeholder="0"
            aria-label="Quantity"
            value={row.qty}
            onWheel={noWheel}
            onKeyDown={onEnterTo(".ai-c-price input")}
            onChange={(e) => onPatch({ qty: e.target.value })}
          />
        </Field>

        <Field label={isProduct ? "Cost price" : "Unit price"} error={errors.unit_price} className="ai-c-price">
          <input
            className={`ai-input${errors.unit_price ? " is-invalid" : ""}`}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            placeholder="0.00"
            aria-label="Unit price"
            value={row.unit_price}
            onWheel={noWheel}
            onKeyDown={onEnterTo(onNext)}
            onChange={(e) => onPatch({ unit_price: e.target.value })}
          />
        </Field>

        <div className="ai-cell ai-c-total">
          <span className="ai-mlabel">Total</span>
          <div className="ai-total">{money(lineTotal)}</div>
        </div>

        <div className="ai-cell ai-c-del">
          <button type="button" className="ai-icon-btn" aria-label="Remove item" title="Remove item" onClick={onRemove}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {hint && <div className="ai-hint">{hint}</div>}

      {isIngredient && !match && name.trim() && (
        <div className="ai-yield">
          {yieldOpen && (
            <div className="ai-yield-body">
              <span>
                You buy in <b>{row.unit || "…"}</b>, but recipes use
              </span>
              <select
                className="ai-input ai-yield-unit"
                aria-label="Recipe unit"
                value={row.yield_unit || ""}
                onChange={(e) => onPatch({ yield_unit: e.target.value })}
              >
                <option value="">Same unit</option>
                {units.filter((u) => u !== row.unit).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <span>
                1 {row.unit || "unit"} =
              </span>
              <input
                className={`ai-input ai-yield-amt${errors.yield ? " is-invalid" : ""}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="e.g. 500"
                aria-label="Recipe units per purchase unit"
                value={row.yield_amount || ""}
                onWheel={noWheel}
                onChange={(e) => onPatch({ yield_amount: e.target.value })}
              />
              <span>{row.yield_unit || "recipe units"}</span>
              {errors.yield && <span className="ai-err" role="alert">{errors.yield}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
