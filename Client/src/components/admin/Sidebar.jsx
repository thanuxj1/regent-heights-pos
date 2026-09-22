import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FaTachometerAlt,
  FaStore,
  FaUsers,
  FaChartBar,
  FaMoneyBill,
  FaSignOutAlt,
  FaBox,
} from "react-icons/fa";
import { useAuth } from "../../context/AuthContext";

const Sidebar = () => {
  const location = useLocation();
  const { logout } = useAuth();

  const menuItem = (icon, label, path) => {
    const isActive = location.pathname === path || location.pathname.startsWith(path);
    return (
      <Link
        to={path}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 20px",
          background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
          borderRadius: 10,
          cursor: "pointer",
          marginBottom: 8,
          color: "#fff",
          textDecoration: "none",
          transition: "background 0.2s ease",
        }}
      >
        {icon}
        <span style={{ fontSize: 15, fontWeight: isActive ? 600 : 500 }}>{label}</span>
      </Link>
    );
  };

  return (
    <div
      style={{
        width: 240,
        minHeight: "100vh",
        height: "100%",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#1565C0",
        padding: "20px 12px 28px",
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        overflowY: "auto",
        boxSizing: "border-box",
        zIndex: 40,
      }}
    >
      <div>
        <div style={{ padding: "10px", textAlign: "center" }}>
          <img src="/navbar_logo.jpg" alt="Develop Your Aspect" style={{ maxWidth: "100%", maxHeight: "60px", background: "white", padding: "5px", borderRadius: "10px" }} />
        </div>

        <div style={{ marginTop: 30 }}>
          {menuItem(<FaTachometerAlt />, "Dashboard", "/admin/dashboard")}
          {menuItem(<FaStore />, "Branches", "/branches")}
          {menuItem(<FaBox />, "Products", "/admin/products")}
          {menuItem(<FaUsers />, "User Management", "/users")}
          {menuItem(<FaChartBar />, "Statistics", "/admin/statistics")}
          {menuItem(<FaMoneyBill />, "Transactions", "/admin/transactions")}
          {/* Promotions hidden — module not yet active */}
          
          
        </div>
      </div>

      <div>
        <button
          onClick={logout}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 20px",
            background: "transparent",
            borderRadius: 10,
            cursor: "pointer",
            color: "#fff",
            border: "none",
            width: "100%",
            fontSize: 15,
            fontWeight: 500,
          }}
        >
          <FaSignOutAlt />
          <span>Log Out</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;


// import React from "react";
// import { Link, useLocation } from "react-router-dom"; // 1. Import Router tools
// import {
//   FaTachometerAlt,
//   FaStore,
//   FaUsers,
//   FaChartBar,
//   FaMoneyBill,
//   FaCog,
//   FaSignOutAlt,
// } from "react-icons/fa";

// const Sidebar = () => {
//   const location = useLocation(); // 2. Get the current URL path

//   const menuItem = (icon, label, path) => {
//     // 3. Check if this item is the active one
//     const isActive = location.pathname === path;
// export default Sidebar;


// import React from "react";
// import {
//   FaTachometerAlt,
//   FaStore,
//   FaUsers,
//   FaChartBar,
//   FaMoneyBill,
//   FaCog,
//   FaSignOutAlt,
// } from "react-icons/fa";
// export default Sidebar;


