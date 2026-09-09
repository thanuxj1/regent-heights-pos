import { printElement } from "./printElement";

/**
 * Kitchen Order Ticket.
 *
 * Shared by the till and the kitchen screen so both print the same slip — if
 * they diverge, the paper on the pass stops matching the paper at the counter
 * and nobody can tell which is right.
 *
 * Deliberately carries **no money**: prices, tax and totals are the cashier's
 * business. A cook acts on the item, the quantity and the note, so those are
 * the only things given room.
 *
 * @param {object}   order              { or_id, or_type, or_time, table }
 * @param {Array}    items              [{ name, qty, note }]
 * @param {object}   meta               { branchName, staffName, reprint }
 */
export function printKot(order, items, meta = {}) {
  const { branchName = "", staffName = "", reprint = false } = meta;

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"]/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
    ));

  const when = order?.or_time
    ? String(order.or_time).slice(0, 5)
    : new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = new Date().toLocaleDateString("en-GB");

  const rows = (items || [])
    .map(
      (i) => `
        <tr>
          <td class="qty">${esc(i.qty)}&times;</td>
          <td class="name">
            ${esc(i.name)}
            ${i.note ? `<div class="note">&#8627; ${esc(i.note)}</div>` : ""}
          </td>
        </tr>`,
    )
    .join("");

  const node = document.createElement("div");
  node.innerHTML = `
    <style>
      .kot { font-family: "Courier New", monospace; width: 300px; color: #000; }
      .kot h1 { font-size: 20px; margin: 0; letter-spacing: 2px; }
      .kot .sub { font-size: 12px; margin-top: 2px; }
      .kot .head { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; }
      .kot .meta { font-size: 13px; margin: 8px 0; line-height: 1.6; }
      .kot .meta b { display: inline-block; min-width: 62px; }
      .kot table { width: 100%; border-collapse: collapse; border-top: 2px dashed #000; }
      .kot td { padding: 7px 0; vertical-align: top; border-bottom: 1px dotted #999; }
      .kot .qty { font-size: 18px; font-weight: 700; width: 46px; }
      .kot .name { font-size: 15px; font-weight: 700; text-transform: uppercase; }
      .kot .note { font-size: 12px; font-weight: 400; font-style: italic; text-transform: none; margin-top: 2px; }
      .kot .foot { text-align: center; font-size: 11px; margin-top: 10px; border-top: 2px dashed #000; padding-top: 6px; }
      .kot .flag { text-align: center; font-size: 13px; font-weight: 700; border: 2px solid #000; padding: 3px; margin-bottom: 8px; }
    </style>
    <div class="kot">
      ${reprint ? '<div class="flag">* * R E P R I N T * *</div>' : ""}
      <div class="head">
        <h1>KITCHEN ORDER</h1>
        <div class="sub">${esc(branchName)}</div>
      </div>
      <div class="meta">
        <div><b>Order</b> #${esc(order?.or_id ?? "-")}</div>
        <div><b>Type</b> ${esc(order?.or_type || "dine-in")}</div>
        ${order?.table ? `<div><b>Table</b> ${esc(order.table)}</div>` : ""}
        <div><b>Time</b> ${esc(when)} &nbsp; ${esc(day)}</div>
        ${staffName ? `<div><b>By</b> ${esc(staffName)}</div>` : ""}
      </div>
      <table>${rows}</table>
      <div class="foot">${(items || []).reduce((n, i) => n + Number(i.qty || 0), 0)} item(s) &mdash; prepare and mark ready</div>
    </div>`;

  // printElement copies the node into its own window, so it has to be in the
  // document first; it comes straight back out.
  node.style.position = "fixed";
  node.style.left = "-9999px";
  document.body.appendChild(node);
  try {
    printElement(node, { title: `KOT-${order?.or_id ?? ""}`, widthMm: 80 });
  } finally {
    document.body.removeChild(node);
  }
}
