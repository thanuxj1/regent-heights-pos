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
 * @param {object}   order              { or_id, or_type, or_time, table, allergies, addons, notes }
 * @param {Array}    items              [{ name, qty, note }]
 * @param {object}   meta               { branchName, staffName, reprint }
 */
export function kotHtml(order, items, meta = {}) {
  const { branchName = "", staffName = "", reprint = false } = meta;

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"]/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
    ));

  const when = order?.or_time
    ? String(order.or_time).slice(0, 5)
    : new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = new Date().toLocaleDateString("en-GB");

  // What applies to the whole order, not to one dish. An allergy is boxed and comes
  // first: it is the line a cook must not miss.
  const orderNotes = [
    order?.allergies && String(order.allergies).trim()
      ? `<div class="allergy">&#9888; ALLERGY: ${esc(String(order.allergies).trim())}</div>` : "",
    order?.addons && String(order.addons).trim()
      ? `<div class="onote"><b>Add-ons:</b> ${esc(String(order.addons).trim())}</div>` : "",
    order?.notes && String(order.notes).trim()
      ? `<div class="onote"><b>Note:</b> ${esc(String(order.notes).trim())}</div>` : "",
  ].join("");

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

  return `
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
      .kot .allergy { font-size: 14px; font-weight: 700; border: 2px solid #000; padding: 5px; margin: 8px 0 4px; text-transform: uppercase; }
      .kot .onote { font-size: 13px; margin: 4px 0; }
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
      ${orderNotes}
      <table>${rows}</table>
      <div class="foot">${(items || []).reduce((n, i) => n + Number(i.qty || 0), 0)} item(s) &mdash; prepare and mark ready</div>
    </div>`;
}

/**
 * Print one ticket.
 *
 * The node never joins the page. It used to be parked off-screen first with
 * `position: fixed; left: -9999px` so nobody saw it flash — and those inline
 * styles travelled with the copy into the print window, which laid the ticket
 * out perfectly 9999 pixels to the left of the paper. Every KOT came out blank
 * with the right title on it. Serialising a detached node works just as well.
 */
export function printKot(order, items, meta = {}) {
  const node = document.createElement("div");
  node.className = "kot-ticket";
  node.innerHTML = kotHtml(order, items, meta);
  printElement(node, { title: `KOT-${order?.or_id ?? ""}`, widthMm: 80 });
}
