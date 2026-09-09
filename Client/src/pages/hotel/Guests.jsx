import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import { getGuestDirectory } from "../../services/api";
import {
  card, input, btn, badge, th, td, errorBox, money, dmy, initials,
} from "./ui";

const FILTERS = [
  ["all", "All guests"],
  ["in_house", "In house now"],
  ["repeat", "Repeat guests"],
];

export default function Guests() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (q = search, f = filter) => {
    if (!branchId) return;
    setLoading(true); setError("");
    try {
      setRows(await getGuestDirectory({
        b_id: branchId,
        ...(q.trim() ? { search: q.trim() } : {}),
        ...(f !== "all" ? { filter: f } : {}),
      }));
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load guests");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(search, filter); /* eslint-disable-next-line */ }, [branchId, filter]);

  // Debounce the search so each keystroke doesn't fire a request
  useEffect(() => {
    if (!branchId) return;
    const t = setTimeout(() => load(search, filter), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [search]);

  return (
    <AppShell title="Guests">
      {error && <div style={errorBox}>{error}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, phone, email, passport or country…"
          style={{ ...input, width: 340 }}
        />
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            style={{
              padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: filter === k ? "1px solid #1565C0" : "1px solid #E2E8F0",
              background: filter === k ? "#1565C0" : "#fff",
              color: filter === k ? "#fff" : "#64748B",
            }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#94A3B8" }}>{rows.length} guest(s)</span>
      </div>

      <div style={{ ...card, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "#94A3B8" }}>Loading guests…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "#94A3B8" }}>
            {search.trim() ? "No guest matches that search." : "No guests yet — they're created with the first booking."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#F8FAFC" }}>
                {["Guest", "Contact", "Passport / NIC", "Stays", "Lifetime Spend", "Last Stay", ""].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map(g => (
                  <tr key={g.guest_id}
                    onClick={() => navigate(`/hotel/guests/${g.guest_id}`)}
                    style={{ borderTop: "1px solid #F1F5F9", cursor: "pointer" }}>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                                      background: g.in_house ? "#059669" : "#1565C0", color: "#fff",
                                      display: "flex", alignItems: "center", justifyContent: "center",
                                      fontWeight: 700, fontSize: 12 }}>
                          {initials(g.full_name)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: "#1E293B", display: "flex", alignItems: "center", gap: 7 }}>
                            {g.full_name}
                            {g.in_house && <span style={badge({ bg: "#D1FAE5", fg: "#065F46" })}>In house</span>}
                            {Number(g.stays) >= 2 && <span style={badge({ bg: "#FEF3C7", fg: "#92400E" })}>★ Repeat</span>}
                          </div>
                          <div style={{ fontSize: 11, color: "#94A3B8" }}>
                            {[g.country, g.nationality].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={td}>
                      <div>{g.phone || "—"}</div>
                      <div style={{ fontSize: 11, color: "#94A3B8" }}>{g.email || ""}</div>
                    </td>
                    <td style={{ ...td, color: "#64748B" }}>{g.passport_nic || "—"}</td>
                    <td style={td}>
                      <strong style={{ color: "#1E293B" }}>{g.stays}</strong>
                      <span style={{ color: "#94A3B8" }}> / {g.bookings} booking(s)</span>
                    </td>
                    <td style={{ ...td, fontWeight: 700, color: "#1E293B" }}>{money(g.lifetime_spend)}</td>
                    <td style={td}>{g.last_stay ? dmy(g.last_stay) : "—"}</td>
                    <td style={td}>
                      <button onClick={(e) => { e.stopPropagation(); navigate(`/hotel/guests/${g.guest_id}`); }}
                        style={btn("ghost")}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
