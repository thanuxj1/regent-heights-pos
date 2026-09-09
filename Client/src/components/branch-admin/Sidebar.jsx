import React, { useEffect, useState } from "react";
import BrandLogo from "../BrandLogo";
import { Link, useLocation } from "react-router-dom";
import {
  FaTachometerAlt, FaChevronDown, FaChartLine, FaSignOutAlt,
  FaConciergeBell, FaBed, FaAngleDoubleLeft, FaAngleDoubleRight,
  FaCashRegister,
} from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";
import { colors, sidebar as S, radius, font } from "../../theme";

/**
 * Sidebar — header / scrollable content / collapsible groups / footer / rail,
 * with an icon-only collapsed state.
 *
 * Built on the app's own stack rather than pulling in shadcn, which would mean
 * Radix + CVA + tailwind-merge and converting every inline-styled page. Same
 * structure, none of the migration.
 */

const STORAGE_KEY = "sidebar:collapsed";

const ADMIN_NAV = [
  {
    id: "hotel",
    label: "Hotel",
    icon: FaBed,
    items: [
      ["Room Rack",            "/hotel/rack"],
      ["Calendar",             "/hotel/calendar"],
      ["Front Desk",           "/hotel/front-desk"],
      ["Bookings",             "/hotel/bookings"],
      ["Guests",               "/hotel/guests"],
      ["Rooms & Housekeeping", "/hotel/rooms"],
      ["Room Types & Rates",   "/hotel/room-types"],
    ],
  },
  {
    id: "restaurant",
    label: "Restaurant",
    icon: FaConciergeBell,
    items: [
      ["Menu / Products",    "/branch-admin/products"],
      ["Menu Categories",    "/branch-admin/categories"],
      ["Kitchen Orders",     "/branch-admin/kitchen-orders"],
      ["Inventory",          "/branch-admin/inventory"],
      ["Add Inventory Item", "/branch-admin/raw-ingredient"],
      ["Suppliers",          "/branch-admin/suppliers"],
      ["Recipe Mapper",      "/branch-admin/recipe-mapper"],
    ],
  },
  {
    id: "business",
    label: "Business",
    icon: FaChartLine,
    items: [
      ["Reports",             "/hotel/reports"],
      ["Accounting",          "/branch-admin/accounting"],
      ["Commission Agents",   "/branch-admin/commission-agents"],
      ["Transactions",        "/branch-admin/transactions"],
      ["Sales & Revenue",     "/branch-admin/sales-revenue"],
      ["Cashier Performance", "/branch-admin/cashier-performance"],
      ["Promotions",          "/admin/promotions"],
      ["User Management",     "/branch-admin/users"],
      ["Activity Log",        "/branch-admin/activity"],
      ["Hotel Profile",       "/branch-admin/hotel-profile"],
    ],
  },
];

const CASHIER_NAV = [
  {
    id: "frontdesk",
    label: "Front Desk",
    icon: FaBed,
    items: [
      ["Room Rack",    "/hotel/rack"],
      ["Calendar",     "/hotel/calendar"],
      ["Arrivals",     "/hotel/front-desk"],
      ["Bookings",     "/hotel/bookings"],
      ["Guests",       "/hotel/guests"],
      ["Housekeeping", "/hotel/rooms"],
    ],
  },
];

// The page each role lands on, pinned above the groups.
const HOME = {
  cashier: ["Point of Sale", "/cashier/pos", FaCashRegister],
  admin:   ["Dashboard", "/branch-admin/dashboard", FaTachometerAlt],
};

const ROLE_LABEL = {
  1: "Administrator", 2: "Administrator", 3: "Cashier",
  6: "Super Admin", 8: "Waiter", 9: "Kitchen Staff",
};

const initials = (n) =>
  (n || "?").split(" ").filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);

/** Tooltip shown beside an icon while the rail is collapsed. */
function Tip({ show, children }) {
  if (!show) return null;
  return (
    <span style={{
      position: "absolute", left: "calc(100% + 10px)", top: "50%", transform: "translateY(-50%)",
      background: colors.text, color: "#fff", padding: "5px 10px", borderRadius: radius.sm,
      fontSize: font.sm, whiteSpace: "nowrap", zIndex: 60, pointerEvents: "none",
      boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
    }}>{children}</span>
  );
}

