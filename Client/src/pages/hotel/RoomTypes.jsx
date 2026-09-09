import React, { useEffect, useRef, useState } from "react";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import {
  getRoomTypes, createRoomType, updateRoomType, deleteRoomType,
  getMealPlans, updateMealPlan,
} from "../../services/api";
import {
  card, input, label, btn, modalWrap, modalBox, errorBox,
  money, AMENITY_OPTIONS, readImageFile,
} from "./ui";

const BLANK = {
  type_name: "", type_code: "", description: "", base_occupancy: 2, max_occupancy: 3,
  base_rate: "", extra_adult_rate: 0, extra_child_rate: 0, bed_config: "", size_sqft: "",
  amenities: [], images: [],
};

export default function RoomTypes() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [types, setTypes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [t, p] = await Promise.all([
        getRoomTypes({ b_id: branchId }),
        getMealPlans({ b_id: branchId }),
      ]);
      setTypes(t); setPlans(p);
    } catch { } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [branchId]);

  const remove = async (t) => {
    if (!confirm(`Delete room type "${t.type_name}"?`)) return;
    try { await deleteRoomType(t.room_type_id); load(); }
    catch (err) { setError(err?.response?.data?.message || "Could not delete"); }
  };

  const savePlan = async (plan, field, value) => {
    try {
      await updateMealPlan(plan.plan_id, { [field]: Number(value) });
      load();
    } catch { setError("Could not update meal plan"); }
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
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#1E293B" }}>{t.type_name}</div>
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
                      Sleeps {t.base_occupancy}–{t.max_occupancy} · {t.room_count || 0} room(s) built
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

          {/* Meal plan supplements */}
          <div style={{ ...card, overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9" }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B" }}>Meal Plan Supplements</div>
              <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>
                Charged per person, per night, on top of the room rate.
              </div>
            </div>
            <div style={{ padding: 16 }}>
              {plans.map(p => (
                <div key={p.plan_id} style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px", gap: 14,
                                              alignItems: "center", padding: "10px 4px", borderBottom: "1px solid #F8FAFC" }}>
                  <div>
                    <strong style={{ fontSize: 13, color: "#1E293B" }}>{p.plan_name}</strong>
                    <span style={{ fontSize: 12, color: "#94A3B8" }}> · {p.plan_code}</span>
                  </div>
                  <label style={{ ...label, fontSize: 11 }}>Per adult / night
                    <input type="number" min={0} step="0.01" defaultValue={p.supplement_per_adult}
                      onBlur={e => savePlan(p, "supplement_per_adult", e.target.value)}
                      style={{ ...input, marginTop: 2, padding: "6px 10px", fontSize: 13 }} />
                  </label>
                  <label style={{ ...label, fontSize: 11 }}>Per child / night
                    <input type="number" min={0} step="0.01" defaultValue={p.supplement_per_child}
                      onBlur={e => savePlan(p, "supplement_per_child", e.target.value)}
                      style={{ ...input, marginTop: 2, padding: "6px 10px", fontSize: 13 }} />
                  </label>
                </div>
              ))}
            </div>
          </div>

      {showModal && (
        <RoomTypeModal
          branchId={branchId}
          initial={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </AppShell>
  );
}

function RoomTypeModal({ branchId, initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => initial ? {
    type_name: initial.type_name || "", type_code: initial.type_code || "",
    description: initial.description || "", base_occupancy: initial.base_occupancy,
    max_occupancy: initial.max_occupancy, base_rate: initial.base_rate,
    extra_adult_rate: initial.extra_adult_rate, extra_child_rate: initial.extra_child_rate,
    bed_config: initial.bed_config || "", size_sqft: initial.size_sqft || "",
    amenities: initial.amenities || [], images: initial.images || [],
  } : { ...BLANK });
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imgError, setImgError] = useState("");
  const fileRef = useRef(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true); setImgError("");
    const added = [];
    for (const f of files) {
      try { added.push(await readImageFile(f)); }
      catch (e) { setImgError(e.message); }
    }
    if (added.length) setForm(f => ({ ...f, images: [...f.images, ...added] }));
    setUploading(false);
  };
  const toggleAmenity = (a) =>
    setForm(f => ({ ...f, amenities: f.amenities.includes(a) ? f.amenities.filter(x => x !== a) : [...f.amenities, a] }));

  const addImage = () => {
    const u = imageUrl.trim();
    if (!u) return;
    setForm(f => ({ ...f, images: [...f.images, u] }));
    setImageUrl("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.type_name.trim()) { setErr("Type name is required"); return; }
    if (Number(form.max_occupancy) < Number(form.base_occupancy)) {
      setErr("Max occupancy cannot be less than base occupancy"); return;
    }
    setBusy(true); setErr("");
    try {
      const payload = {
        ...form, b_id: branchId,
        base_rate: Number(form.base_rate) || 0,
        base_occupancy: Number(form.base_occupancy),
        max_occupancy: Number(form.max_occupancy),
        extra_adult_rate: Number(form.extra_adult_rate) || 0,
        extra_child_rate: Number(form.extra_child_rate) || 0,
        size_sqft: form.size_sqft ? Number(form.size_sqft) : null,
      };
      if (initial) await updateRoomType(initial.room_type_id, payload);
      else await createRoomType(payload);
      onSaved();
    } catch (ex) {
      setErr(ex?.response?.data?.message || "Could not save room type");
      setBusy(false);
    }
  };

  return (
    <div style={modalWrap}><div style={modalBox(620)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1E293B" }}>
          {initial ? "Edit Room Type" : "Add Room Type"}
        </h2>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#94A3B8", cursor: "pointer" }}>✕</button>
      </div>
      {err && <div style={errorBox}>{err}</div>}

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <label style={label}>Type Name *
            <input value={form.type_name} onChange={e => set("type_name", e.target.value)}
              placeholder="e.g. Deluxe Double Room" style={{ ...input, marginTop: 4 }} />
          </label>
          <label style={label}>Code
            <input value={form.type_code} onChange={e => set("type_code", e.target.value)}
              placeholder="DBL" style={{ ...input, marginTop: 4 }} />
          </label>
        </div>

        <label style={label}>Description
          <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2}
            placeholder="What makes this room special…" style={{ ...input, marginTop: 4, resize: "vertical" }} />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          <label style={label}>Base Rate / night *
            <input type="number" min={0} step="0.01" value={form.base_rate}
              onChange={e => set("base_rate", e.target.value)} style={{ ...input, marginTop: 4 }} />
          </label>
          <label style={label}>Sleeps (base)
            <input type="number" min={1} value={form.base_occupancy}
              onChange={e => set("base_occupancy", e.target.value)} style={{ ...input, marginTop: 4 }} />
          </label>
          <label style={label}>Sleeps (max)
            <input type="number" min={1} value={form.max_occupancy}
              onChange={e => set("max_occupancy", e.target.value)} style={{ ...input, marginTop: 4 }} />
          </label>
          <label style={label}>Size (sqft)
            <input type="number" min={0} value={form.size_sqft}
              onChange={e => set("size_sqft", e.target.value)} style={{ ...input, marginTop: 4 }} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          <label style={label}>Bed Configuration
            <input value={form.bed_config} onChange={e => set("bed_config", e.target.value)}
              placeholder="1 King Bed" style={{ ...input, marginTop: 4 }} />
          </label>
          <label style={label}>Extra Adult / night
            <input type="number" min={0} step="0.01" value={form.extra_adult_rate}
              onChange={e => set("extra_adult_rate", e.target.value)} style={{ ...input, marginTop: 4 }} />
          </label>
          <label style={label}>Extra Child / night
            <input type="number" min={0} step="0.01" value={form.extra_child_rate}
              onChange={e => set("extra_child_rate", e.target.value)} style={{ ...input, marginTop: 4 }} />
          </label>
        </div>

        <div>
          <div style={{ ...label, marginBottom: 8 }}>Facilities</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {AMENITY_OPTIONS.map(a => {
              const on = form.amenities.includes(a);
              return (
                <button key={a} type="button" onClick={() => toggleAmenity(a)}
                  style={{
                    padding: "5px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                    border: on ? "1px solid #1565C0" : "1px solid #E2E8F0",
                    background: on ? "#EFF6FF" : "#fff", color: on ? "#1565C0" : "#64748B",
                    fontWeight: on ? 600 : 400,
                  }}>
                  {on ? "✓ " : ""}{a}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div style={{ ...label, marginBottom: 6 }}>Photos</div>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "#1565C0" : "#E2E8F0"}`,
              background: dragging ? "#EFF6FF" : "#F8FAFC",
              borderRadius: 10, padding: "18px 16px", textAlign: "center", cursor: "pointer",
            }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>🖼️</div>
            <div style={{ fontSize: 13, color: "#475569", fontWeight: 600 }}>
              {uploading ? "Processing…" : "Choose photos from your computer"}
            </div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
              or drag them here · JPG or PNG · resized automatically
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
              onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addImage(); } }}
              placeholder="…or paste an image URL" style={{ ...input, fontSize: 13 }} />
            <button type="button" onClick={addImage} style={btn("ghost")}>Add</button>
          </div>

          {imgError && (
            <div style={{ ...errorBox, marginTop: 8, marginBottom: 0 }}>{imgError}</div>
          )}

          {form.images.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {form.images.map((img, i) => (
                <div key={i} style={{ position: "relative" }}>
                  <img src={img} alt="" style={{ width: 78, height: 58, objectFit: "cover", borderRadius: 6, border: "1px solid #E2E8F0" }} />
                  {i === 0 && (
                    <span style={{ position: "absolute", bottom: 2, left: 2, background: "rgba(21,101,192,0.9)",
                                   color: "#fff", fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 700 }}>
                      COVER
                    </span>
                  )}
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, images: f.images.filter((_, j) => j !== i) }))}
                    style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%",
                             background: "#DC2626", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          {form.images.length > 1 && (
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 6 }}>
              The first photo is used as the cover on the room-type card.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
          <button type="button" onClick={onClose} style={{ ...btn("ghost"), flex: 1, padding: 11 }}>Cancel</button>
          <button type="submit" disabled={busy} style={{ ...btn("primary"), flex: 1, padding: 11 }}>
            {busy ? "Saving…" : initial ? "Update" : "Create"}
          </button>
        </div>
      </form>
    </div></div>
  );
}
