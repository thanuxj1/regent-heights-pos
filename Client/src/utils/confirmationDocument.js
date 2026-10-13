// The booking confirmation as a file — an A4 PDF or a PNG picture — drawn
// directly from the booking, not photographed off the screen. A screenshot of the
// page (html2canvas) set text a few pixels low against its boxes and lines, and
// carried the on-screen card's border; drawing it places every line exactly, and
// the PDF's text stays sharp and searchable. One layout draws both files, so the
// PDF and the picture always match.
import { jsPDF } from "jspdf";

const PAGE_W = 210;           // A4, millimetres
const PAGE_H = 297;
const M = 16;                 // page margin
const RIGHT = PAGE_W - M;
const PT = 0.3528;            // one point in millimetres

const C = {
  ink: "#1E293B", muted: "#64748B", soft: "#475569", line: "#E2E8F0",
  head: "#F1F5F9", red: "#B91C1C",
};

// ── Two ways to draw the same thing ────────────────────────────────────────

function pdfPainter(doc) {
  const font = (size, bold) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); };
  return {
    width: (s, size, bold) => { font(size, bold); return doc.getTextWidth(String(s)); },
    text(s, x, y, { size = 10, bold = false, color = C.ink, align = "left" } = {}) {
      font(size, bold); doc.setTextColor(color);
      doc.text(String(s), x, y, { align, baseline: "alphabetic" });
    },
    line(x1, y1, x2, y2, { color = C.line, width = 0.2 } = {}) {
      doc.setDrawColor(color); doc.setLineWidth(width); doc.line(x1, y1, x2, y2);
    },
    rect(x, y, w, h, { fill, stroke, width = 0.2 } = {}) {
      if (fill) doc.setFillColor(fill);
      if (stroke) { doc.setDrawColor(stroke); doc.setLineWidth(width); }
      doc.rect(x, y, w, h, fill && stroke ? "FD" : fill ? "F" : "S");
    },
    image(img, x, y, w, h) { doc.addImage(img.dataUrl, "PNG", x, y, w, h); },
  };
}

function canvasPainter(ctx, scale) {
  const font = (size, bold) => { ctx.font = `${bold ? "bold " : ""}${size * PT * scale}px Helvetica, Arial, sans-serif`; };
  return {
    width: (s, size, bold) => { font(size, bold); return ctx.measureText(String(s)).width / scale; },
    text(s, x, y, { size = 10, bold = false, color = C.ink, align = "left" } = {}) {
      font(size, bold); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
      ctx.fillText(String(s), x * scale, y * scale);
    },
    line(x1, y1, x2, y2, { color = C.line, width = 0.2 } = {}) {
      ctx.strokeStyle = color; ctx.lineWidth = width * scale;
      ctx.beginPath(); ctx.moveTo(x1 * scale, y1 * scale); ctx.lineTo(x2 * scale, y2 * scale); ctx.stroke();
    },
    rect(x, y, w, h, { fill, stroke, width = 0.2 } = {}) {
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x * scale, y * scale, w * scale, h * scale); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width * scale; ctx.strokeRect(x * scale, y * scale, w * scale, h * scale); }
    },
    image(img, x, y, w, h) { ctx.drawImage(img.el, x * scale, y * scale, w * scale, h * scale); },
  };
}

/** Measures only: used once to find how tall the page has to be. */
function measurePainter(probe) {
  return { width: probe.width, text() {}, line() {}, rect() {}, image() {} };
}

// ── Layout helpers ─────────────────────────────────────────────────────────

/** Words of one or more styled runs, wrapped to maxW. Returns lines of runs. */
function wrapRuns(p, runs, size, maxW) {
  const words = [];
  for (const r of runs) {
    String(r.text).split(/(\s+)/).filter((w) => w !== "").forEach((w) => words.push({ text: w, bold: !!r.bold }));
  }
  const lines = [[]];
  let width = 0;
  for (const w of words) {
    const isSpace = /^\s+$/.test(w.text);
    const ww = p.width(w.text, size, w.bold);
    if (!isSpace && width + ww > maxW && lines[lines.length - 1].length) {
      lines.push([]); width = 0;
    }
    if (isSpace && width === 0) continue;
    lines[lines.length - 1].push(w); width += ww;
  }
  return lines;
}

