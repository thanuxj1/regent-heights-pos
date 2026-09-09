import React, { useEffect, useState } from "react";
import { FaBell, FaUserCircle, FaSignOutAlt } from "react-icons/fa";
import BrandLogo from "../BrandLogo";
import { useAuth } from "../../context/AuthContext";
import { getBranchById } from "../../services/api";

const ROLE_LABELS = {
  1: "Administrator",
  2: "Administrator",
  3: "Cashier",
  6: "Super Admin",
  8: "Waiter",
  9: "Kitchen Staff",
};

const CashierHeader = () => {
  const { user, logout } = useAuth();
  const [branchName, setBranchName] = useState("Loading...");
  const roleLabel = ROLE_LABELS[user?.role_id] || "Staff";

  useEffect(() => {
    const branchId = user?.b_id ?? user?.B_id ?? null;

    const fetchBranch = async () => {
      try {
        const res = await getBranchById(branchId);
        // handle both direct { B_name } and wrapped { data: { B_name } }
        const name = res?.B_name ?? res?.data?.B_name ?? null;
        setBranchName(name || "—");
      } catch {
        setBranchName("—");
      }
    };

    if (branchId) fetchBranch();
    else setBranchName("—");
  }, [user?.b_id, user?.B_id]);

  return (
    <header className="w-full text-white shadow-sm" style={{ background: "linear-gradient(135deg, #0D47A1 0%, #1565C0 60%, #00B5E2 100%)" }}>
      <div className="max-w-8xl mx-auto flex items-center justify-between px-6 py-3">
        {/* Left: Logo */}
        <div className="flex items-center gap-3">
          <BrandLogo size={44} />
        </div>

        {/* Right: user summary */}
        <div className="flex items-center gap-2">

          <div className="flex items-center gap-2 bg-black/15 rounded-lg px-3 py-1.5 border border-white/20">
            <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
              <FaUserCircle className="w-5 h-5" />
            </div>
            <div className="text-right leading-tight hidden sm:block">
              <div className="text-xs font-semibold">{user?.u_fname || "Cashier"} {user?.u_lname || ""}</div>
              <div className="text-[11px] text-white/80">{roleLabel} • {branchName}</div>
            </div>
          </div>

          <button
            onClick={logout}
            className="ml-1 px-5 py-2 text-xs font-medium rounded-lg bg-black hover:bg-black/40 border border-white/20 transition-colors flex items-center gap-2"
          >
            <FaSignOutAlt className="w-3 h-8" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default CashierHeader;
