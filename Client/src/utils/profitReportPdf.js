import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * The Profit & Loss Statement, laid out so someone who has never seen the system
 * can follow it: every line says what it is, every total says how it was made,
 * and the notes at the end say what is and is not in the figures.
 *
 * Basis: money is counted on the day it moved (cash basis), not the day it was
 * promised — stated on the page, because an auditor's first question is which.
 */

const CAT_LABEL = {
  utilities: "Utilities (electricity, water, gas, internet)",
  salary: "Salaries and wages",
  maintenance: "Repairs and maintenance",
  marketing: "Marketing and advertising",
  other: "Other expenses",
  raw_materials: "Raw materials",
  food_packets: "Food packets",
  delivery: "Delivery costs",
  commission: "Commission",
};

const fmt = (n) => {
  const v = Number(n || 0);
  const s = Math.abs(v).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s; // brackets for a negative, as accounts do
};

export function downloadProfitReportPdf({ data, payables, from, to, propertyName = "", preparedBy = "" }) {
  const d = data.by_department;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  let y = 16;

  // ── Heading ──────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold").setFontSize(17);
  doc.text("Profit and Loss Statement", M, y);
  y += 7;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(60);
  if (propertyName) { doc.text(propertyName, M, y); y += 5; }
  doc.text(`Period: ${from} to ${to}  (${data.range.days} day${data.range.days === 1 ? "" : "s"})`, M, y); y += 5;
  doc.text(`All amounts in Sri Lankan Rupees (LKR). Amounts in (brackets) are negative.`, M, y); y += 5;
  doc.text(`Prepared ${new Date().toLocaleString()}${preparedBy ? ` by ${preparedBy}` : ""}.`, M, y); y += 5;
  doc.setTextColor(0);
  y += 2;

  // ── Basis ────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y, theme: "plain", margin: { left: M, right: M },
    styles: { fontSize: 8.5, cellPadding: 2, textColor: 60, fillColor: [243, 244, 246] },
    body: [[
      "Basis of preparation: money is counted on the day it was received or paid (cash basis). " +
      "A supplier bill that has been received but not yet paid is not a cost until it is paid; it is listed at the end " +
      "under \"Amounts owed\". The definitions of every line are in the notes on the last page.",
    ]],
  });
  y = doc.lastAutoTable.finalY + 4;

  // Reusable row builders
  const section = (t) => [{ content: t, colSpan: 3, styles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold", fontSize: 10 } }];
  const sub = (t) => [{ content: t, colSpan: 3, styles: { fillColor: [229, 231, 235], fontStyle: "bold" } }];
  const line = (label, amount, note = "") => [label, fmt(amount), note];
  const total = (label, amount, note = "") => [
    { content: label, styles: { fontStyle: "bold" } },
    { content: fmt(amount), styles: { fontStyle: "bold", halign: "right" } },
    { content: note, styles: { fontStyle: "italic" } },
  ];
  const key = (label, amount, note = "") => [
    { content: label, styles: { fontStyle: "bold", fillColor: [219, 234, 254] } },
    { content: fmt(amount), styles: { fontStyle: "bold", halign: "right", fillColor: [219, 234, 254] } },
    { content: note, styles: { fontStyle: "italic", fillColor: [219, 234, 254] } },
  ];

  const totalCosts = data.expenses.total + data.expenses.commissions;
  const none = (rows, t) => (rows.length ? rows : [[{ content: t, colSpan: 3, styles: { fontStyle: "italic", textColor: 120 } }]]);

  const body = [
    section("1. SUMMARY"),
    line("Total revenue", data.revenue.total, "Hotel revenue plus restaurant revenue (sections 2 and 3)."),
    line("Total costs", totalCosts, "Every cost paid in the period (sections 2, 3 and 4)."),
    key("NET PROFIT", data.profit.net, `Revenue minus costs. ${data.profit.margin_pct}% of revenue.`),

    section("2. HOTEL"),
    line("Revenue", d.hotel.revenue, "Room charges, meals and room service posted to guests' bills."),
    sub("Costs that belong to the hotel"),
    line("  Agent commissions", d.hotel.costs.commissions, "Paid or owed to travel agents for bookings they brought."),
    line("  Hotel supplies bought", d.hotel.costs.supplies_bought, "Cleaning products and other items the hotel uses itself, as paid to suppliers."),
    line("  Hotel supplies wasted", d.hotel.costs.supplies_wasted, "Hotel supplies thrown away or lost, valued at their cost."),
    total("Total hotel costs", d.hotel.cost_total),
    key("HOTEL PROFIT", d.hotel.profit, "Hotel revenue minus hotel costs, before property-wide costs (section 4)."),

    section("3. RESTAURANT"),
    line("Revenue", d.restaurant.revenue,
      `${d.restaurant.orders} walk-in orders, including tax, service charge and delivery charges. Orders charged to a room are in the hotel figure.`),
    line("  of which delivery charges", d.restaurant.delivery_charges ?? 0, "Already inside the revenue above, shown so it can be seen."),
    sub("Costs that belong to the restaurant"),
    line("  Food and drink bought", d.restaurant.costs.food_and_drink_bought, "Ingredients and goods for resale, as paid to suppliers."),
    line("  Food wasted", d.restaurant.costs.food_wasted, "Ingredients thrown away or lost, valued at their cost."),
    line("  Raw materials, packaging and delivery costs", d.restaurant.costs.raw_materials_packaging_delivery, "Expenses recorded under those headings."),
    total("Total restaurant costs", d.restaurant.cost_total),
    key("RESTAURANT PROFIT", d.restaurant.profit, "Restaurant revenue minus restaurant costs, before property-wide costs (section 4)."),
    line("For information: dish profit", data.product_profit?.profit ?? 0,
      `What the dishes sold for minus what they cost to make (${data.product_profit?.margin_pct ?? 0}% margin). A separate measure; not added into the totals.`),

    section("4. COSTS FOR THE WHOLE PROPERTY"),
    ...none(
      d.shared.by_category.map((c) => line(`  ${CAT_LABEL[c.exp_category] || c.exp_category}`, c.total)),
      "No property-wide costs were recorded in this period.",
    ),
    total("Total property-wide costs", d.shared.total,
      "Costs that serve both the hotel and the restaurant, so they are shown once and not divided between them."),

    section("5. HOW THE NET PROFIT IS REACHED"),
    line("Hotel profit (section 2)", d.hotel.profit),
    line("Restaurant profit (section 3)", d.restaurant.profit),
    line("Less: property-wide costs (section 4)", -d.shared.total),
    key("NET PROFIT", data.profit.net, `Agrees to section 1. ${data.profit.margin_pct}% of revenue.`),
  ];

  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: "grid",
    head: [["Description", "Amount (LKR)", "What this is"]],
    headStyles: { fillColor: [55, 65, 81], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 2, valign: "middle", lineColor: [209, 213, 219], lineWidth: 0.1 },
    columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 30, halign: "right" }, 2: { cellWidth: W - 2 * M - 92 } },
    body,
    didParseCell: (h) => { if (h.section === "body" && h.column.index === 1 && typeof h.cell.raw === "string") h.cell.styles.halign = "right"; },
  });
  y = doc.lastAutoTable.finalY + 6;

  // ── Amounts owed, outside the figures above ─────────────────────────
  if (y > 240) { doc.addPage(); y = 16; }
  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: "grid",
    head: [["6. AMOUNTS STILL OWED (for information)", "Amount (LKR)", "What this is"]],
    headStyles: { fillColor: [146, 64, 14], textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 2, lineColor: [209, 213, 219], lineWidth: 0.1 },
    columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 30, halign: "right" }, 2: { cellWidth: W - 2 * M - 92 } },
    body: [
      line("Owed to suppliers", payables?.totals?.suppliers ?? 0, "Goods received but not yet paid for."),
      line("Owed to agents", payables?.totals?.commissions ?? 0, "Commission earned by agents and not yet paid out. Already counted as a cost above, because commission counts when earned."),
      line("Cash held by delivery partners", data.receivables?.cod_outstanding ?? 0,
        "Cash-on-delivery money a rider has collected and not yet handed over. Counted as revenue only once handed over."),
    ],
  });
  y = doc.lastAutoTable.finalY + 6;

  // ── Notes ────────────────────────────────────────────────────────────
  if (y > 200) { doc.addPage(); y = 16; }
  doc.setFont("helvetica", "bold").setFontSize(11).text("Notes and definitions", M, y); y += 2;
  const notes = [
    ["Revenue", "What customers and guests paid. Restaurant sales include tax, service charge and delivery charge. A cash-on-delivery order counts only when the rider hands the money over, on that day. Hotel revenue is what was posted to guests' bills."],
    ["Costs counted when paid", "A cost appears in the period it was paid, not when the goods were ordered or received. Supplier bills still unpaid at the end are in section 6. The one exception is agent commission, which counts when it is earned."],
    ["Hotel and restaurant costs", "A cost is assigned to one side only where the records say whose it is: hotel supplies, agent commission and commission expenses to the hotel; ingredients, goods for resale, food waste and raw-material, packaging and delivery expenses to the restaurant. Where a supplier order mixes both kinds, its payment is divided in proportion to what each part cost."],
    ["Property-wide costs", "Utilities, salaries, maintenance, marketing and other expenses. The records do not say which side they serve, so they are not divided. Hotel profit and restaurant profit are therefore stated before these costs."],
    ["Waste", "Items recorded as thrown away or lost, valued at the item's latest purchase price."],
    ["Dish profit", "For each dish: what it sold for minus the cost recorded when it was sold. It measures the food only, before tax, service charge and delivery charge, so it differs from restaurant profit, which counts every cost paid."],
    ["Not included", "Depreciation, loan interest, income tax and any adjustment made outside this system."],
  ];
  autoTable(doc, {
    startY: y + 2, margin: { left: M, right: M }, theme: "plain",
    styles: { fontSize: 8.5, cellPadding: 1.8, valign: "top" },
    columnStyles: { 0: { cellWidth: 42, fontStyle: "bold" } },
    body: notes,
  });

  // Page numbers
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
    doc.text(`Profit and Loss Statement  ${from} to ${to}   Page ${i} of ${pages}`, M, doc.internal.pageSize.getHeight() - 8);
  }

  doc.save(`profit_and_loss_${from}_to_${to}.pdf`);
}
