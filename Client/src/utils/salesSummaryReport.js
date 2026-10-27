import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { exportCsv, dateCell } from "./exportCsv";

/**
 * The Sales Summary, in the layout of the property's own daily sheet: a
 * heading such as "SALES SUMMARY - 30th OF JUNE 2026", one row a day under
 * DATE, ROOM REVENUE ... LAUNDRY, TOTAL, and a TOTAL row at the foot.
 */

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
  "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`;
};

/** "SALES SUMMARY - 30th OF JUNE 2026" for a month, the dates otherwise. */
export function salesSummaryTitle(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (fy === ty && fm === tm && fd === 1) return `SALES SUMMARY - ${ordinal(td)} OF ${MONTHS[tm - 1]} ${ty}`;
  return `SALES SUMMARY - ${from} TO ${to}`;
}

const fmt = (n) => Number(n || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const heads = (report) => ["DATE", ...report.columns.map((c) => c.label.toUpperCase()), "TOTAL"];
const values = (report, r) => [...report.columns.map((c) => r[c.key]), r.total];

export function downloadSalesSummaryCsv(report, from, to) {
  const rows = [
    [salesSummaryTitle(from, to)],
    heads(report),
    ...report.days.map((d) => [dateCell(d.day), ...values(report, d).map((v) => Number(v || 0).toFixed(2))]),
    ["TOTAL", ...values(report, report.totals).map((v) => Number(v || 0).toFixed(2))],
  ];
  exportCsv(`sales_summary_${from}_to_${to}`, rows[0], rows.slice(1));
}

export function downloadSalesSummaryPdf(report, from, to, propertyName = "") {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const W = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold").setFontSize(14);
  doc.text(salesSummaryTitle(from, to), W / 2, 14, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
  doc.text([propertyName, "Amounts in LKR. Days marked * are from the old sales sheets."].filter(Boolean).join("  ·  "), W / 2, 20, { align: "center" });
  doc.setTextColor(0);
  autoTable(doc, {
    startY: 25, margin: { left: 10, right: 10 },
    head: [heads(report)],
    body: report.days.map((d) => [`${d.day}${d.imported ? " *" : ""}`, ...values(report, d).map(fmt)]),
    foot: [["TOTAL", ...values(report, report.totals).map(fmt)]],
    styles: { fontSize: 8, cellPadding: 1.4, halign: "right" },
    headStyles: { fillColor: [30, 64, 175], halign: "center", fontSize: 7.5 },
    footStyles: { fillColor: [229, 231, 235], textColor: 0, fontStyle: "bold" },
    columnStyles: { 0: { halign: "left" } },
    theme: "grid",
  });
  doc.save(`sales_summary_${from}_to_${to}.pdf`);
}