/** A single top-level link. */
function SideLink({ to, icon: Icon, label, active, collapsed, hovered, setHovered }) {
  return (
    <div style={{ position: "relative" }}
         onMouseEnter={() => setHovered(to)} onMouseLeave={() => setHovered(null)}>
      <Link to={to} style={{
        display: "flex", alignItems: "center", gap: 10,
        justifyContent: collapsed ? "center" : "flex-start",
        height: 42, padding: collapsed ? 0 : "0 10px", marginBottom: 4,
        borderRadius: radius.md, textDecoration: "none",
        background: active ? S.itemActive : "transparent",
        color: colors.textOnDark,
      }}>
        <Icon size={16} />
        {!collapsed && <span style={{ fontSize: font.md, fontWeight: active ? 600 : 400 }}>{label}</span>}
      </Link>
      <Tip show={collapsed && hovered === to}>{label}</Tip>
    </div>
  );
}

export default function Sidebar() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();

  // One sidebar, two audiences. The cashier gets counter work; the owner gets
  // everything. Keeping it in one component means the two can never drift apart.
  const isCashier = Number(user?.role_id) === 3;
  const NAV = isCashier ? CASHIER_NAV : ADMIN_NAV;
  const [homeLabel, homeTo, HomeIcon] = isCashier ? HOME.cashier : HOME.admin;

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch { /* private mode */ }
    // Pages offset their content with var(--sidebar-w), so they follow the
    // collapse without every one of them needing to know the state.
    document.documentElement.style.setProperty(
      "--sidebar-w", `${collapsed ? S.widthCollapsed : S.width}px`
    );
  }, [collapsed]);

  const isActive = (to) => pathname === to;
  const groupActive = (g) => g.items.some(([, to]) => pathname === to || pathname.startsWith(to + "/"));

  // Groups open to follow the route, then stay under the user's control.
  const [open, setOpen] = useState(() =>
    NAV.reduce((a, g) => ({ ...a, [g.id]: g.items.some(([, to]) => pathname.startsWith(to)) }), {})
  );
  useEffect(() => {
    NAV.forEach((g) => { if (groupActive(g)) setOpen((o) => ({ ...o, [g.id]: true })); });
    // eslint-disable-next-line
  }, [pathname]);

  // Ctrl/Cmd+B toggles, matching the usual convention.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const W = collapsed ? S.widthCollapsed : S.width;

  return (
    <>
      <aside style={{
        width: W, minHeight: "100vh", position: "fixed", left: 0, top: 0, bottom: 0, zIndex: 40,
        background: S.bg, color: colors.textOnDark,
        display: "flex", flexDirection: "column",
        boxSizing: "border-box", overflow: "hidden",
        transition: "width 200ms ease",
      }}>
        {/* ── Header ──
            The mark is a square JPG on white, so it needs a light plate to sit
            on. Kept flush and generous rather than a small boxed-in badge. */}
        <div style={{
          flexShrink: 0, minHeight: 60,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: collapsed ? "14px 10px" : "18px 16px",
        }}>
          <BrandLogo
            size={collapsed ? 40 : 76}
            radius="50%"
            padding={collapsed ? 5 : 9}
            style={{
              boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
              transition: "width 200ms ease, height 200ms ease",
            }}
          />
        </div>

        {/* ── Content (scrolls) ── */}
        <nav style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "12px 8px" }}>
          <SideLink
            to={homeTo} icon={HomeIcon} label={homeLabel}
            active={isActive(homeTo)} collapsed={collapsed}
            hovered={hovered} setHovered={setHovered}
          />

          {NAV.map((group) => {
            const GroupIcon = group.icon;
            const gActive = groupActive(group);

            // Collapsed: the group icon links to its first page.
            if (collapsed) {
              return (
                <div key={group.id} style={{ position: "relative" }}
                     onMouseEnter={() => setHovered(group.id)} onMouseLeave={() => setHovered(null)}>
                  <Link to={group.items[0][1]} style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    height: 42, marginBottom: 4, borderRadius: radius.md,
                    background: gActive ? S.itemActive : "transparent",
                    color: colors.textOnDark, textDecoration: "none",
                  }}>
                    <GroupIcon size={17} />
                  </Link>
                  <Tip show={hovered === group.id}>{group.label}</Tip>
                </div>
              );
            }

            const isOpen = open[group.id];
            return (
              <div key={group.id} style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [group.id]: !o[group.id] }))}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "9px 10px", borderRadius: radius.md, border: "none", cursor: "pointer",
                    background: gActive ? S.groupActive : "transparent",
                    color: colors.textOnDark, marginBottom: 2,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <GroupIcon size={15} />
                    <span style={{
                      fontSize: font.base, fontWeight: 700, letterSpacing: 0.4,
                      textTransform: "uppercase", whiteSpace: "nowrap",
                    }}>{group.label}</span>
                  </span>
                  <FaChevronDown size={10} style={{
                    transform: isOpen ? "rotate(180deg)" : "none",
                    transition: "transform 180ms ease", opacity: 0.8,
                  }} />
                </button>

                {isOpen && (
                  <div style={{ marginLeft: 18, paddingLeft: 10, borderLeft: `1px solid ${S.divider}` }}>
                    {group.items.map(([label, to]) => (
                      <Link key={to} to={to} style={{
                        display: "block", padding: "7px 10px", marginBottom: 2,
                        borderRadius: radius.sm, textDecoration: "none", fontSize: font.md,
                        fontWeight: isActive(to) ? 600 : 400,
                        color: isActive(to) ? S.textActive : S.text,
                        background: isActive(to) ? S.itemActive : "transparent",
                      }}>
                        {label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* ── Footer ── */}
        <div style={{ borderTop: `1px solid ${S.divider}`, padding: 10, flexShrink: 0 }}>
          {!collapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px 10px" }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                background: "rgba(255,255,255,0.2)", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: font.sm, fontWeight: 700, overflow: "hidden",
              }}>
                {user?.u_image
                  ? <img src={user.u_image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : initials(`${user?.u_fname || ""} ${user?.u_lname || ""}`)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: font.base, fontWeight: 600,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {user?.u_fname || "User"} {user?.u_lname || ""}
                </div>
                <div style={{ fontSize: font.xs, color: S.text, opacity: 0.75 }}>
                  {ROLE_LABEL[Number(user?.role_id)] || "Staff"}
                </div>
              </div>
            </div>
          )}

          <div style={{ position: "relative" }}
               onMouseEnter={() => setHovered("logout")} onMouseLeave={() => setHovered(null)}>
            <button onClick={logout} style={{
              width: "100%", display: "flex", alignItems: "center",
              justifyContent: collapsed ? "center" : "flex-start", gap: 10,
              padding: "9px 10px", borderRadius: radius.md, border: "none",
              background: "transparent", color: colors.textOnDark,
              cursor: "pointer", fontSize: font.md,
            }}>
              <FaSignOutAlt size={15} />
              {!collapsed && <span>Log Out</span>}
            </button>
            <Tip show={collapsed && hovered === "logout"}>Log Out</Tip>
          </div>
        </div>
      </aside>

      {/* ── Rail: the edge toggles the sidebar ── */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        title={`${collapsed ? "Expand" : "Collapse"} sidebar  (Ctrl+B)`}
        style={{
          position: "fixed", top: 0, bottom: 0, left: W - 6, width: 12, zIndex: 45,
          border: "none", background: "transparent", cursor: "pointer", padding: 0,
          transition: "left 200ms ease",
        }}
      >
        <span style={{
          position: "absolute", top: "50%", left: -5, transform: "translateY(-50%)",
          width: 22, height: 22, borderRadius: "50%",
          background: colors.surface, color: colors.primary,
          border: `1px solid ${colors.border}`, boxShadow: "0 1px 4px rgba(15,23,42,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9,
        }}>
          {collapsed ? <FaAngleDoubleRight /> : <FaAngleDoubleLeft />}
        </span>
      </button>
    </>
  );
}

/** Consumers read this to offset their content by the current rail width. */
export const SIDEBAR_WIDTH = S.width;
export const SIDEBAR_WIDTH_COLLAPSED = S.widthCollapsed;
