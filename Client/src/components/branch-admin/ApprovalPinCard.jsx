import React, { useEffect, useState } from "react";
import { card, input, label, btn, errorBox } from "../../pages/hotel/ui";
import { getSecurityOverview, setApprovalPin, clearApprovalPin } from "../../services/api";

const digitsOnly = (v) => String(v || "").replace(/\D/g, "").slice(0, 8);

/**
 * The manager approval PIN — a cashier's own discount/void screen asks for
 * this, typed by a manager on the cashier's screen rather than logging them
 * out and back in. Bcrypt-hashed like a password: unlike the drawer PIN,
 * once set it can never be read back here, only replaced or removed.
 */
export default function ApprovalPinCard() {
  const [info, setInfo] = useState(null);
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      setInfo(await getSecurityOverview());
    } catch (e) {
      setError(e?.response?.data?.message || "Could not read the approval PIN status");
    }
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    if (!/^\d{4,8}$/.test(pin)) { setError("The PIN is 4 to 8 digits."); return; }
    if (pin !== again) { setError("The two PINs are not the same."); return; }
    setSaving(true);
    try {
      await setApprovalPin(pin);
      setPin("");
      setAgain("");
      setSaved(true);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not save the PIN");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove your approval PIN? Cashiers will no longer be able to get a discount or void approved until you set a new one.")) return;
    setError("");
    setSaved(false);
    setRemoving(true);
    try {
      await clearApprovalPin();
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not remove the PIN");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div style={{ ...card, maxWidth: 640, padding: 28, marginTop: 20 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#1E293B" }}>
        Manager approval PIN
      </h2>
      <p style={{ margin: "0 0 18px", fontSize: 13, color: "#64748B", lineHeight: 1.6 }}>
        A cashier's till asks for this when they give a discount or void a paid sale — typed on their
        screen, so nobody has to log out. Once saved it can't be shown again here, only replaced.
      </p>

      {error && <div style={errorBox}>{error}</div>}

      {info && (
        <div style={{ marginBottom: 18, padding: "12px 14px", borderRadius: 10, background: "#F8FAFC", fontSize: 14, color: "#334155" }}>
          {info.your_pin_is_set ? (
            <span style={{ color: "#059669", fontWeight: 600 }}>PIN is set — you can approve a discount or void.</span>
          ) : (
            <span style={{ color: "#B45309", fontWeight: 600 }}>
              Not set yet.{" "}
              {info.managers_who_can_approve > 0
                ? "Another manager's PIN still covers discounts and voids."
                : "Until a manager sets one, cashiers can give discounts without approval, and a void has nobody who can approve it."}
            </span>
          )}
          <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>
            {info.managers_who_can_approve} manager{info.managers_who_can_approve === 1 ? "" : "s"} at this property can currently approve.
          </div>
        </div>
      )}

      <form onSubmit={save}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...label, marginBottom: 6 }}>{info?.your_pin_is_set ? "New PIN" : "PIN"}</label>
            <input style={input} type="password" inputMode="numeric" autoComplete="new-password"
              value={pin} onChange={(e) => setPin(digitsOnly(e.target.value))} placeholder="4 to 8 digits" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...label, marginBottom: 6 }}>Type it again</label>
            <input style={input} type="password" inputMode="numeric" autoComplete="new-password"
              value={again} onChange={(e) => setAgain(digitsOnly(e.target.value))} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button type="submit" disabled={saving || pin.length < 4}
            style={{ ...btn("primary"), opacity: saving || pin.length < 4 ? 0.6 : 1 }}>
            {saving ? "Saving…" : info?.your_pin_is_set ? "Change PIN" : "Set PIN"}
          </button>
          {info?.your_pin_is_set && (
            <button type="button" onClick={remove} disabled={removing}
              style={{ ...btn("ghost"), color: "#B91C1C", opacity: removing ? 0.6 : 1 }}>
              {removing ? "Removing…" : "Remove PIN"}
            </button>
          )}
          {saved && <span style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>Saved</span>}
        </div>
      </form>
    </div>
  );
}
