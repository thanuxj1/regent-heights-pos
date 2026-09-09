/**
 * Property branding for guest-facing documents.
 *
 * Two different marks, deliberately kept apart:
 *
 *   logo.png       — the Hotel POS product logo. Staff-facing chrome only
 *                    (sidebars, headers). Imported from src/assets.
 *   DOCUMENT_LOGO  — the property's own logo, e.g. Regent Heights Luxury
 *                    Suites. Goes on anything a guest or the owner sees:
 *                    confirmations, folios, receipts, reports.
 *
 * The document logo lives in public/ rather than src/assets on purpose. A
 * missing file in src/assets is a build error; from public/ it's just an image
 * that doesn't load, so the property can swap its own artwork in without
 * touching the code or risking a broken build.
 *
 * To change it: drop the new file at Client/public/brand-logo.png
 */
export const DOCUMENT_LOGO = "/brand-logo.png";

/** Hide the slot cleanly when no logo file has been supplied yet. */
export const hideIfMissing = (e) => {
  e.currentTarget.style.display = "none";
};
