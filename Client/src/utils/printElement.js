/**
 * Print one element, and nothing else.
 *
 * `window.print()` prints the whole document. Hiding the rest with CSS doesn't
 * work well here: `visibility:hidden` keeps the hidden layout, so a receipt
 * inside a modal came out after a blank page, and `position:absolute` fixes the
 * blank page but then clips anything longer than one sheet.
 *
 * The copy goes into a hidden frame of its own. It used to open a window, which
 * is fine when a person clicks Print and useless when the kitchen screen prints
 * a ticket by itself: a pop-up with no click behind it is blocked, so the ticket
 * never printed at all. A frame needs no gesture, leaves no stray about:blank
 * window behind, and prints exactly what is inside it.
 */
export function printElement(node, { title = document.title, widthMm = 210, onDone } = {}) {
  if (!node) return;

  // Carry the app's stylesheets across so Tailwind classes still resolve.
  // Inline styles ride along inside outerHTML on their own.
  const head = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map((el) => el.outerHTML)
    .join("\n");

  const page = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <!-- Relative sources in the copied markup (the property logo, above all)
         have to resolve against the app, not against this frame. -->
    <base href="${document.baseURI}" />
    ${head}
    <style>
      /* The copied node keeps its on-screen sizing; strip the modal framing. */
      html, body {
        margin: 0;
        padding: 0;
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body > .printed {
        width: 100%;
        max-width: ${widthMm}mm;
        max-height: none !important;
        margin: 0 auto;
        overflow: visible !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
      }
      /* Whatever was copied must not bring its on-screen position with it. A
         ticket parked off-screen to keep it from flashing printed a perfectly
         laid-out blank sheet, 9999 pixels to the left of the paper. */
      body > .printed > * {
        position: static !important;
        left: auto !important;
        right: auto !important;
        top: auto !important;
        bottom: auto !important;
        transform: none !important;
      }
      /* Anything scrollable on screen must expand on paper. */
      .printed * {
        max-height: none !important;
        overflow: visible !important;
        box-shadow: none !important;
      }
      .no-print, .no-print * { display: none !important; }
      .print-only { display: block !important; }

      /* index.css hides everything outside .print-area when printing. That is
         right in the app, and fatal here: this document has no .print-area, so
         the copied node would inherit visibility:hidden and print a blank sheet
         — laid out perfectly, and entirely invisible. This document contains
         nothing but the thing being printed, so put the visibility back. */
      @media print {
        body, body * { visibility: visible !important; }
        .no-print, .no-print * { display: none !important; }
      }

      table { page-break-inside: auto; border-collapse: collapse; }
      tr    { page-break-inside: avoid; }
      thead { display: table-header-group; }

      @page { margin: 14mm; }
    </style>
  </head>
  <body><div class="printed">${node.outerHTML}</div></body>
</html>`;

  printHtml(page, { title, onDone });
}

/**
 * Print a document that has already been written out — the cashier's receipt
 * builds its own rather than copying anything off the screen.
 *
 * The frame is what makes an unattended print possible. `window.open` needs a
 * click behind it, and a receipt printed once the payment has gone through has
 * none: the click is spent by the time the server answers, the browser treats
 * the window as an unwanted pop-up, and nothing comes out of the printer.
 */
export function printHtml(page, { title = document.title, onDone } = {}) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.title = title;
  // Off the side of the screen rather than display:none — a frame with no box
  // of its own lays its contents out at zero width, and prints like it too.
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;";

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.setTimeout(() => frame.remove(), 1000);
    if (typeof onDone === "function") onDone();
  };

  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      finish();
      return;
    }
    win.onafterprint = finish;
    // Stylesheets load asynchronously; printing too early yields an unstyled sheet.
    window.setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        // A print that cannot start must not take the screen down with it.
      }
      // onafterprint does not fire in every browser; tidy up regardless, long
      // after any dialog has been dealt with.
      window.setTimeout(finish, 60000);
    }, 250);
  };

  document.body.appendChild(frame);
  frame.srcdoc = page;
}
