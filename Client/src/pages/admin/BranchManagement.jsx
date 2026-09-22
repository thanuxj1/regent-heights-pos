import React, { useEffect, useState } from "react";
import { FaSearch} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import Sidebar from "../../components/admin/Sidebar";
import Header from "../../components/admin/Header";
import BranchTable from "../../components/admin/BranchTable";
import Button from "../../components/admin/Button";
import AddBranchWizard from "../../components/admin/AddBranchModal";
import { getBranches, setAuthToken, logout } from "../../services/api";
import { connectSocket } from "../../services/socket";
import Spinner from "../../components/super-admin/Spinner";


const SIDEBAR_WIDTH = 240;
const HEADER_HEIGHT = 64;

const BranchManagement = () => {
  const [branches, setBranches] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [searchQuery,setSearchQuery]=useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/login");
      return;
    }
    setAuthToken(token);
    fetchBranches();
  }, [navigate]);

  // Realtime branch updates (created / updated / deleted)
  useEffect(() => {
    const socket = connectSocket();

    const handleCreated = (branch) => {
      setBranches((prev) => [branch, ...prev]);
    };

    const handleUpdated = (branch) => {
      setBranches((prev) => prev.map((b) => (b.B_id === branch.B_id ? branch : b)));
    };

    const handleDeleted = (payload) => {
      const id = payload?.B_id ?? payload?.b_id ?? payload?.id ?? null;
      if (id == null) return;
      setBranches((prev) => prev.filter((b) => Number(b.B_id) !== Number(id)));
    };

    socket.on("branch:created", handleCreated);
    socket.on("branch:updated", handleUpdated);
    socket.on("branch:deleted", handleDeleted);

    return () => {
      socket.off("branch:created", handleCreated);
      socket.off("branch:updated", handleUpdated);
      socket.off("branch:deleted", handleDeleted);
    };
  }, []);

  const fetchBranches = async () => {
    try {
      setLoading(true);

      const data = await getBranches();
      setBranches(data);
    } catch (err) {
      console.error("fetchBranches error:", err);

      if (err.response?.status === 401) {
        logout();
        navigate("/login");
      }
    } finally {
      setLoading(false);
    }
  };


const filteredBranches = branches.filter((branch) => {
  if (!searchQuery.trim()) return true; // If filter is empty/whitespace, show everything
  const companyName = branch.com_name || "";
  const branchName = branch.B_name || "";
  
  return companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
         branchName.toLowerCase().includes(searchQuery.toLowerCase());
});

  const addButtonStyle = {
  padding: "10px 18px",
  background: "#2E3E8F", // or backgroundColor: "#2E3E8F"
  color: "#fff",
  borderRadius: "8px",
  fontWeight: 600,
};

  return (
    <div style={{ display: "flex",minHeight: "100vh", background: "#F4F6F9" }}>
      <Sidebar />

      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)" }}>
        <Header />

        <div style={{ padding: "20px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <h1 style={{ fontSize: "22px", margin: 10, fontWeight: "500" }}>Branch Management</h1>
            <Button label="+ New Branch" onClick={() => setShowModal(true)} />
          </div>

          <div style={{ position: "relative", width: "100%", maxWidth: "300px", marginBottom: "20px" }}>
           <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
            <input
              type="text"
              placeholder="Search here..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                maxWidth: "300px",
                padding: "10px 14px 10px 36px",
                borderRadius: "8px",
                border: "1px solid #D1D5DB",
                fontSize: "14px",
                outline: "none",
                boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              }}
            />
          </div>

          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "200px", marginTop: "24px", background: "#ffffff", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0, 0, 0, 0.05)" }}>
              <Spinner size={36} />
            </div>
          ) : filteredBranches.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 20px", marginTop: "24px", background: "#ffffff", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0, 0, 0, 0.05)", color: "#6B7280" }}>
            <p style={{ fontSize: "16px", fontWeight: "500", margin: 0 }}>
              No records match "{searchQuery}"
            </p>
            <p style={{ fontSize: "14px", marginTop: "4px", color: "#9CA3AF" }}>
             Try checking your spelling or using a different search term.
             </p>
          </div>
        ):(
            <BranchTable branches={filteredBranches} />
          )}
        </div>
      </div>
      {showModal && (
        <AddBranchWizard
          onClose={() => setShowModal(false)}
          onSuccess={fetchBranches}
        />
      )}
    </div>
  );
};

export default BranchManagement;
//       <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)" }}>
//         <Header />
// export default BranchManagement;


// // import React, { useEffect, useState } from "react";
// // import Sidebar from "../../components/admin/Sidebar";
// // import Header from "../../components/admin/Header";
// // import BranchTable from "../../components/admin/BranchTable";
// // import Button from "../../components/admin/Button";
// // import AddBranchWizard from "../../components/admin/AddBranchModal";
// // import { getBranches } from "../../services/api";

// // const BranchManagement = () => {
// //   const [branches, setBranches] = useState([]);
// //   const [showModal, setShowModal] = useState(false);

// //   useEffect(() => {
// //     fetchBranches();
// //   }, []);

// //   const fetchBranches = async () => {
// //     const data = await getBranches();
// //     setBranches(data);
// //   };

// //   return (
// //     <div style={{ display: "flex", background: "#F4F6F9" }}>
// //       <Sidebar />

// //       <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)" }}>
// //         <Header />

// //         <div style={{ padding: "20px" }}>
// //           <div
// //             style={{
// //               display: "flex",
// //               justifyContent: "space-between",
// //               alignItems: "center",
// //             }}
// //           >
// //             <h1 style={{ fontSize: "22px", margin: 10, fontWeight: "500" }}>Branch Management</h1>
// //             <Button label="+ New Branch" onClick={() => setShowModal(true)} />
// //           </div>

// //           <BranchTable branches={branches} />
// //         </div>
// //       </div>
// //       {showModal && (
// //         <AddBranchWizard
// //           onClose={() => setShowModal(false)}
// //           onSuccess={fetchBranches}
// //         />
// //       )}
// //     </div>
// //   );
// // };

// // export default BranchManagement;


