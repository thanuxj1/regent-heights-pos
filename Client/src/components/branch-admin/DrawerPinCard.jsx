import React, { useEffect, useState } from "react";
import { card, input, label, btn, errorBox } from "../../pages/hotel/ui";
import { getDrawerPin, setDrawerPin } from "../../services/api";

const digitsOnly = (v) => String(v || "").replace(/\D/g, "").slice(0, 8);

/**
 * The cash drawer's PIN — the manager's to set, change and look up.
 *
 * The till's Drawer button opens only with it: starting a shift, paying money
 * out, counting up at the end of the day. The manager gives it to the cashiers
 * they trust and changes it when someone leaves.
 */
export default function DrawerPinCard() {
  const [info, setInfo] = useState(null);
  const [shown, setShown] = useState(false);
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = async () => {
    try {
      setInfo(await getDrawerPin());
    } catch (e) {
      setError(e?.response?.data?.message || "Could not read the drawer PIN");
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
      await setDrawerPin(pin);
      setPin("");
      setAgain("");
      setShown(false);
      setSaved(true);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not save the PIN");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...card, maxWidth: 640, padding: 28, marginTop: 20 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#1E293B" }}>
        Cash drawer PIN
      </h2>
      <p style={{ margin: "0 0 18px", fontSize: 13, color: "#64748B", lineHeight: 1.6 }}>
        The till's <strong>Drawer</strong> button opens only with this PIN — to start a shift, pay
        money out, or count up at the end of the day. Only you can set, change or see it. Give it to
        the cashiers you trust, and change it when someone leaves.
      </p>

      {error && <div style={errorBox}>{error}</div>}

      {info && (
        <div style={{ marginBottom: 18, padding: "12px 14px", borderRadius: 10, background: "#F8FAFC", fontSize: 14, color: "#334155" }}>
          {!info.set ? (
            <span style={{ color: "#B45309", fontWeight: 600 }}>
              Not set yet — the drawer stays locked until you set one. Sales still go through.
            </span>
          ) : info.pin === null ? (
            <span style={{ color: "#B91C1C", fontWeight: 600 }}>
              A PIN is saved but can no longer be read (the server's key changed). Set a new one.
            </span>
          ) : (
            <>
              <span>Current PIN: </span>
              <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 17, letterSpacing: 4 }}>
                {shown ? info.pin : "•".repeat(info.pin.length)}
              </strong>
              <button type="button" onClick={() => setShown((s) => !s)}
                style={{ marginLeft: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid #CBD5E1",
                         background: "#fff", color: "#1565C0", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {shown ? "Hide" : "Show"}
              </button>
              <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 6 }}>
                Set {info.updated_at ? new Date(info.updated_at).toLocaleString() : ""}
                {info.updated_by ? ` by ${info.updated_by}` : ""}
              </div>
            </>
          )}
        </div>
      )}

      <form onSubmit={save}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...label, marginBottom: 6 }}>{info?.set ? "New PIN" : "PIN"}</label>
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
            {saving ? "Saving…" : info?.set ? "Change PIN" : "Set PIN"}
          </button>
          {saved && <span style={{ fontSize: 13, fontWeight: 600, color: "#059669" }}>Saved</span>}
        </div>
      </form>
    </div>
  );
}
