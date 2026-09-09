import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { getGuestHistory, updateGuest } from "../../services/api";
import {
  card, input, label, btn, badge, th, td, modalWrap, modalBox, errorBox,
  money, dmy, initials, STATUS_STYLE,
} from "./ui";

const SOURCE_LABEL = {
  room: "Room", meal: "Meal Plan", restaurant: "Restaurant", bar: "Bar",
  laundry: "Laundry", minibar: "Minibar", tax: "Tax", discount: "Discount", misc: "Other",
};

// Kept at module scope so React reuses the component type across renders instead
// of remounting the subtree (which would drop focus out of any nested input).
const Field = ({ k, v }) => (
  <div>
    <div style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
    <div style={{ fontSize: 13, color: "#1E293B", marginTop: 2 }}>{v || "—"}</div>
  </div>
);

export default function GuestProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("stays");
  const [editing, setEditing] = useState(false);

  const load = async () => {
    try { setData(await getGuestHistory(id)); }
    catch (e) { setError(e?.response?.data?.message || "Could not load guest"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [id]);

  if (loading) return <AppShell title="Guest"><div style={{ textAlign: "center", padding: 60, color: "#94A3B8" }}>Loading…</div></AppShell>;
  if (!data)   return <AppShell title="Guest"><div style={errorBox}>{error || "Guest not found"}</div></AppShell>;

  const { guest: g, bookings, charges, stats, restaurant_orders: restOrders = [] } = data;

  const tabStyle = (t) => ({
    padding: "10px 20px", border: "none", background: "none", cursor: "pointer", fontSize: 14,
    fontWeight: tab === t ? 700 : 400, color: tab === t ? "#1565C0" : "#64748B",
    borderBottom: tab === t ? "2px solid #1565C0" : "2px solid transparent",
  });

  return (
    <AppShell title="Guest Profile">
      <button onClick={() => navigate(-1)} style={{ ...btn("ghost"), marginBottom: 16 }}>← Back</button>
      {error && <div style={errorBox}>{error}</div>}

      {/* Identity */}
      <div style={{ ...card, padding: 24, marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#1565C0", color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontWeight: 700, fontSize: 22, flexShrink: 0 }}>
            {initials(g.full_name)}
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 21, fontWeight: 700, color: "#1E293B" }}>{g.full_name}</span>
              {g.guest_status && (
                <span style={badge({ bg: "#F3E8FF", fg: "#6B21A8" })}>{g.guest_status}</span>
              )}
              {stats.completed_stays >= 3 && (
                <span style={badge({ bg: "#FEF3C7", fg: "#92400E" })}>★ Repeat guest</span>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                          gap: 14, marginTop: 14 }}>
              <Field k="Phone" v={g.phone} />
              <Field k="Email" v={g.email} />
              <Field k="Country" v={g.country} />
              <Field k="Nationality" v={g.nationality} />
              <Field k="Passport / NIC" v={g.passport_nic} />
              <Field k="Date of birth" v={g.date_of_birth ? dmy(g.date_of_birth) : null} />
              <Field k="Company" v={g.company} />
              <Field k="Chauffeur" v={g.chauffeur_name ? `${g.chauffeur_name} · ${g.chauffeur_phone || ""}` : null} />
            </div>
            {g.address && <div style={{ marginTop: 12 }}><Field k="Address" v={g.address} /></div>}
            {g.notes && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#FEF9C3",
                            borderRadius: 8, fontSize: 13, color: "#92400E" }}>
                <strong>Note:</strong> {g.notes}
              </div>
            )}
          </div>
          <button onClick={() => setEditing(true)} style={btn("ghost")}>Edit</button>
        </div>
      </div>

      {/* Lifetime stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 18 }}>
        {[
          ["Total Spend", money(stats.total_spend ?? stats.lifetime_spend), "#065F46", "#D1FAE5"],
          ["Hotel", money(stats.lifetime_spend), "#1565C0", "#EFF6FF"],
          ["Restaurant", money(stats.restaurant_spend ?? 0), "#B45309", "#FEF3C7"],
          ["Completed Stays", stats.completed_stays, "#6B21A8", "#F3E8FF"],
          ["Total Nights", stats.total_nights, "#0F766E", "#CCFBF1"],
          ["Cancelled", stats.cancelled, "#B91C1C", "#FEE2E2"],
        ].map(([k, v, fg, bg]) => (
          <div key={k} style={{ background: bg, borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 1 }}>{k}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: fg, marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      {stats.first_stay && (
        <div style={{ fontSize: 12, color: "#94A3B8", marginBottom: 18 }}>
          First stayed {dmy(stats.first_stay)} · most recently {dmy(stats.last_stay)}
        </div>
      )}

      {/* Tabs */}
      <div style={{ ...card, overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: "1px solid #E2E8F0", paddingLeft: 8 }}>
          <button onClick={() => setTab("stays")}      style={tabStyle("stays")}>Stays ({bookings.length})</button>
          <button onClick={() => setTab("restaurant")} style={tabStyle("restaurant")}>Restaurant ({restOrders.length})</button>
          <button onClick={() => setTab("charges")}    style={tabStyle("charges")}>Charge History ({charges.length})</button>
          <button onClick={() => setTab("spend")}      style={tabStyle("spend")}>Spend Breakdown</button>
        </div>

        {tab === "stays" && (
          bookings.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>No bookings yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#F8FAFC" }}>
                {["Ref", "Dates", "Rooms", "Plan", "Total", "Paid", "Status", ""].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {bookings.map(b => {
                  const st = STATUS_STYLE[b.status] || {};
                  return (
                    <tr key={b.booking_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={{ ...td, fontWeight: 700, color: "#1E293B" }}>{b.booking_ref}</td>
                      <td style={td}>{dmy(b.check_in_date)} → {dmy(b.check_out_date)}
                        <div style={{ fontSize: 11, color: "#94A3B8" }}>{b.nights} night(s)</div></td>
                      <td style={td}>{b.rooms_label || "—"}</td>
                      <td style={td}>{b.plan_name || "Room Only"}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#1E293B" }}>{money(b.grand_total)}</td>
                      <td style={{ ...td, color: "#059669" }}>{money(b.paid_total)}</td>
                      <td style={td}><span style={badge(st)}>{st.label || b.status}</span></td>
                      <td style={td}>
                        <button onClick={() => navigate(`/hotel/bookings/${b.booking_id}`)} style={btn("ghost")}>Open</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {tab === "restaurant" && (
          restOrders.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>
              No restaurant orders linked to this guest yet.
              <div style={{ fontSize: 12, marginTop: 6 }}>
                Orders charged to their room appear here automatically. Walk-in orders link
                once a customer record with the same phone or email is attached at the POS.
              </div>
            </div>
          ) : (
            <>
              {stats.favourites?.length > 0 && (
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #F1F5F9", background: "#FFFBEB" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 8 }}>
                    Usual order
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {stats.favourites.map(f => (
                      <span key={f.name} style={{ background: "#FEF3C7", color: "#92400E", padding: "4px 12px",
                                                  borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                        {f.name} <span style={{ opacity: 0.7 }}>×{f.qty}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "#F8FAFC" }}>
                  {["Date", "Order", "Where", "Items", "Amount"].map(h => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {restOrders.map(o => (
                    <tr key={o.or_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={td}>{dmy(o.or_date)}
                        <div style={{ fontSize: 11, color: "#94A3B8" }}>{o.or_time?.slice(0, 5)}</div>
                      </td>
                      <td style={{ ...td, fontWeight: 600, color: "#1E293B" }}>#{o.or_id}</td>
                      <td style={td}>
                        <span style={badge(o.via === "room"
                          ? { bg: "#DBEAFE", fg: "#1E40AF" }
                          : { bg: "#F1F5F9", fg: "#475569" })}>
                          {o.via === "room" ? "Charged to room" : "Walk-in"}
                        </span>
                        <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>
                          {(o.or_type || "").replace(/_/g, " ")}
                          {o.booking_ref ? ` · ${o.booking_ref}` : ""}
                        </div>
                      </td>
                      <td style={td}>
                        {o.items.length === 0 ? "—" : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {o.items.map((it, i) => (
                              <span key={i} style={{ fontSize: 12, color: "#475569" }}>
                                {it.pro_name || "Item"} <span style={{ color: "#94A3B8" }}>× {it.pro_quantity}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: "#1E293B" }}>{money(o.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#F8FAFC", borderTop: "2px solid #E2E8F0" }}>
                    <td colSpan={4} style={{ ...td, fontWeight: 700, color: "#1E293B", textAlign: "right" }}>
                      Restaurant total
                    </td>
                    <td style={{ ...td, fontWeight: 700, color: "#B45309" }}>{money(stats.restaurant_spend)}</td>
                  </tr>
                </tfoot>
              </table>
            </>
          )
        )}

        {tab === "charges" && (
          charges.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Nothing charged yet.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#F8FAFC" }}>
                {["Date", "Booking", "Type", "Description", "Amount"].map(h => <th key={h} style={th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {charges.map(c => (
                  <tr key={c.item_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                    <td style={td}>{dmy(c.item_date)}</td>
                    <td style={{ ...td, color: "#94A3B8" }}>{c.booking_ref}</td>
                    <td style={td}><span style={badge({ bg: "#F1F5F9", fg: "#475569" })}>{SOURCE_LABEL[c.source] || c.source}</span></td>
                    <td style={{ ...td, color: "#1E293B" }}>{c.description}</td>
                    <td style={{ ...td, fontWeight: 700, color: Number(c.amount) < 0 ? "#059669" : "#1E293B" }}>{money(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === "spend" && (
          <div style={{ padding: 24 }}>
            {Object.keys(stats.by_category || {}).length === 0 ? (
              <div style={{ textAlign: "center", color: "#94A3B8", padding: 20 }}>No spend recorded yet.</div>
            ) : Object.entries(stats.by_category)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => {
                  const max = Math.max(...Object.values(stats.by_category).map(Math.abs));
                  const pct = max ? (Math.abs(v) / max) * 100 : 0;
                  return (
                    <div key={k} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: "#475569" }}>{SOURCE_LABEL[k] || k}</span>
                        <span style={{ fontWeight: 700, color: "#1E293B" }}>{money(v)}</span>
                      </div>
                      <div style={{ background: "#F1F5F9", borderRadius: 4, height: 8, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "#1565C0", borderRadius: 4 }} />
                      </div>
                    </div>
                  );
                })}
          </div>
        )}
      </div>

      {editing && (
        <EditGuestModal guest={g} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }} />
      )}
    </AppShell>
  );
}

const EDITABLE = [
  ["full_name", "Full Name", "text"], ["phone", "Phone", "tel"], ["email", "Email", "email"],
  ["country", "Country", "text"], ["nationality", "Nationality", "text"],
  ["passport_nic", "Passport / NIC", "text"], ["date_of_birth", "Date of Birth", "date"],
  ["company", "Company", "text"], ["guest_status", "Guest Status", "text"],
  ["chauffeur_name", "Chauffeur Name", "text"], ["chauffeur_phone", "Chauffeur Phone", "tel"],
  ["next_destination", "Next Destination", "text"],
];

function EditGuestModal({ guest, onClose, onSaved }) {
  const [form, setForm] = useState(() =>
    EDITABLE.reduce((a, [k]) => ({
      ...a, [k]: k === "date_of_birth" && guest[k] ? String(guest[k]).slice(0, 10) : (guest[k] ?? ""),
    }), { address: guest.address ?? "", notes: guest.notes ?? "" })
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) { setErr("Full name is required"); return; }
    setBusy(true); setErr("");
    try { await updateGuest(guest.guest_id, form); onSaved(); }
    catch (ex) { setErr(ex?.response?.data?.message || "Could not save"); setBusy(false); }
  };

  return (
    <div style={modalWrap}><div style={modalBox(600)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1E293B" }}>Edit Guest</h2>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 19, color: "#94A3B8", cursor: "pointer" }}>✕</button>
      </div>
      {err && <div style={errorBox}>{err}</div>}
      <form onSubmit={submit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {EDITABLE.map(([k, l, t]) => (
            <label key={k} style={label}>{l}
              <input type={t} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                style={{ ...input, marginTop: 4 }} />
            </label>
          ))}
        </div>
        <label style={{ ...label, display: "block", marginTop: 12 }}>Address
          <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} rows={2}
            style={{ ...input, marginTop: 4, resize: "vertical" }} />
        </label>
        <label style={{ ...label, display: "block", marginTop: 12 }}>Notes / preferences
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            placeholder="Allergies, room preferences, anything staff should know"
            style={{ ...input, marginTop: 4, resize: "vertical" }} />
        </label>
        <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={{ ...btn("ghost"), flex: 1, padding: 11 }}>Cancel</button>
          <button type="submit" disabled={busy} style={{ ...btn("primary"), flex: 1, padding: 11 }}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div></div>
  );
}
