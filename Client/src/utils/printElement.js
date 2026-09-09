/**
 * Print one element, and nothing else.
 *
 * `window.print()` prints the whole document. Hiding the rest with CSS doesn't
 * work well here: `visibility:hidden` keeps the hidden layout, so a receipt
 * inside a modal came out after a blank page, and `position:absolute` fixes the
 * blank page but then clips anything longer than one sheet.
 *
 * Copying the node into its own window sidesteps both. It also matches how the
 * cashier bill already prints (see printReceipt.js).
 */
export function printElement(node, { title = document.title, widthMm = 210 } = {}) {
  if (!node) return;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("Your browser blocked the print window. Allow pop-ups for this site and try again.");
    return;
  }

  // Carry the app's stylesheets across so Tailwind classes still resolve.
  // Inline styles ride along inside outerHTML on their own.
  const head = [...document.querySelectorAll('link[rel="stylesheet"], style')]
    .map((el) => el.outerHTML)
    .join("\n");

  win.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <!-- This window is about:blank, which has no base URL of its own, so every
         relative src in the copied markup (the property logo, above all) would
         resolve to nothing. Point them back at the app. -->
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
      /* Anything scrollable on screen must expand on paper. */
      .printed * {
        max-height: none !important;
        overflow: visible !important;
        box-shadow: none !important;
      }
      .no-print, .no-print * { display: none !important; }
      .print-only { display: block !important; }

      /* index.css hides everything outside .print-area when printing. That is
         right in the app, and fatal here: this window has no .print-area, so the
         copied node inherits visibility:hidden and prints a blank sheet — laid
         out perfectly, and entirely invisible. This document contains nothing
         but the thing being printed, so put the visibility back. */
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
</html>`);

  win.document.close();

  const go = () => {
    win.focus();
    win.print();
  };
  win.onafterprint = () => win.close();

  // Stylesheets load asynchronously; printing too early yields an unstyled sheet.
  if (win.document.readyState === "complete") setTimeout(go, 150);
  else win.onload = () => setTimeout(go, 150);
}
