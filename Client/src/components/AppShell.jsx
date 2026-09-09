import React from "react";
import BranchSidebar from "./branch-admin/Sidebar";
import BranchHeader from "./branch-admin/Header";
import { useAuth } from "../context/AuthContext";

/**
 * One shell for every page a Branch Admin or a Cashier can open.
 *
 * Both get the same shape — sidebar down the left, page to the right. The
 * sidebar itself decides what to list based on the role, so the cashier sees
 * front-desk work and the till while the owner sees everything.
 */
export default function AppShell({ title, children, actions = null }) {
  const { user } = useAuth();
  const isCashier = Number(user?.role_id) === 3;

  // One shape for everyone: sidebar down the left, page to the right. The
  // cashier used to get a top header plus two tab rows instead, which ate
  // roughly 150px of height off the till — the screen that needs it most.
  // The window is the page: the shell is exactly one viewport tall and only
  // `main` scrolls, so the header and the sidebar stay put instead of the whole
  // document sliding under them.
  return (
    <div className="app-shell" style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#F4F7FB" }}>
      <BranchSidebar />
      <div className="print-shell" style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <BranchHeader title={title} actions={actions} />
        <main style={{ flex: 1, minHeight: 0, padding: isCashier ? 16 : 24, overflowY: "auto" }}>{children}</main>
      </div>
    </div>
  );
}
