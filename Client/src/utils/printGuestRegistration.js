import { printHtml } from "./printElement";

/**
 * The paper form the guest signs at check-in, printed with what's already on
 * file instead of the desk copying it out by hand. Full A4, not the 320px
 * thermal-receipt width the other print utils use (printReceipt.js,
 * printSupplierInvoice.js) — this has ~25 fields plus a liability paragraph
 * and four signature lines, and mirrors the property's own paper form.
 *
 * The payment section (Cash/Master/Visa/Amex, card number, card expiry)
 * prints blank on purpose — the system doesn't track card brand or number,
 * and never will for this form; the desk fills it in by hand exactly like
 * the paper original.
 */
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const dateOnly = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB");
};

const field = (label, value) => `
  <div class="field">
    <div class="field-label">${esc(label)}</div>
    <div class="field-value">${esc(value) || "&nbsp;"}</div>
  </div>`;

export const printGuestRegistration = ({ branchName, booking, guest, stayPolicy }) => {
  const rooms = booking.rooms || [];
  const roomTypeNames = [...new Set(rooms.map((r) => r.type_name))].join(", ");
  const roomNumbers = rooms.map((r) => r.room_number || "TBD at check-in").join(", ");
  const roomRate = rooms.length === 1 ? rooms[0].rate_per_night : rooms.reduce((s, r) => s + Number(r.rate_per_night || 0), 0);
  const checkInTime = stayPolicy?.check_in_pretty || "";
  const checkOutTime = stayPolicy?.check_out_pretty || "";

  const leftFields = [
    field("Name", guest.full_name),
    field("Home Address", guest.address),
    field("Telephone", guest.phone),
    field("Email", guest.email),
    field("Company", guest.company),
    field("Nationality", guest.nationality),
    field("Guest Status", guest.guest_status),
    field("Arrival Time", booking.arrival_time ? String(booking.arrival_time).slice(0, 5) : ""),
    field("Arrival Date", dateOnly(booking.check_in_date)),
    field("Departure Date", dateOnly(booking.check_out_date)),
    field("Next Destination", guest.next_destination),
  ].join("");

  const rightFields = [
    field("Date of Birth", dateOnly(guest.date_of_birth)),
    field("Passport / NIC", guest.passport_nic),
    field("Date of Issue", dateOnly(guest.passport_issue_date)),
    field("Expiry Date", dateOnly(guest.passport_expiry_date)),
    field("Person / Adults", [booking.adults, booking.children ? `+${booking.children} child${booking.children === 1 ? "" : "ren"}` : null].filter(Boolean).join(" ")),
    field("Meal Plan", ""),
    field("Room Type", roomTypeNames),
    field("Room #", roomNumbers),
    field("Room Rate", roomRate ? `LKR ${Number(roomRate).toFixed(2)}` : ""),
    field("Chauffeur's Name", guest.chauffeur_name),
    field("Chauffeur's Number", guest.chauffeur_phone),
  ].join("");

  const page = `
    <html>
      <head>
        <title>Guest Registration — ${esc(booking.booking_ref || "")}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Georgia, 'Times New Roman', serif; width: 190mm; margin: auto; padding: 10mm; color: #111; font-size: 12px; }

          .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
          .hotel-name { font-size: 20px; font-weight: bold; letter-spacing: 0.5px; }
          .form-title { font-size: 13px; font-weight: bold; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
          .form-no { border: 1px solid #111; padding: 4px 10px; font-size: 11px; }

          .grid { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #111; }
          .col { border-right: 1px solid #111; }
          .col:last-child { border-right: none; }
          .field { display: flex; border-bottom: 1px solid #111; min-height: 26px; }
          .col > .field:last-child { border-bottom: none; }
          .field-label { width: 42%; padding: 4px 6px; font-size: 10.5px; color: #333; border-right: 1px solid #ccc; display: flex; align-items: center; }
          .field-value { flex: 1; padding: 4px 6px; display: flex; align-items: center; font-weight: 600; }

          .payment { border: 1px solid #111; border-top: none; padding: 8px; font-size: 11px; }
          .payment-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 6px; }
          .box { display: inline-block; width: 11px; height: 11px; border: 1px solid #111; margin-right: 4px; vertical-align: middle; }
          .blank-line { display: inline-block; border-bottom: 1px solid #111; min-width: 140px; height: 14px; }

          .terms { border: 1px solid #111; border-top: none; padding: 10px; font-size: 10.5px; line-height: 1.6; font-style: italic; }
          .terms .policy { font-style: normal; margin-top: 8px; }
          .terms .remarks { font-style: normal; margin-top: 8px; }

          .signatures { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #111; border-top: none; margin-bottom: 10mm; }
          .sig { padding: 18px 8px 8px; border-right: 1px solid #111; text-align: center; font-size: 10px; border-top: 1px dotted #999; }
          .sig:last-child { border-right: none; }

          @media print { body { width: 100%; } @page { size: A4; margin: 12mm; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <img src="${window.location.origin}/brand-logo.png" alt="" onerror="this.style.display='none'"
                 style="max-width:180px;max-height:60px;object-fit:contain;margin-bottom:6px;display:block;" />
            <div class="hotel-name">${esc(branchName || "")}</div>
            <div class="form-title">Guest Registration</div>
          </div>
          <div class="form-no">No: ${esc(booking.booking_ref || "")}</div>
        </div>

        <div class="grid">
          <div class="col">${leftFields}</div>
          <div class="col">${rightFields}</div>
        </div>

        <div class="payment">
          <div class="payment-row">
            <strong>Method of Payment</strong>
            <span><span class="box"></span>Cash</span>
            <span><span class="box"></span>Master</span>
            <span><span class="box"></span>Visa</span>
            <span><span class="box"></span>Amex</span>
            <span>(<span class="blank-line" style="min-width:100px;"></span>) LKR (Amount)</span>
          </div>
          <div class="payment-row">
            <span>Credit Card Number <span class="blank-line"></span></span>
            <span>Expiry Date <span class="blank-line" style="min-width:80px;"></span></span>
          </div>
        </div>

        <div class="terms">
          <div>
            The guest will be held personally liable for all payments owed by him/her to ${esc(branchName || "the hotel")}, in respect of all
            outstanding dues, costs, liabilities, losses, debts or damages towards the hotel in the event of this being unpaid by the
            agent/company/association or person who has agreed to settle such payments on your behalf.
          </div>
          <div class="policy">
            ${checkInTime ? `Check-in time: ${esc(checkInTime)}<br/>` : ""}
            ${checkOutTime ? `Check-out time: ${esc(checkOutTime)}<br/>` : ""}
            Late check-out is subject to availability and charges may apply.
          </div>
          <div class="remarks">
            Remarks:<br/>
            * Please note no outsiders will be allowed in the room.<br/>
            * Alcohol is not allowed in public areas.
          </div>
        </div>

        <div class="signatures">
          <div class="sig">Guest Signature</div>
          <div class="sig">Checked In By</div>
          <div class="sig">Duty Manager</div>
          <div class="sig">Checked Out By</div>
        </div>
      </body>
    </html>
  `;

  printHtml(page, { title: `Guest Registration ${booking.booking_ref || ""}`.trim() });
};
