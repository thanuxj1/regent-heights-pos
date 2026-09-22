import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { roleHome } from "../utils/roleHome";

/**
 * Lets a signed-in person with one of the allowed roles through.
 *
 * Someone signed in with the wrong role goes straight to their own screen. It
 * used to send them to "/", the login page, which sent them on to their own
 * screen; when that screen turned them away too, the two redirects bounced
 * forever ("Maximum update depth exceeded"). A redirect now never leads back to
 * where it came from: if even a person's own screen will not have them, they
 * are told so instead.
 */
export default function ProtectedRoute({ children, allowedRoles = [] }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  const role = Number(user.role_id);
  if (allowedRoles.length && !allowedRoles.map(Number).includes(role)) {
    const home = roleHome(role);
    if (home && home !== location.pathname) return <Navigate to={home} replace />;
    return <NoAccess />;
  }

  return children;
}

function NoAccess() {
  const { logout } = useAuth();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F8FAFC", padding: 16 }}>
      <div style={{ maxWidth: 440, background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 10px 30px rgba(15,23,42,0.08)", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>
          This screen is not open to your account
        </h1>
        <p style={{ color: "#64748B", fontSize: 14, lineHeight: 1.6, marginTop: 8 }}>
          Ask the administrator to check your account's role, or sign in as someone else.
        </p>
        <button
          type="button"
          onClick={logout}
          style={{ marginTop: 18, padding: "10px 18px", borderRadius: 10, border: "none", background: "#1565C0", color: "#fff", fontWeight: 600, cursor: "pointer" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
