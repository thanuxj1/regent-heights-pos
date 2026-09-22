import { printHtml } from "./printElement";

/**
 * The proof a supplier payment happened — the same document by two names,
 * because it does both jobs. Paid in full, it is a receipt: what was bought,
 * what was paid, done. Paid in part, the same sheet is a statement: what is
 * still owed carries forward, so a supplier arguing about the balance can be
 * shown paper, not asked to trust the screen.
 *
 * Printed through a hidden frame, like every other receipt here — see
 * printElement.js for why a pop-up window doesn't work for this.
 */
export const printSupplierInvoice = (invoice) => {
  const money = (v) => `LKR ${Number(v || 0).toFixed(2)}`;
  const orderTotal = Number(invoice.orderTotal || 0);
  const paidThisTime = Number(invoice.paidThisTime || 0);
  const paidToDate = Number(invoice.paidToDate || 0);
  const balance = Math.max(0, +(orderTotal - paidToDate).toFixed(2));
  const isFullyPaid = balance <= 0.005;

  const page = `
    <html>
      <head>
        <title>${isFullyPaid ? "Payment receipt" : "Payment statement"} — PO #${invoice.poId ?? ""}</title>

        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: 'Courier New', monospace;
            width: 320px;
            margin: auto;
            padding: 15px;
            color: #000;
          }

          .header { text-align: center; margin-bottom: 15px; }
          .hotel-name { font-size: 22px; font-weight: bold; }
          .subtitle { font-size: 12px; color: #555; }
          .divider { border-top: 1px dashed #000; margin: 12px 0; }

          .row {
            display: flex;
            justify-content: space-between;
            margin: 6px 0;
            font-size: 14px;
          }
          .label { color: #444; }
          .value { font-weight: 600; }

          .items { margin-top: 10px; }
          .item-row {
            display: flex;
            justify-content: space-between;
            font-size: 13px;
            margin: 4px 0;
          }
          .item-name { flex: 1; padding-right: 8px; }

          .summary { margin-top: 10px; }
          .grand-total {
            font-size: 16px;
            font-weight: bold;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 2px solid #000;
          }

          .payment {
            margin-top: 15px;
            text-align: center;
            border: 1px solid #000;
            padding: 10px;
            font-weight: bold;
            font-size: 15px;
          }
          .balance {
            margin-top: 10px;
            text-align: center;
            border: 1px dashed #000;
            padding: 8px;
            font-weight: bold;
            font-size: 13px;
          }

          .footer { text-align: center; margin-top: 20px; font-size: 12px; }

          @media print { body { width: 100%; } }
        </style>
      </head>

      <body>
        <div class="header">
          <!-- Property logo; hides itself if the file hasn't been supplied. -->
          <img src="${window.location.origin}/brand-logo.png" alt=""
               onerror="this.style.display='none'"
               style="max-width:200px;max-height:70px;object-fit:contain;margin-bottom:8px;" />
          <div class="hotel-name">${invoice.branchName || "Supplier Payment"}</div>
          <div class="subtitle">${isFullyPaid ? "Payment Receipt" : "Payment Statement — balance still owed"}</div>
        </div>

        <div class="divider"></div>

        <div class="row">
          <span class="label">Purchase Order</span>
          <span class="value">#${invoice.poId ?? ""}</span>
        </div>
        <div class="row">
          <span class="label">Supplier</span>
          <span class="value">${invoice.supplierName || ""}</span>
        </div>
        ${invoice.supplierContact ? `
        <div class="row">
          <span class="label">Contact</span>
          <span class="value">${invoice.supplierContact}</span>
        </div>` : ""}
        <div class="row">
          <span class="label">Date</span>
          <span class="value">${new Date().toLocaleString()}</span>
        </div>
        ${invoice.recordedBy ? `
        <div class="row">
          <span class="label">Recorded by</span>
          <span class="value">${invoice.recordedBy}</span>
        </div>` : ""}

        ${(invoice.items && invoice.items.length) ? `
        <div class="divider"></div>
        <div class="items">
          ${invoice.items.map((item) => `
            <div class="item-row">
              <span class="item-name">${item.name} x ${item.qty}${item.unit ? " " + item.unit : ""}</span>
              <span>${money(item.lineTotal)}</span>
            </div>
          `).join("")}
        </div>` : ""}

        <div class="divider"></div>

        <div class="summary">
          <div class="row">
            <span>Order total</span>
            <span>${money(orderTotal)}</span>
          </div>
          <div class="row grand-total">
            <span>Paid this time</span>
            <span>${money(paidThisTime)}</span>
          </div>
        </div>

        <div class="payment">
          ${(invoice.method || "").replace(/_/g, " ").toUpperCase()}
        </div>

        ${isFullyPaid
          ? `<div class="footer"><p>Paid in full — nothing further owed.</p></div>`
          : `<div class="balance">Paid to date ${money(paidToDate)} of ${money(orderTotal)}<br/>Balance still owed: ${money(balance)}</div>`
        }
      </body>
    </html>
  `;

  printHtml(page, { title: `PO ${invoice.poId ?? ""} payment`.trim() });
};
