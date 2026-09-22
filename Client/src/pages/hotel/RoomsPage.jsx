import React, { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import { getRooms, getRoomTypes, createRoom, updateRoom, deleteRoom } from "../../services/api";
import {
  card, input, label, btn, badge,
  modalWrap, modalBox, errorBox, money, dmy, HK_STYLE,
} from "./ui";

const HK_OPTIONS = ["clean", "dirty", "inspected", "maintenance", "out_of_order"];

export default function RoomsPage() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;
  // Front desk updates housekeeping status; only a manager builds or removes rooms.
  const canEditRooms = Number(user?.role_id) !== 3;

  const [rooms, setRooms] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [r, t] = await Promise.all([
        getRooms({ b_id: branchId }),
        getRoomTypes({ b_id: branchId }),
      ]);
      setRooms(r); setTypes(t);
    } catch { } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [branchId]);

  const setStatus = async (room, hk_status) => {
    setError("");
    try { await updateRoom(room.room_id, { hk_status }); load(); }
    catch (err) { setError(err?.response?.data?.message || "Could not update room"); }
  };

  const remove = async (room) => {
    if (!confirm(`Delete Room ${room.room_number}?`)) return;
    try { await deleteRoom(room.room_id); load(); }
    catch (err) { setError(err?.response?.data?.message || "Could not delete room"); }
  };

  const shown = useMemo(() => {
    if (filter === "all") return rooms;
    if (["occupied", "reserved", "vacant"].includes(filter)) {
      return rooms.filter(r => r.occupancy === filter);
    }
    return rooms.filter(r => r.hk_status === filter);
  }, [rooms, filter]);

  const counts = useMemo(() => ({
    all: rooms.length,
    occupied: rooms.filter(r => r.occupancy === "occupied").length,
    reserved: rooms.filter(r => r.occupancy === "reserved").length,
    vacant:   rooms.filter(r => r.occupancy === "vacant").length,
    ...HK_OPTIONS.reduce((a, s) => ({ ...a, [s]: rooms.filter(r => r.hk_status === s).length }), {}),
  }), [rooms]);

  return (
    <AppShell title="Rooms & Housekeeping">
          {error && <div style={errorBox}>{error}</div>}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
            {[["all", "All"], ["occupied", "Occupied"], ["reserved", "Reserved"], ["vacant", "Vacant"],
              ...HK_OPTIONS.map(s => [s, HK_STYLE[s].label])].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                style={{
                  padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: filter === k ? "1px solid #1565C0" : "1px solid #E2E8F0",
                  background: filter === k ? "#1565C0" : "#fff", color: filter === k ? "#fff" : "#64748B",
                }}>
                {l} <span style={{ opacity: 0.7 }}>({counts[k] ?? 0})</span>
              </button>
            ))}
            <div style={{ flex: 1 }} />
            {canEditRooms && (
              <button
                onClick={() => { setEditing(null); setShowModal(true); }}
                disabled={types.length === 0}
                title={types.length === 0 ? "Create a room type first" : ""}
                style={{ ...btn("primary"), opacity: types.length === 0 ? 0.5 : 1 }}>
                + Add Room
              </button>
            )}
          </div>

          {types.length === 0 && !loading && canEditRooms && (
            <div style={{ ...card, padding: 20, marginBottom: 20, background: "#FEF9C3", borderColor: "#FDE68A", color: "#92400E", fontSize: 13 }}>
              Create at least one room type under <strong>Room Types &amp; Rates</strong> before adding rooms.
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: "#94A3B8" }}>Loading rooms…</div>
          ) : shown.length === 0 ? (
            <div style={{ ...card, padding: 48, textAlign: "center", color: "#94A3B8" }}>
              {rooms.length === 0 ? "No rooms yet. Add your first room." : "No rooms match this filter."}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 14 }}>
              {shown.map(r => {
                const hk = HK_STYLE[r.hk_status] || {};
                const edge = r.occupancy === "occupied" ? "#059669"
                           : r.occupancy === "reserved" ? "#F59E0B"
                           : hk.fg || "#CBD5E1";
                return (
                  <div key={r.room_id} style={{
                    ...card, padding: 16,
                    borderLeft: `4px solid ${edge}`,
                    opacity: r.is_active ? 1 : 0.55,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#1E293B" }}>Room {r.room_number}</div>
                        <div style={{ fontSize: 12, color: "#94A3B8" }}>
                          {r.type_name}{r.floor ? ` · Floor ${r.floor}` : ""}
                        </div>
                      </div>
                      <span style={badge(hk)}>{hk.label || r.hk_status}</span>
                    </div>

                    <div style={{ fontSize: 12, color: "#64748B", marginBottom: 10 }}>
                      {money(r.base_rate)}/night
                      {(() => {
                        const a = r.max_adults, c = r.max_children;
                        const who = [
                          a ? `${a} adult${Number(a) === 1 ? "" : "s"}` : null,
                          c ? `${c} child${Number(c) === 1 ? "" : "ren"}` : null,
                        ].filter(Boolean).join(" + ");
                        return who ? ` · takes ${who}` : "";
                      })()}
                    </div>

                    {r.occupancy === "occupied" ? (
                      <div style={{ background: "#D1FAE5", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#065F46" }}>{r.current_guest || "Occupied"}</div>
                        <div style={{ fontSize: 11, color: "#047857" }}>
                          {r.current_booking_ref} · out {dmy(r.current_check_out)}
                        </div>
                      </div>
                    ) : r.occupancy === "reserved" ? (
                      // Physically empty but already sold — never offer this as free.
                      <div style={{ background: "#FEF3C7", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>
                          Reserved · {r.current_guest || "Guest"}
                        </div>
                        <div style={{ fontSize: 11, color: "#B45309" }}>
                          {r.current_booking_ref} · arrives {dmy(r.current_check_in)}
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: "#F8FAFC", borderRadius: 8, padding: "8px 10px", marginBottom: 10,
                                    fontSize: 12, color: "#94A3B8", textAlign: "center" }}>Vacant</div>
                    )}

                    <select value={r.hk_status} onChange={e => setStatus(r, e.target.value)}
                      style={{ ...input, padding: "6px 10px", fontSize: 12, marginBottom: 8 }}>
                      {HK_OPTIONS.map(s => <option key={s} value={s}>{HK_STYLE[s].label}</option>)}
                    </select>

                    {canEditRooms && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => { setEditing(r); setShowModal(true); }} style={{ ...btn("ghost"), flex: 1, padding: "6px 10px", fontSize: 12 }}>Edit</button>
                        <button onClick={() => remove(r)} style={{ ...btn("danger"), padding: "6px 10px", fontSize: 12 }}>Del</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

      {showModal && (
        <RoomModal
          branchId={branchId} types={types} initial={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </AppShell>
  );
}

function RoomModal({ branchId, types, initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial ? {
    room_number: initial.room_number, room_type_id: initial.room_type_id,
    floor: initial.floor || "", hk_status: initial.hk_status, notes: initial.notes || "",
    is_active: initial.is_active,
  } : {
    room_number: "", room_type_id: types[0]?.room_type_id || "", floor: "",
    hk_status: "clean", notes: "", is_active: true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.room_number.trim()) { setErr("Room number is required"); return; }
    if (!form.room_type_id)       { setErr("Select a room type"); return; }
    setBusy(true); setErr("");
    try {
      const payload = { ...form, b_id: branchId, room_type_id: Number(form.room_type_id) };
      if (initial) await updateRoom(initial.room_id, payload);
      else await createRoom(payload);
      onSaved();
    } catch (ex) {
      setErr(ex?.response?.data?.message || "Could not save room");
      setBusy(false);
    }
  };

  return (
    <div style={modalWrap}><div style={modalBox(420)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1E293B" }}>{initial ? "Edit Room" : "Add Room"}</h2>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#94A3B8", cursor: "pointer" }}>✕</button>
      </div>
      {err && <div style={errorBox}>{err}</div>}
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={label}>Room Number *
            <input value={form.room_number} onChange={e => set("room_number", e.target.value)}
              placeholder="101" style={{ ...input, marginTop: 4 }} />
          </label>
          <label style={label}>Floor
            <input value={form.floor} onChange={e => set("floor", e.target.value)}
              placeholder="1" style={{ ...input, marginTop: 4 }} />
          </label>
        </div>
        <label style={label}>Room Type *
          <select value={form.room_type_id} onChange={e => set("room_type_id", e.target.value)} style={{ ...input, marginTop: 4 }}>
            <option value="">Select…</option>
            {types.map(t => <option key={t.room_type_id} value={t.room_type_id}>{t.type_name} — {money(t.base_rate)}</option>)}
          </select>
        </label>
        <label style={label}>Housekeeping Status
          <select value={form.hk_status} onChange={e => set("hk_status", e.target.value)} style={{ ...input, marginTop: 4 }}>
            {HK_OPTIONS.map(s => <option key={s} value={s}>{HK_STYLE[s].label}</option>)}
          </select>
        </label>
        <label style={label}>Notes
          <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2}
            style={{ ...input, marginTop: 4, resize: "vertical" }} />
        </label>
        {initial && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569", cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_active} onChange={e => set("is_active", e.target.checked)} />
            Room is active and bookable
          </label>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ ...btn("ghost"), flex: 1, padding: 11 }}>Cancel</button>
          <button type="submit" disabled={busy} style={{ ...btn("primary"), flex: 1, padding: 11 }}>
            {busy ? "Saving…" : initial ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </div></div>
  );
}
