import React from "react";

/**
 * The product mark shown in staff-facing chrome.
 *
 * There were three copies of this before: the sidebar loaded
 * `/navbar_logo.jpg`, while the cashier and register headers each imported a
 * separate 455 KB `assets/images/logo.png` — a different file, bundled into the
 * app, that every cashier downloaded before the till would open. One component,
 * one file, served from `public/` so it is cached by the browser and never
 * bundled.
 *
 * Not to be confused with the hotel's own logo (`brand.js` → `DOCUMENT_LOGO`),
 * which belongs on things a guest sees: receipts, invoices, folios.
 */
export const NAVBAR_LOGO = "/navbar_logo.jpg";

export default function BrandLogo({
  size = 44,
  radius = 8,
  padding = 4,
  background = "#fff",
  alt = "Develop Your Aspect",
  style = {},
}) {
  return (
    <img
      src={NAVBAR_LOGO}
      alt={alt}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        background,
        padding,
        borderRadius: radius,
        boxSizing: "border-box",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
