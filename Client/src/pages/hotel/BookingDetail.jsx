import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import {
  getBookingById, getBookingFolio, getRooms, checkInBooking, checkOutBooking,
  postFolioItem, deleteFolioItem, addBookingPayment, cancelBooking, getBookingConfirmation,
} from "../../services/api";
import {
  card, input, label, btn, badge, th, td,
  modalWrap, modalBox, errorBox, money, dmy, initials, STATUS_STYLE,
} from "./ui";
import { printElement } from "../../utils/printElement";
import { DOCUMENT_LOGO, hideIfMissing } from "../../brand";

const SOURCE_LABEL = {
  room: "Room", meal: "Meal Plan", restaurant: "Restaurant", bar: "Bar",
  laundry: "Laundry", minibar: "Minibar", tax: "Tax", discount: "Discount",
  payment: "Payment", late_checkout: "Late Check-Out", misc: "Other",
};

export default function BookingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [booking, setBooking] = useState(null);
  const [folio, setFolio] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const [assignments, setAssignments] = useState({});
  const folioRef = useRef(null);
  const printFolio = () =>
    printElement(folioRef.current, { title: `Folio ${booking?.booking_ref ?? ""}` });
  const [showCharge, setShowCharge]   = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  const load = useCallback(async () => {
    try {
      const b = await getBookingById(id);
      setBooking(b);
      if (["checked_in", "checked_out"].includes(b.status)) {
        try { setFolio(await getBookingFolio(id)); } catch { setFolio(null); }
      } else {
        setFolio(null);
      }
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load booking");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (branchId) getRooms({ b_id: branchId }).then(setRooms).catch(() => {});
  }, [branchId]);

  const run = async (name, fn) => {
    setBusy(name); setError("");
    try { await fn(); await load(); }
    catch (err) { setError(err?.response?.data?.message || `${name} failed`); }
    finally { setBusy(""); }
  };

  const doCheckIn = () => run("check-in", () => checkInBooking(id, {
    room_assignments: Object.entries(assignments).map(([booking_room_id, room_id]) => ({
      booking_room_id: Number(booking_room_id), room_id: Number(room_id),
    })),
  }));

  // A late fee the guest was never told about is a complaint at the desk, so it
  // is quoted and confirmed before it is charged — and can be waived instead.
  const doCheckOut = async (waiveLate = false) => {
    const late = folio?.late_checkout;
    if (!waiveLate && late?.amount > 0) {
      const ok = confirm(
        `${late.reason}.\n\nLate check-out fee: ${money(late.amount)}\n\n` +
        `OK = add it to the bill.\nCancel = go back (you can waive it instead).`
      );
      if (!ok) return;
    }
    const extra = waiveLate ? { waive_late_fee: true } : {};
    const balance = (folio?.balance_due ?? 0) + (waiveLate ? 0 : (late?.amount || 0));
    if (balance > 0.01) {
      const ok = confirm(
        `Outstanding balance is ${money(balance)}.\n\n` +
        `OK = record it as settled in cash now.\n` +
        `Cancel = go back and take payment separately.`
      );
      if (!ok) return;
      return run("check-out", () => checkOutBooking(id, { ...extra, settle_amount: balance, method: "cash" }));
    }
    return run("check-out", () => checkOutBooking(id, extra));
  };

  const openConfirmation = async () => {
    setError("");
    try {
      setConfirmation(await getBookingConfirmation(id));
      setShowConfirm(true);
    } catch (err) { setError(err?.response?.data?.message || "Could not build confirmation"); }
  };

  if (loading) {
    return (
      <AppShell title="Booking">
        <div style={{ textAlign: "center", padding: 60, color: "#94A3B8" }}>Loading…</div>
      </AppShell>
    );
  }
  if (!booking) {
    return (
      <AppShell title="Booking">
        <div style={errorBox}>{error || "Booking not found"}</div>
      </AppShell>
    );
  }

  const st = STATUS_STYLE[booking.status] || {};
  const balance = folio ? folio.balance_due : Number(booking.grand_total || 0) - Number(booking.paid_total || 0);
  const canCheckIn  = ["confirmed", "tentative"].includes(booking.status);
  const canCheckOut = booking.status === "checked_in";
  const freeRooms = (bookingRoom) => rooms.filter(r =>
    r.room_type_id === bookingRoom.room_type_id &&
    (!r.current_booking_id || r.current_booking_id === booking.booking_id)
  );

  return (
    <AppShell title={`Booking ${booking.booking_ref}`}>
          <button onClick={() => navigate("/hotel/bookings")} style={{ ...btn("ghost"), marginBottom: 16 }}>← All bookings</button>

          {error && <div style={errorBox}>{error}</div>}

          {/* Header card */}
          <div style={{ ...card, padding: 24, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#1565C0", color: "#fff",
                              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20, flexShrink: 0 }}>
                  {initials(booking.guest_name)}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, color: "#1E293B" }}>{booking.guest_name || "Guest"}</span>
                    <span style={badge(st)}>{st.label || booking.status}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>
                    {booking.guest_phone && <>📞 {booking.guest_phone} &nbsp;</>}
                    {booking.guest_email && <>✉️ {booking.guest_email} &nbsp;</>}
                    {booking.guest_country && <>🌍 {booking.guest_country}</>}
                  </div>
                  <div style={{ fontSize: 13, color: "#475569", marginTop: 6 }}>
                    <strong>{dmy(booking.check_in_date)}</strong> → <strong>{dmy(booking.check_out_date)}</strong>
                    <span style={{ color: "#94A3B8" }}> · {booking.nights} night(s) · {booking.adults} adult(s)
                      {booking.children ? `, ${booking.children} child(ren)` : ""}
                      {booking.plan_name ? ` · ${booking.plan_name}` : ""}</span>
                  </div>
                  {booking.special_requests && (
                    <div style={{ fontSize: 12, color: "#B45309", marginTop: 6, fontStyle: "italic" }}>
                      ★ {booking.special_requests}
                    </div>
                  )}
                  {booking.agent_name && (
                    <div style={{ fontSize: 12, color: "#6B21A8", marginTop: 4 }}>Referred by {booking.agent_name}</div>
                  )}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 1 }}>Balance Due</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: balance > 0.01 ? "#DC2626" : "#059669" }}>{money(balance)}</div>
                <div style={{ fontSize: 12, color: "#64748B" }}>of {money(folio ? folio.total_charges : booking.grand_total)}</div>
              </div>
            </div>

            {folio?.late_checkout?.late && !folio.late_checkout.already_charged && (
              <div style={{ marginTop: 18, padding: "12px 14px", borderRadius: 8,
                            background: folio.late_checkout.amount > 0 ? "#FFFBEB" : "#F8FAFC",
                            border: `1px solid ${folio.late_checkout.amount > 0 ? "#FDE68A" : "#E2E8F0"}`,
                            fontSize: 12.5, color: folio.late_checkout.amount > 0 ? "#92400E" : "#64748B", lineHeight: 1.6 }}>
                <strong>
                  {folio.late_checkout.hours_late > 0
                    ? `${folio.late_checkout.hours_late}h past check-out`
                    : `${folio.late_checkout.minutes_late} min past check-out`}
                </strong>
                {" "}(due out by {folio.late_checkout.pretty_time}). {folio.late_checkout.reason}.
                {folio.late_checkout.amount > 0 && (
                  <>
                    {" "}A fee of <strong>{money(folio.late_checkout.amount)}</strong> will be added at check-out.
                    <button onClick={() => doCheckOut(true)} disabled={busy === "check-out"}
                      style={{ ...btn("ghost"), marginLeft: 10, padding: "4px 10px", fontSize: 12 }}>
                      Waive &amp; check out
                    </button>
                  </>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
              <button onClick={openConfirmation} style={btn("ghost")}>📄 Confirmation</button>
              {canCheckIn && (
                <button onClick={doCheckIn} disabled={busy === "check-in"} style={btn("success")}>
                  {busy === "check-in" ? "Checking in…" : "✓ Check In"}
                </button>
              )}
              {canCheckOut && (
                <>
                  <button onClick={() => setShowCharge(true)} style={btn("ghost")}>+ Post Charge</button>
                  <button onClick={() => setShowPayment(true)} style={btn("ghost")}>+ Payment</button>
                  <button onClick={() => doCheckOut(false)} disabled={busy === "check-out"} style={btn("warn")}>
                    {busy === "check-out" ? "Checking out…" : "→ Check Out"}
                  </button>
                </>
              )}
              {["confirmed", "tentative"].includes(booking.status) && (
                <button
                  onClick={() => {
                    const reason = prompt("Cancellation reason (optional):");
                    if (reason !== null) run("cancel", () => cancelBooking(id, reason));
                  }}
                  style={btn("danger")}>Cancel Booking</button>
              )}
            </div>
          </div>

          {/* Room assignment (pre check-in) */}
          {canCheckIn && (
            <div style={{ ...card, padding: 20, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#1E293B", marginBottom: 12 }}>Room Assignment</div>
              {(booking.rooms || []).map(br => (
                <div key={br.booking_room_id} style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12,
                                                       alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 13, color: "#475569" }}>
                    <strong>{br.type_name}</strong> · {money(br.rate_per_night)}/night
                    {br.room_number && <span style={{ color: "#059669" }}> — assigned Room {br.room_number}</span>}
                  </div>
                  <select
                    value={assignments[br.booking_room_id] ?? br.room_id ?? ""}
                    onChange={e => setAssignments(a => ({ ...a, [br.booking_room_id]: e.target.value }))}
                    style={input}>
                    <option value="">Select room…</option>
                    {freeRooms(br).map(r => (
                      <option key={r.room_id} value={r.room_id}>
                        Room {r.room_number}{r.floor ? ` · Floor ${r.floor}` : ""} · {r.hk_status}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 8 }}>
                Every room must be assigned before check-in. Charges post to the folio automatically at check-in.
              </div>
            </div>
          )}

          {/* Folio */}
          {folio && (
            <div ref={folioRef} style={{ ...card, overflow: "hidden", marginBottom: 20 }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  {/* Print-only: the paper bill needs the property's letterhead. */}
                  <img className="print-only" src={DOCUMENT_LOGO} alt="" onError={hideIfMissing}
                    style={{ display: "none", maxHeight: 54, maxWidth: 210, objectFit: "contain", marginBottom: 8 }} />
                  <span style={{ fontWeight: 700, fontSize: 14, color: "#1E293B" }}>
                    Guest Folio <span style={{ color: "#94A3B8", fontWeight: 400 }}>#{folio.folio_id} · {folio.status}</span>
                  </span>
                  {/* Only shows on paper, so the guest's copy identifies itself. */}
                  <div className="print-only" style={{ display: "none", fontSize: 12, color: "#475569", marginTop: 4 }}>
                    {booking.guest_name} · {booking.booking_ref} · {dmy(booking.check_in_date)} → {dmy(booking.check_out_date)}
                  </div>
                </div>
                <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 12, color: "#94A3B8" }}>
                    Restaurant orders charged to this room appear here automatically
                  </span>
                  <button onClick={printFolio} style={btn("ghost")}>Print Bill</button>
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "#F8FAFC" }}>
                  {["Date", "Type", "Description", "Qty", "Unit", "Amount", ""].map(h => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {folio.items.map(i => (
                    <tr key={i.item_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={td}>{dmy(i.item_date)}</td>
                      <td style={td}><span style={badge({ bg: "#F1F5F9", fg: "#475569" })}>{SOURCE_LABEL[i.source] || i.source}</span></td>
                      <td style={{ ...td, color: "#1E293B" }}>{i.description}</td>
                      <td style={td}>{Number(i.qty)}</td>
                      <td style={td}>{money(i.unit_price)}</td>
                      <td style={{ ...td, fontWeight: 700, color: Number(i.amount) < 0 ? "#059669" : "#1E293B" }}>{money(i.amount)}</td>
                      <td style={td}>
                        {folio.status === "open" && (
                          <button onClick={() => run("delete", () => deleteFolioItem(id, i.item_id))} style={btn("danger")}>Del</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: "#F8FAFC", borderTop: "2px solid #E2E8F0" }}>
                    <td colSpan={5} style={{ ...td, fontWeight: 700, color: "#1E293B", textAlign: "right" }}>Total Charges</td>
                    <td style={{ ...td, fontWeight: 700, color: "#1E293B" }}>{money(folio.total_charges)}</td><td />
                  </tr>
                  <tr style={{ background: "#F8FAFC" }}>
                    <td colSpan={5} style={{ ...td, textAlign: "right" }}>Total Paid</td>
                    <td style={{ ...td, color: "#059669", fontWeight: 600 }}>{money(folio.total_paid)}</td><td />
                  </tr>
                  <tr style={{ background: "#F8FAFC", borderTop: "2px solid #CBD5E1" }}>
                    <td colSpan={5} style={{ ...td, fontWeight: 700, color: "#1E293B", textAlign: "right", fontSize: 15 }}>Balance Due</td>
                    <td style={{ ...td, fontWeight: 700, fontSize: 15, color: folio.balance_due > 0.01 ? "#DC2626" : "#059669" }}>
                      {money(folio.balance_due)}
                    </td><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Payments */}
          {(booking.payments || []).length > 0 && (
            <div style={{ ...card, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #F1F5F9", fontWeight: 700, fontSize: 14, color: "#1E293B" }}>
                Payments
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "#F8FAFC" }}>
                  {["Date", "Kind", "Method", "Reference", "Amount"].map(h => <th key={h} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {booking.payments.map(p => (
                    <tr key={p.bp_id} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={td}>{dmy(p.paid_at)}</td>
                      <td style={td}>{p.kind}</td>
                      <td style={td}>{p.method}</td>
                      <td style={td}>{p.reference || "—"}</td>
                      <td style={{ ...td, fontWeight: 700, color: p.kind === "refund" ? "#DC2626" : "#059669" }}>
                        {p.kind === "refund" ? "-" : ""}{money(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      {showCharge   && <ChargeModal  onClose={() => setShowCharge(false)}  onSave={async (p) => { await postFolioItem(id, p); setShowCharge(false); load(); }} />}
      {showPayment  && <PaymentModal balance={balance} onClose={() => setShowPayment(false)} onSave={async (p) => { await addBookingPayment(id, p); setShowPayment(false); load(); }} />}
      {showConfirm && confirmation && <ConfirmationModal data={confirmation} onClose={() => setShowConfirm(false)} />}
    </AppShell>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

function ChargeModal({ onClose, onSave }) {
  const [form, setForm] = useState({ source: "misc", description: "", qty: 1, unit_price: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!form.description.trim()) { setErr("Description is required"); return; }
    setBusy(true);
    try { await onSave({ ...form, qty: Number(form.qty), unit_price: Number(form.unit_price) }); }
    catch (ex) { setErr(ex?.response?.data?.message || "Could not post charge"); setBusy(false); }
  };

  return (
    <div style={modalWrap}><div style={modalBox(420)}>
      <h2 style={{ margin: "0 0 18px", fontSize: 18, fontWeight: 700, color: "#1E293B" }}>Post Charge to Folio</h2>
      {err && <div style={errorBox}>{err}</div>}
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={label}>Type
          <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} style={{ ...input, marginTop: 4 }}>
            {["misc", "laundry", "minibar", "bar", "restaurant", "room"].map(s =>
              <option key={s} value={s}>{SOURCE_LABEL[s] || s}</option>)}
          </select>
        </label>
        <label style={label}>Description *
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="e.g. Laundry — 3 shirts" style={{ ...input, marginTop: 4 }} />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={label}>Qty
            <input type="number" min={1} value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} style={{ ...input, marginTop: 4 }} />
          </label>
          <label style={label}>Unit Price
            <input type="number" min={0} step="0.01" value={form.unit_price}
              onChange={e => setForm(f => ({ ...f, unit_price: e.target.value }))} style={{ ...input, marginTop: 4 }} />
          </label>
        </div>
        <div style={{ fontSize: 13, color: "#64748B" }}>
          Amount: <strong style={{ color: "#1E293B" }}>{money(Number(form.qty || 0) * Number(form.unit_price || 0))}</strong>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" onClick={onClose} style={{ ...btn("ghost"), flex: 1, padding: 11 }}>Cancel</button>
          <button type="submit" disabled={busy} style={{ ...btn("primary"), flex: 1, padding: 11 }}>
            {busy ? "Posting…" : "Post Charge"}
          </button>
        </div>
      </form>
    </div></div>
  );
}

function PaymentModal({ balance, onClose, onSave }) {
  const [form, setForm] = useState({ amount: balance > 0 ? balance.toFixed(2) : "", method: "cash", kind: "settlement", reference: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!(Number(form.amount) > 0)) { setErr("Amount must be greater than zero"); return; }
    setBusy(true);
    try { await onSave({ ...form, amount: Number(form.amount) }); }
    catch (ex) { setErr(ex?.response?.data?.message || "Could not record payment"); setBusy(false); }
  };

  return (
    <div style={modalWrap}><div style={modalBox(400)}>
      <h2 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: "#1E293B" }}>Record Payment</h2>
      <div style={{ fontSize: 13, color: "#64748B", marginBottom: 18 }}>Outstanding balance: <strong>{money(balance)}</strong></div>
      {err && <div style={errorBox}>{err}</div>}
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={label}>Amount *
          <input type="number" min={0.01} step="0.01" value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} style={{ ...input, marginTop: 4 }} />
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label style={label}>Method
            <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))} style={{ ...input, marginTop: 4 }}>
              {["cash", "card", "bank_transfer", "online", "voucher"].map(m => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <label style={label}>Kind
            <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))} style={{ ...input, marginTop: 4 }}>
              {["advance", "settlement", "refund"].map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
        </div>
        <label style={label}>Reference
          <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
            placeholder="Receipt / transaction no." style={{ ...input, marginTop: 4 }} />
        </label>
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" onClick={onClose} style={{ ...btn("ghost"), flex: 1, padding: 11 }}>Cancel</button>
          <button type="submit" disabled={busy} style={{ ...btn("success"), flex: 1, padding: 11 }}>
            {busy ? "Saving…" : "Record Payment"}
          </button>
        </div>
      </form>
    </div></div>
  );
}

function ConfirmationModal({ data, onClose }) {
  const [copied, setCopied] = useState(false);
  const b = data.booking;
  const hotel = data.hotel || {};
  // The property's own house times, not a number baked into this file.
  const inTime  = data.policy?.check_in_pretty  || "2:00 PM";
  const outTime = data.policy?.check_out_pretty || "11:00 AM";
  const cancelLine = data.policy?.cancellation_line
    || "Free cancellation up to 48 hours before arrival; otherwise a 1 night stay charge applies.";
  const paid = Number(b.paid_total || 0);
  const docRef = useRef(null);

  const copy = async () => {
    try { await navigator.clipboard.writeText(data.whatsapp_text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard blocked */ }
  };

  const L = ({ k, v }) => (
    <div style={{ display: "flex", gap: 8, fontSize: 12, padding: "2px 0" }}>
      <span style={{ color: "#64748B", minWidth: 108 }}>{k}</span>
      <span style={{ color: "#1E293B", fontWeight: 600 }}>{v || "—"}</span>
    </div>
  );
  const Money = ({ k, v, strong, red }) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12,
                  padding: strong ? "6px 0" : "3px 0",
                  borderTop: strong ? "1px solid #CBD5E1" : "none",
                  fontWeight: strong ? 700 : 400 }}>
      <span style={{ color: strong ? "#1E293B" : "#64748B" }}>{k}</span>
      <span style={{ color: red ? "#B91C1C" : "#1E293B", fontWeight: strong ? 700 : 600 }}>{money(v)}</span>
    </div>
  );

  return (
    <div style={modalWrap} className="print-root">
      <div style={modalBox(720)} className="print-area">

        <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#1E293B" }}>Booking Confirmation</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#94A3B8", cursor: "pointer" }}>✕</button>
        </div>

        {/* The printed document. Mirrors the property's paper confirmation. */}
        <div ref={docRef} style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: 24, color: "#1E293B" }}>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                        borderBottom: "2px solid #1E293B", paddingBottom: 10, marginBottom: 16 }}>
            <div>
              {/* The property's own mark, not the POS product logo. */}
              <img src={DOCUMENT_LOGO} alt="" onError={hideIfMissing}
                style={{ maxHeight: 62, maxWidth: 230, objectFit: "contain", marginBottom: 8, display: "block" }} />
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.3 }}>
                {(hotel.B_name || "Hotel").toUpperCase()}
              </div>
              <div style={{ fontSize: 10, color: "#64748B", marginTop: 3, lineHeight: 1.5 }}>
                {hotel.B_address || ""}
                {hotel.B_email ? <><br />{hotel.B_email}</> : null}
                {hotel.B_conNo ? ` | Phone: ${hotel.B_conNo}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>BOOKING CONFIRMATION</div>
              <div style={{ fontSize: 11, marginTop: 6 }}>
                <strong>Booking Ref:</strong> {b.booking_ref}
              </div>
              <div style={{ fontSize: 11 }}>
                <strong>Booking Date:</strong> {dmy(b.created_at)}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
            Dear {b.guest_name || "Guest"},<br />
            Thank you for choosing {hotel.B_name || "us"}. We are pleased to inform you that your
            reservation is <strong>CONFIRMED</strong> and your details are as follows:
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>RESERVATION DETAILS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px", marginBottom: 16 }}>
            <div>
              <L k="Guest Name" v={b.guest_name} />
              <L k="Country / Region" v={b.guest_country} />
              <L k="Email" v={b.guest_email} />
              <L k="Arrival Time" v={b.arrival_time?.slice(0, 5)} />
              <L k="Special Request" v={b.special_requests} />
            </div>
            <div>
              <L k="Check-In Date" v={dmy(b.check_in_date)} />
              <L k="Check-Out Date" v={dmy(b.check_out_date)} />
              <L k="No. of Nights" v={b.nights} />
              <L k="Check-In Time" v={inTime} />
              <L k="Check-Out Time" v={outTime} />
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>ROOM DETAILS</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginBottom: 16 }}>
            <thead>
              <tr style={{ background: "#F1F5F9" }}>
                {["Room Type", "Pax", "Rooms", "Package / Plan", "Promotion", "Rate (LKR)"].map(h => (
                  <th key={h} style={{ padding: "6px 8px", textAlign: h === "Rate (LKR)" ? "right" : "left",
                                       fontWeight: 700, border: "1px solid #E2E8F0" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(b.rooms || []).map(r => (
                <tr key={r.booking_room_id}>
                  <td style={{ padding: "6px 8px", border: "1px solid #E2E8F0" }}>
                    {r.type_name}{r.room_number ? ` (Room ${r.room_number})` : ""}
                  </td>
                  <td style={{ padding: "6px 8px", border: "1px solid #E2E8F0" }}>
                    {b.adults} Adult{b.adults === 1 ? "" : "s"}{b.children ? `, ${b.children} Child` : ""}
                  </td>
                  <td style={{ padding: "6px 8px", border: "1px solid #E2E8F0" }}>1</td>
                  <td style={{ padding: "6px 8px", border: "1px solid #E2E8F0" }}>{b.plan_name || "Room Only"}</td>
                  <td style={{ padding: "6px 8px", border: "1px solid #E2E8F0" }}>{b.promotion || "None"}</td>
                  <td style={{ padding: "6px 8px", border: "1px solid #E2E8F0", textAlign: "right" }}>
                    {money(r.rate_per_night)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
            <div style={{ border: "2px solid #1E293B", padding: "16px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>TOTAL AMOUNT DUE</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
                {money(Number(b.grand_total) - paid)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>
                RATE DETAILS BREAKDOWN
              </div>
              <Money k="Total Room Charges" v={b.room_charges} />
              <Money k={`Room Charges Tax (${b.tax_pct}%)`} v={b.tax_amount} />
              <Money k="Inclusions Including Tax" v={b.meal_charges} />
              <Money k="Extra Charges" v={b.extra_charges} />
              {Number(b.discount) > 0 && <Money k="Discount" v={-Number(b.discount)} red />}
              <Money k="Grand Total" v={b.grand_total} strong />
              <Money k="Total Paid" v={paid} />
              <Money k="Amount Due at Check-In" v={Number(b.grand_total) - paid} strong red />
            </div>
          </div>

          <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 5 }}>Terms &amp; Conditions / Stay Policies</div>
            <ol style={{ fontSize: 10, color: "#475569", lineHeight: 1.7, paddingLeft: 16, margin: 0 }}>
              <li>Standard check-in time is {inTime} and check-out time is {outTime}.</li>
              <li>Please present a printed copy of this confirmation voucher along with a valid ID card or Passport upon arrival.</li>
              <li>Cancellation policy: {cancelLine}</li>
              <li>All rates are inclusive of local service fees and government taxes unless indicated otherwise.</li>
            </ol>
          </div>
        </div>

        {!b.guest_phone && (
          <div className="no-print" style={{ ...errorBox, background: "#FEF9C3", borderColor: "#FDE68A", color: "#92400E", marginTop: 16, marginBottom: 0 }}>
            This guest has no phone number saved, so WhatsApp can't be opened. Add one to the guest profile, or copy the text and send it manually.
          </div>
        )}

        <div className="no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <button onClick={copy} style={{ ...btn("ghost"), flex: 1 }}>{copied ? "✓ Copied" : "Copy Text"}</button>
          <button
            onClick={() => printElement(docRef.current, { title: `Confirmation ${b.booking_ref}` })}
            style={{ ...btn("ghost"), flex: 1 }}>Print</button>
          <a
            href={data.whatsapp_url || undefined}
            target="_blank"
            rel="noreferrer"
            onClick={e => { if (!data.whatsapp_url) e.preventDefault(); }}
            style={{
              ...btn("success"), flex: 2, textAlign: "center", textDecoration: "none",
              display: "inline-block", opacity: data.whatsapp_url ? 1 : 0.5,
              cursor: data.whatsapp_url ? "pointer" : "not-allowed",
            }}>
            Send on WhatsApp
          </a>
        </div>
        <div className="no-print" style={{ fontSize: 11, color: "#94A3B8", marginTop: 10, textAlign: "center" }}>
          Print gives the guest this voucher. WhatsApp sends the same details as a message.
        </div>
      </div>
    </div>
  );
}