function drawRuns(p, lines, x, y, { size, color, lineH }) {
  lines.forEach((line, i) => {
    let cx = x;
    for (const w of line) {
      p.text(w.text, cx, y + i * lineH, { size, bold: w.bold, color });
      cx += p.width(w.text, size, w.bold);
    }
  });
  return y + (lines.length - 1) * lineH;
}

/** Cut a value to fit a width, with an ellipsis. */
function clamp(p, s, size, bold, maxW) {
  let t = String(s ?? "");
  if (p.width(t, size, bold) <= maxW) return t;
  while (t.length > 1 && p.width(`${t}…`, size, bold) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

// ── The confirmation ───────────────────────────────────────────────────────

/** Draws the confirmation; returns the y where it ended. */
function layout(p, d) {
  let y = M;

  // Header: the property on the left, the document on the right.
  let leftY = y;
  if (d.logo) {
    const h = 17;
    const w = Math.min(60, (d.logo.w / d.logo.h) * h);
    p.image(d.logo, M, leftY, w, h);
    leftY += h + 4;
  }
  leftY += 13 * PT;
  p.text(d.hotelName, M, leftY, { size: 13, bold: true });
  for (const l of d.hotelLines) {
    leftY += 4.2;
    // Below the title block, so the whole page width is free.
    p.text(clamp(p, l, 8, false, RIGHT - M), M, leftY, { size: 8, color: C.muted });
  }
  p.text("BOOKING CONFIRMATION", RIGHT, y + 6, { size: 12, bold: true, align: "right" });
  for (const [i, [k, v]] of [["Booking Ref:", d.ref], ["Booking Date:", d.bookingDate]].entries()) {
    const ry = y + 12.5 + i * 5;
    p.text(v, RIGHT, ry, { size: 9, align: "right" });
    p.text(k, RIGHT - p.width(v, 9, false) - 1.5, ry, { size: 9, bold: true, align: "right" });
  }
  y = Math.max(leftY, y + 22) + 4;
  p.line(M, y, RIGHT, y, { color: C.ink, width: 0.6 });

  // Greeting.
  y += 8;
  p.text(`Dear ${d.guestName},`, M, y, { size: 10 });
  y += 5.5;
  const greet = wrapRuns(p, [
    { text: `Thank you for choosing ${d.hotelShort}. We are pleased to inform you that your reservation is ` },
    { text: "CONFIRMED", bold: true },
    { text: " and your details are as follows:" },
  ], 10, RIGHT - M);
  y = drawRuns(p, greet, M, y, { size: 10, color: C.ink, lineH: 5 });

  // Reservation details, two columns.
  y += 10;
  p.text("RESERVATION DETAILS", M, y, { size: 9, bold: true });
  y += 6.5;
  const colX = [M, 110];
  const colW = 84;
  const keyW = 31;
  const rowH = 5.6;
  const col = (rows, x) => {
    let cy = y;
    for (const [k, v] of rows) {
      p.text(k, x, cy, { size: 9, color: C.muted });
      const lines = wrapRuns(p, [{ text: v || "—", bold: true }], 9, colW - keyW).slice(0, 3);
      cy = drawRuns(p, lines, x + keyW, cy, { size: 9, color: C.ink, lineH: 4.4 }) + rowH;
    }
    return cy;
  };
  y = Math.max(col(d.left, colX[0]), col(d.right, colX[1])) + 3;

  // Room details table.
  p.text("ROOM DETAILS", M, y, { size: 9, bold: true });
  y += 3;
  const cols = [
    ["Room Type", 38, "left"], ["Pax", 26, "left"], ["Rooms", 16, "left"],
    ["Package / Plan", 40, "left"], ["Promotion", 26, "left"], ["Rate (LKR)", 32, "right"],
  ];
  const tableRow = (cells, top, { head = false } = {}) => {
    const h = 8;
    if (head) p.rect(M, top, RIGHT - M, h, { fill: C.head });
    let x = M;
    cells.forEach((cell, i) => {
      const [, w, align] = cols[i];
      p.rect(x, top, w, h, { stroke: C.line, width: 0.25 });
      const text = clamp(p, cell, 9, head, w - 4);
      p.text(text, align === "right" ? x + w - 2 : x + 2, top + 5.3, { size: 9, bold: head, align });
      x += w;
    });
    return top + h;
  };
  y = tableRow(cols.map((c) => c[0]), y, { head: true });
  for (const r of d.rooms) y = tableRow(r, y);

  // Total due, and the breakdown beside it.
  y += 8;
  const boxW = 84;
  const boxH = 26;
  p.rect(M, y, boxW, boxH, { stroke: C.ink, width: 0.6 });
  p.text("TOTAL AMOUNT DUE", M + boxW / 2, y + 9.5, { size: 10, bold: true, align: "center" });
  p.text(d.totalDue, M + boxW / 2, y + 19.5, { size: 16, bold: true, align: "center" });

  const bx = 108;
  let by = y + 3;
  p.text("RATE DETAILS BREAKDOWN", bx, by, { size: 9, bold: true });
  by += 6.5;
  for (const r of d.breakdown) {
    if (r.strong) { p.line(bx, by - 4.2, RIGHT, by - 4.2, { color: "#CBD5E1", width: 0.25 }); by += 0.8; }
    p.text(r.k, bx, by, { size: 9, bold: r.strong, color: r.strong ? C.ink : C.muted });
    p.text(r.v, RIGHT, by, { size: 9, bold: true, color: r.red ? C.red : C.ink, align: "right" });
    by += r.strong ? 6.4 : 5.6;
  }
  y = Math.max(y + boxH, by - 2);

  // Terms.
  if (d.terms.length) {
    y += 8;
    p.line(M, y, RIGHT, y, { color: C.line, width: 0.25 });
    y += 7;
    p.text("Terms & Conditions / Stay Policies", M, y, { size: 9, bold: true });
    d.terms.forEach((t, i) => {
      y += 5;
      p.text(`${i + 1}.`, M + 1, y, { size: 8, color: C.soft });
      const lines = wrapRuns(p, [{ text: t }], 8, RIGHT - M - 7);
      y = drawRuns(p, lines, M + 6, y, { size: 8, color: C.soft, lineH: 3.9 });
    });
  }
  return y + M;
}

// ── Files ──────────────────────────────────────────────────────────────────

/** A4 tall, or taller if a booking has so many rooms that it runs over. Measured
 *  with the same painter that will draw, so text widths (and so wrapping) agree. */
function pageHeight(d, probe) {
  return Math.max(PAGE_H, layout(measurePainter(probe), d));
}

export function confirmationPdf(d) {
  const h = pageHeight(d, pdfPainter(new jsPDF({ unit: "mm", format: "a4" })));
  const doc = new jsPDF({ unit: "mm", format: h > PAGE_H ? [PAGE_W, h] : "a4" });
  doc.setProperties({ title: `Booking confirmation ${d.ref}` });
  layout(pdfPainter(doc), d);
  return doc.output("blob");
}

export function confirmationImage(d, { scale = 6 } = {}) {   // 6 px/mm ≈ 150 dpi
  const probe = document.createElement("canvas").getContext("2d");
  const h = pageHeight(d, canvasPainter(probe, scale));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(PAGE_W * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  layout(canvasPainter(ctx, scale), d);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No image"))), "image/png"));
}

/** The property's logo as something both files can draw; null if it will not load. */
export function loadLogo(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => {
      try {
        // Printed 17 mm tall: 240 px is plenty for print and keeps the PDF small
        // enough to send on WhatsApp (the full-size logo made it 1.4 MB).
        const k = Math.min(1, 240 / el.naturalHeight);
        const c = document.createElement("canvas");
        c.width = Math.round(el.naturalWidth * k); c.height = Math.round(el.naturalHeight * k);
        c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
        resolve({ el: c, w: c.width, h: c.height, dataUrl: c.toDataURL("image/png") });
      } catch { resolve(null); }
    };
    el.onerror = () => resolve(null);
    el.src = src;
  });
}
