import React from "react";
import { printTestKot } from "../../utils/printKot";

/**
 * Where this device prints kitchen tickets (KOTs), and a way to check it.
 *
 * Used by both screens that print a ticket, because the two halves of the setup
 * live on different PCs: the till downstairs decides whether it prints its own
 * copy, and the kitchen screen on the PC upstairs — the one the kitchen printer
 * is plugged into — decides whether it prints every order as it arrives.
 *
 * A web page cannot pick a physical printer; the browser prints on whatever the
 * print window (or, with `--kiosk-printing`, the PC's default printer) points
 * at. So this screen does not pretend to offer a printer list. It offers the
 * thing that actually decides where paper comes out — which screen prints — and
 * a test ticket, so the upstairs printer can be proven before anything is
 * switched off downstairs.
 *
 * @param {"till"|"kitchen"} mode
 * @param {boolean}          enabled   the switch for this device
 * @param {(on:boolean)=>void} onToggle
 */

const box = {
  position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center",
  background: "rgba(15,23,42,0.45)", padding: 16,
};
const card = {
  width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto",
  background: "#fff", borderRadius: 16, padding: 24,
  boxShadow: "0 20px 60px rgba(15,23,42,0.25)", color: "#0F172A",
};
const btn = (kind) => ({
  padding: "11px 16px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer",
  border: kind === "ghost" ? "1px solid #CBD5E1" : "none",
  background: kind === "ghost" ? "#fff" : "#0A5BAE",
  color: kind === "ghost" ? "#475569" : "#fff",
});
const muted = { fontSize: 13, color: "#64748B", lineHeight: 1.55, margin: 0 };
const section = { marginTop: 18, paddingTop: 16, borderTop: "1px solid #E2E8F0" };

const COPY = {
  till: {
    title: "KOT printing — this till",
    intro:
      "When you send an order to the kitchen, this till can print its own copy of the ticket. " +
      "The kitchen screen upstairs prints its copy separately, on the printer connected to that PC.",
    switchLabel: "Print a KOT at this till when an order is sent",
    switchHint:
      "Keep this on until the upstairs screen has printed a test ticket and a real order. " +
      "Then switch it off here if you only want the ticket upstairs.",
    where: "Printed at the till",
  },
  kitchen: {
    title: "KOT printing — this screen",
    intro:
      "This screen prints a ticket for every order that arrives, on the printer connected to this PC. " +
      "Leave it open on the PC that has the upstairs kitchen printer.",
    switchLabel: "Print tickets on this screen as orders arrive",
    switchHint: "Only switch this on for the screen whose PC has the kitchen printer — every screen with it on prints.",
    where: "Printed at the kitchen screen",
  },
};

function Switch({ on, onChange, label, hint }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        style={{
          flexShrink: 0, width: 46, height: 26, borderRadius: 13, border: "none", cursor: "pointer",
          background: on ? "#16A34A" : "#CBD5E1", position: "relative", transition: "background 0.15s",
        }}
      >
        <span style={{
          position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: "50%",
          background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        }} />
      </button>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{label}: {on ? "On" : "Off"}</div>
        <p style={{ ...muted, marginTop: 3 }}>{hint}</p>
      </div>
    </div>
  );
}

export default function KotPrintingModal({ mode = "till", enabled, onToggle, branchName = "", staffName = "", onClose }) {
  const copy = COPY[mode] ?? COPY.till;

  return (
    <div style={box} onClick={onClose} role="dialog" aria-modal="true" aria-label={copy.title}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: 20 }}>{copy.title}</h2>
        <p style={{ ...muted, marginTop: 8 }}>{copy.intro}</p>

        <div style={section}>
          <Switch on={enabled} onChange={onToggle} label={copy.switchLabel} hint={copy.switchHint} />
        </div>

        <div style={section}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Check the printer</div>
          <p style={{ ...muted, marginTop: 4 }}>
            Prints a sample ticket marked TEST. A print window opens — choose the printer there.
            If the ticket comes out of the right printer, this is set up correctly.
          </p>
          <button
            type="button"
            style={{ ...btn("primary"), marginTop: 10 }}
            onClick={() => printTestKot({ branchName, staffName, where: copy.where })}
          >
            Print a test ticket
          </button>
        </div>

        <details style={section} open={mode === "kitchen"}>
          <summary style={{ fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Setting up the printer upstairs
          </summary>
          <p style={{ ...muted, marginTop: 8 }}>
            A web page cannot choose a printer itself — tickets come out of the printer chosen in the
            print window, or of this PC&rsquo;s default printer if you skip the window. Do this on the
            <b> PC upstairs</b>:
          </p>
          <ol style={{ ...muted, paddingLeft: 20, marginTop: 8 }}>
            <li>Connect the printer to that PC and print a Windows test page, to be sure it works.</li>
            <li>
              Make it that PC&rsquo;s <b>default printer</b> (Settings &rarr; Printers &amp; scanners &rarr; the
              printer &rarr; Set as default).
            </li>
            <li>
              To print <b>without the print window</b> every time: close Chrome, right-click its shortcut
              &rarr; Properties, and add <code>--kiosk-printing</code> at the end of the Target box (after a
              space). Open Chrome from that shortcut from now on.
            </li>
            <li>Sign in on that PC, open <b>Kitchen Orders</b>, and leave auto-print switched on.</li>
          </ol>
        </details>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button type="button" style={btn("ghost")} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
