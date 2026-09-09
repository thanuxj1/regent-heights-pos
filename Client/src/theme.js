/**
 * The system's design tokens — one source of truth.
 *
 * Colours were sampled from what the app already uses, so nothing changes
 * visually; they just stop being retyped as hex literals in forty files.
 * Import from here instead of hardcoding.
 */

export const colors = {
  // Brand — the blue the sidebar and primary buttons have always used
  primary:        "#1565C0",
  primaryDark:    "#0D47A1",
  primaryLight:   "#00B5E2",
  primaryHover:   "#0d4d99",
  primarySoft:    "#EFF6FF",

  // Surfaces
  bg:             "#F4F7FB",
  surface:        "#FFFFFF",
  surfaceMuted:   "#F8FAFC",
  border:         "#E2E8F0",
  borderSoft:     "#F1F5F9",

  // Type
  text:           "#1E293B",
  textMuted:      "#64748B",
  textFaint:      "#94A3B8",
  textOnDark:     "#FFFFFF",

  // Status — each has a solid, a deep text tone and a soft background
  success:        "#059669",
  successText:    "#065F46",
  successSoft:    "#D1FAE5",

  danger:         "#DC2626",
  dangerText:     "#B91C1C",
  dangerSoft:     "#FEE2E2",

  warning:        "#F59E0B",
  warningText:    "#92400E",
  warningSoft:    "#FEF9C3",

  info:           "#3B82F6",
  infoText:       "#1E40AF",
  infoSoft:       "#DBEAFE",

  accent:         "#7C3AED",
  accentText:     "#6B21A8",
  accentSoft:     "#F3E8FF",
};

/** The sidebar's own scale, so it can be themed independently of the page. */
export const sidebar = {
  width:          240,
  widthCollapsed: 68,
  bg:             colors.primary,
  bgDeep:         colors.primaryDark,
  itemHover:      "rgba(255,255,255,0.12)",
  itemActive:     "rgba(255,255,255,0.22)",
  groupActive:    "rgba(255,255,255,0.08)",
  text:           "#E8ECFF",
  textActive:     "#FFFFFF",
  divider:        "rgba(255,255,255,0.14)",
};

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 };

export const shadow = {
  sm: "0 1px 2px rgba(15,23,42,0.05)",
  md: "0 4px 12px rgba(15,23,42,0.08)",
  lg: "0 20px 60px rgba(15,23,42,0.16)",
};

export const font = {
  xs: 11, sm: 12, base: 13, md: 14, lg: 16, xl: 20, xxl: 26,
};

/** Header gradient used across every page header. */
export const headerGradient =
  `linear-gradient(135deg, ${colors.primaryDark} 0%, ${colors.primary} 60%, ${colors.primaryLight} 100%)`;

export default { colors, sidebar, radius, shadow, font, headerGradient };
