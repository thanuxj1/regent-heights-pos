// components/branch-admin/ItemPicker.jsx
import React, { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * A text box that suggests existing items as you type — by name or by #code —
 * and lets you carry on typing when the thing is new.
 *
 * Typing never picks anything by itself: the parent hears every keystroke
 * through onChange, and only a click, or Enter after arrowing to a suggestion,
 * calls onPick. Leaving the box calls onCommit so the parent can treat an exact
 * name as a pick.
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
  const matches = useMemo(
    () =>
      items
        .filter((it) => !q || it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q))
        .slice(0, 10),
    [items, q],
  );

  const pick = (item) => {
    onPick(item);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (matches.length ? (a + 1) % matches.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (matches.length ? (a <= 0 ? matches.length - 1 : a - 1) : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && active >= 0 && matches[active]) pick(matches[active]);
      else {
        // Nothing highlighted: the name is final, so move on to the next field.
        setOpen(false);
        onEnter?.();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = open && (matches.length > 0 || q);

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
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
          onCommit?.(value);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
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
          {q && !matches.some((m) => m.name.toLowerCase() === q) && (
            <div className="ai-picker-new">
              No item called <strong>“{value.trim()}”</strong> yet — it will be added as new.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
