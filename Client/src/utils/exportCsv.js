/**
 * Download a table as a .csv Excel can open cleanly.
 *
 * Two things Excel gets wrong on a plain CSV, both fixed here rather than
 * left for every page to rediscover:
 *
 *   - A bare "2026-09-21" is auto-detected as a date and reformatted (or
 *     shown as ######## in a narrow column). Wrapped as `="2026-09-21"` it
 *     is forced to stay literal text instead.
 *   - Non-ASCII text (a guest's name, anything typed in Sinhala or Tamil)
 *     turns to mojibake without a UTF-8 byte-order mark leading the file.
 *
 * @param {string}   filename
 * @param {string[]} headers
 * @param {Array<Array<string|number>>} rows  Wrap a cell in dateCell() first
 *                                             if it holds a YYYY-MM-DD value.
 */
export function exportCsv(filename, headers, rows) {
  const cell = (c) => {
    const s = String(c ?? "");
    // dateCell()'s own ="..." marker rides through unescaped — it is already
    // valid CSV syntax, and quoting it again would print the formula as text.
    if (s.startsWith('="') && s.endsWith('"')) return s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = "﻿" + [headers, ...rows]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** A YYYY-MM-DD (or any) date string, protected from Excel's auto-formatting. */
export const dateCell = (v) => `="${v ?? ""}"`;
