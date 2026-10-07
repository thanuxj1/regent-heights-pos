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
 * @param {object}   meta               { branchName, staffName, reprint, test }
 */
export function kotHtml(order, items, meta = {}) {
  const { branchName = "", staffName = "", reprint = false, test = false } = meta;

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
      /* Fills whatever the paper gives it. It was a fixed 300px — about 79mm —
         which a roll of 80mm paper, with its margin, cannot hold: the right
         edge of every ticket ran off the paper. */
      .kot { font-family: "Courier New", monospace; width: 100%; color: #000; }
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
      ${test ? '<div class="flag">* * T E S T   T I C K E T * *</div>' : reprint ? '<div class="flag">* * R E P R I N T * *</div>' : ""}
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
  // 80mm paper, of which a thermal head prints about 72: a 6mm margin each side
  // leaves a 68mm ticket that sits inside that band.
  printElement(node, { title: `KOT-${order?.or_id ?? ""}`, widthMm: 80, paddingMm: 6 });
}

/**
 * Where tickets come out.
 *
 * A web page cannot choose a physical printer — the browser decides, and it
 * prints on whatever the print window (or, with `--kiosk-printing`, this PC's
 * default printer) points at. What the app *can* choose is **which screen**
 * prints, and that is the choice that matters here: the printer upstairs is
 * plugged into the PC upstairs, so the kitchen screen running on that PC puts
 * every incoming order on that printer, while the till downstairs prints on
 * its own.
 *
 * Both default to printing, so nothing changes until someone switches a copy
 * off — and switching one off is a decision made at that device, per device,
 * the same way the kitchen screen's own Auto-print switch already is.
 */
const TILL_PRINT_KEY = "till.printKot";

/** Does this till print its own copy when it sends an order to the kitchen? */
export function tillPrintsKot() {
  try {
    return localStorage.getItem(TILL_PRINT_KEY) !== "off";
  } catch {
    return true; // can't remember a choice → keep printing; a spare ticket beats a lost one
  }
}

export function setTillPrintsKot(on) {
  try {
    localStorage.setItem(TILL_PRINT_KEY, on ? "on" : "off");
  } catch {
    // The choice just lasts until the page reloads.
  }
}

/** The till's own copy — skipped when this till has been set to leave it to the kitchen. */
export function printKotAtTill(order, items, meta = {}) {
  if (!tillPrintsKot()) return false;
  printKot(order, items, meta);
  return true;
}

/**
 * A ticket that says what it is, so someone can send one to a printer and see
 * whether it comes out where they expect — before trusting real orders to it.
 */
export function printTestKot({ where = "", ...meta } = {}) {
  printKot(
    { or_id: "TEST", or_type: "test" },
    [
      { qty: 1, name: "Test item", note: "If you can read this, this printer works" },
      { qty: 2, name: "Second line", note: "" },
    ],
    {
      ...meta,
      // Printed under the heading, so the paper itself says which screen sent it.
      branchName: [meta.branchName, where].filter(Boolean).join(" · "),
      test: true,
    },
  );
}
