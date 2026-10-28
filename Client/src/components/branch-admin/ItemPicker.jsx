// components/branch-admin/ItemPicker.jsx
import React, { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * A text box that suggests existing items as you type — by name or by #code —
 * and lets you carry on typing when the thing is new.
 *
 * Typing never picks anything by itself: the parent hears every keystroke
 * through onChange. While typing, the best match is highlighted, so Enter takes
 * it — workers here use the keyboard only, and having to arrow down first meant
 * "veg" + Enter quietly became a new item called "veg". A name that is really
 * new is its own last option ("+ Add as new"), reached with the arrows. Enter
 * with nothing highlighted keeps the text as typed and calls onEnter. Leaving
 * the box calls onCommit so the parent can treat an exact name as a pick.
 *
 * items: [{ key, code, name, meta }]
 */
export default function ItemPicker({
  value,
  items,
  placeholder,
  ariaLabel,
  invalid = false,
  autoFocus = false,
  onChange,
  onPick,
  onCommit,
  onEnter,
  newLabel = "item",
  allowNew = true,   // false: only what is on the list (units)
  disabled = false,
  title,
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    // Only when the row first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const away = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const q = (value || "").trim().toLowerCase();
  // Names that start with what was typed come first: "ve" finds Veg before Chives.
  const matches = useMemo(
    () =>
      items
        .filter((it) => !q || it.name.toLowerCase().includes(q) || (it.code || "").toLowerCase().includes(q))
        .sort((a, b) => (q ? Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) : 0))
        .slice(0, 10),
    [items, q],
  );
  const exact = matches.some((m) => m.name.toLowerCase() === q);
  // The last option, when the text names nothing that exists.
  const newIndex = allowNew && q && !exact ? matches.length : -1;
  const optionCount = matches.length + (newIndex >= 0 ? 1 : 0);

  const pick = (item) => {
    onPick(item);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (optionCount ? (a + 1) % optionCount : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (optionCount ? (a <= 0 ? optionCount - 1 : a - 1) : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && matches[active]) pick(matches[active]);
      else {
        // Nothing highlighted, or "+ Add as new": the name stands as typed.
        // Nothing highlighted: the name is final, so move on to the next field.
        setOpen(false);
        onEnter?.();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = !disabled && open && (matches.length > 0 || (allowNew && q));

  return (
    <div ref={wrapRef} className="ai-picker">
      <input
        ref={inputRef}
        className={`ai-input${invalid ? " is-invalid" : ""}`}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={showList ? "true" : "false"}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid ? "true" : undefined}
        autoComplete="off"
        disabled={disabled}
        title={title}
        placeholder={placeholder}
        value={value}
        onFocus={(e) => {
          setOpen(true);
          // Typing over a name already there replaces it.
          e.currentTarget.select();
        }}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
          onCommit?.(value);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          // Highlight the best match so Enter takes it.
          setActive(e.target.value.trim() ? 0 : -1);
        }}
        onKeyDown={onKeyDown}
      />

      {showList && (
        <div className="ai-picker-list" id={listId} role="listbox">
          {matches.map((m, i) => (
            <div
              key={m.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active ? "true" : "false"}
              className={`ai-picker-opt${i === active ? " is-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="ai-code">{m.code}</span>
              <span className="ai-picker-name">{m.name}</span>
              <span className="ai-picker-meta">{m.meta}</span>
            </div>
          ))}
          {newIndex >= 0 && (
            <div
              id={`${listId}-${newIndex}`}
              role="option"
              aria-selected={active === newIndex ? "true" : "false"}
              className={`ai-picker-new${active === newIndex ? " is-active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                setOpen(false);
                onEnter?.();
              }}
              onMouseEnter={() => setActive(newIndex)}
            >
              + Add <strong>“{value.trim()}”</strong> as a new {newLabel}
              {matches.length > 0 && <span className="ai-picker-meta"> (↓ to here, then Enter)</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
