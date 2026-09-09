import React, { useEffect, useState } from "react";
import { FaBell, FaUserCircle } from "react-icons/fa";
import { getCurrentUser } from "../../services/api";

const Header = ({ title = "System Admin DashBoard" }) => {
  const [user, setUser] = useState(() => getCurrentUser());

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "user") setUser(getCurrentUser());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const displayName =
    user && (user.u_fname || user.u_lname)
      ? `${user.u_fname ?? ""} ${user.u_lname ?? ""}`.trim()
      : user?.u_email ?? "super Admin";
  const email = user?.u_email ?? "superadmin@gmail.com";

  return (
    <div style={{
      height: "70px", display: "flex", width: "100%",
      justifyContent: "space-between", alignItems: "center",
      padding: "0 20px", margin: 0, color: "#fff",
      background: "linear-gradient(135deg, #0D47A1 0%, #1565C0 60%, #00B5E2 100%)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <h2 style={{ fontSize: "22px", margin: 0, fontWeight: "500" }}>{title}</h2>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        <FaBell size={20} style={{ opacity: 0.4 }} />
        <div style={{
          display: "flex", alignItems: "center", gap: "10px",
          background: "rgba(255,255,255,0.2)", padding: "5px 10px", borderRadius: "20px",
        }}>
          <FaUserCircle size={30} />
          <div>
            <div style={{ fontSize: "14px" }}>{displayName}</div>
            <div style={{ fontSize: "12px" }}>{email}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Header;
