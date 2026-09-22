import React, { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import {
  getRoomTypes, createRoomType, updateRoomType, deleteRoomType,
} from "../../services/api";
import RoomTypeModal from "./RoomTypeModal";
import { card, btn, errorBox, money } from "./ui";

export default function RoomTypes() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const t = await getRoomTypes({ b_id: branchId });
      setTypes(t);
    } catch { } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [branchId]);

  const remove = async (t) => {
    if (!confirm(`Delete room type "${t.type_name}"?`)) return;
    try { await deleteRoomType(t.room_type_id); load(); }
    catch (err) { setError(err?.response?.data?.message || "Could not delete"); }
  };


  return (
    <AppShell title="Room Types & Rates">
          {error && <div style={errorBox}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ color: "#64748B", fontSize: 13 }}>
              Define each category of room once — rate, occupancy and facilities. Individual rooms reference a type.
            </div>
            <button onClick={() => { setEditing(null); setShowModal(true); }} style={btn("primary")}>+ Add Room Type</button>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: "#94A3B8" }}>Loading…</div>
          ) : types.length === 0 ? (
            <div style={{ ...card, padding: 48, textAlign: "center", color: "#94A3B8" }}>
              No room types yet. Add one to start building the hotel.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16, marginBottom: 32 }}>
              {types.map(t => (
                <div key={t.room_type_id} style={{ ...card, overflow: "hidden", opacity: t.is_active ? 1 : 0.6 }}>
                  {t.images?.[0] ? (
                    <img src={t.images[0]} alt="" style={{ width: "100%", height: 150, objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ height: 150, background: "linear-gradient(135deg,#E0E7FF,#EFF6FF)",
                                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>🛏️</div>
                  )}
                  <div style={{ padding: 18 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#1E293B" }}>
                          {t.type_name}
                          {!t.is_active && (
                            <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 999, background: "#F1F5F9",
                                           color: "#64748B", fontSize: 10.5, fontWeight: 700, verticalAlign: "middle" }}>
                              Not bookable
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: "#94A3B8" }}>
                          {t.type_code && `${t.type_code} · `}{t.bed_config || "—"}
                          {t.size_sqft ? ` · ${t.size_sqft} sqft` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 17, fontWeight: 700, color: "#1565C0" }}>{money(t.base_rate)}</div>
                        <div style={{ fontSize: 11, color: "#94A3B8" }}>per night</div>
                      </div>
                    </div>

                    <div style={{ fontSize: 12, color: "#64748B", margin: "10px 0" }}>
                      {(() => {
                        const a = t.max_adults, c = t.max_children;
                        const parts = [
                          a ? `${a} adult${Number(a) === 1 ? "" : "s"}` : null,
                          c ? `${c} child${Number(c) === 1 ? "" : "ren"}` : null,
                        ].filter(Boolean);
                        return parts.length ? parts.join(" + ") : "No guest limit";
                      })()}
                      {t.included_guests != null ? ` · rate covers ${t.included_guests}` : ""}
                      {" · "}{t.room_count || 0} room(s) built
                    </div>

                    {t.description && (
                      <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10,
                                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {t.description}
                      </div>
                    )}

                    {(t.amenities || []).length > 0 && (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
                        {t.amenities.slice(0, 4).map(a => (
                          <span key={a} style={{ fontSize: 10, background: "#F1F5F9", color: "#475569", padding: "3px 8px", borderRadius: 20 }}>{a}</span>
                        ))}
                        {t.amenities.length > 4 && (
                          <span style={{ fontSize: 10, color: "#94A3B8", padding: "3px 4px" }}>+{t.amenities.length - 4} more</span>
                        )}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => { setEditing(t); setShowModal(true); }} style={{ ...btn("ghost"), flex: 1 }}>Edit</button>
                      <button onClick={() => remove(t)} style={btn("danger")}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}


      {showModal && (
        <RoomTypeModal
          branchId={branchId}
          initial={editing}
          types={types}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </AppShell>
  );
}
