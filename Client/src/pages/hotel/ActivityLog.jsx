import React, { useEffect, useMemo, useState } from "react";
import AppShell from "../../components/AppShell";
import { useAuth } from "../../context/AuthContext";
import { getActivity, getActivitySummary } from "../../services/api";
import { card, input, btn, badge, errorBox, initials, ymd, today, addDays } from "./ui";

const ACTION = {
  login:         { label: "Signed in",     bg: "#DBEAFE", fg: "#1E40AF", icon: "→" },
  logout:        { label: "Signed out",    bg: "#F1F5F9", fg: "#475569", icon: "←" },
  login_failed:  { label: "Sign-in failed", bg: "#FEF3C7", fg: "#92400E", icon: "!" },
  login_blocked: { label: "Sign-in blocked", bg: "#FEE2E2", fg: "#B91C1C", icon: "⛔" },
  create:    { label: "Created",     bg: "#D1FAE5", fg: "#065F46", icon: "+" },
  update:    { label: "Updated",     bg: "#FEF3C7", fg: "#92400E", icon: "✎" },
  delete:    { label: "Deleted",     bg: "#FEE2E2", fg: "#B91C1C", icon: "✕" },
  check_in:  { label: "Checked in",  bg: "#CCFBF1", fg: "#0F766E", icon: "⇥" },
  check_out: { label: "Checked out", bg: "#E9D5FF", fg: "#6B21A8", icon: "⇤" },
  // Money leaving the till and money coming in — the two an owner looks for first.
  void:      { label: "Voided sale", bg: "#FEE2E2", fg: "#B91C1C", icon: "⊘" },
  payment:   { label: "Payment",     bg: "#D1FAE5", fg: "#065F46", icon: "₨" },
};

const ENTITY_LABEL = {
  auth: "Account", booking: "Booking", room: "Room", room_type: "Room Type",
  expense: "Expense", product: "Product", order: "Order", user: "Staff", guest: "Guest",
  payment: "Payment", folio_item: "Room Bill", category: "Menu Category",
  commission_agent: "Agent", policy: "Policy",
  hotel_profile: "Property", login_location: "Sign-in Location",
};

const ROLE = { 1: "Branch Admin", 2: "Admin", 3: "Cashier", 6: "Super Admin", 8: "Waiter", 9: "Kitchen" };

/** "3 minutes ago" — the feed reads better than raw timestamps. */
function ago(iso) {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const stamp = (iso) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

export default function ActivityLog() {
  const { user } = useAuth();
  const branchId = user?.b_id ?? user?.B_id ?? null;

  const [entries, setEntries] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(ymd(addDays(new Date(), -29)));
  const [to, setTo] = useState(today());
  const [expanded, setExpanded] = useState(null);

  const query = useMemo(() => ({
    b_id: branchId, from, to,
    ...(action ? { action } : {}),
    ...(entity ? { entity } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  }), [branchId, from, to, action, entity, search]);

  const load = async () => {
    if (!branchId) return;
    setLoading(true); setError("");
    try {
      const [a, s] = await Promise.all([
        getActivity(query),
        getActivitySummary({ b_id: branchId, days: 7 }),
      ]);
      setEntries(a.entries); setCursor(a.next_cursor); setSummary(s);
    } catch (e) {
      setError(e?.response?.data?.message || "Could not load the activity log");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [branchId, from, to, action, entity]);

  // Debounce free-text search so each keystroke isn't a request.
  useEffect(() => {
    if (!branchId) return;
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [search]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const a = await getActivity({ ...query, cursor });
      setEntries((prev) => [...prev, ...a.entries]);
      setCursor(a.next_cursor);
    } catch { setError("Could not load more entries"); }
    finally { setLoadingMore(false); }
  };

  // Group by calendar day for the feed headers.
  const grouped = useMemo(() => {
    const out = [];
    let lastDay = null;
    entries.forEach((e) => {
      const day = new Date(e.created_at).toDateString();
      if (day !== lastDay) { out.push({ header: day, iso: e.created_at }); lastDay = day; }
      out.push({ entry: e });
    });
    return out;
  }, [entries]);

  const dayLabel = (iso) => {
    const d = new Date(iso).toDateString();
    if (d === new Date().toDateString()) return "Today";
    if (d === new Date(Date.now() - 86400000).toDateString()) return "Yesterday";
    return new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  };

  return (
    <AppShell title="Activity Log">
      {error && <div style={errorBox}>{error}</div>}

      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 20 }}>
          <div style={{ background: "#EFF6FF", borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 1 }}>
              Last 7 days
            </div>
            <div style={{ fontSize: 21, fontWeight: 700, color: "#1565C0", marginTop: 4 }}>{summary.total}</div>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>actions recorded</div>
          </div>
          {summary.by_action.slice(0, 4).map((a) => {
            const s = ACTION[a.action] || {};
            return (
              <div key={a.action} style={{ background: s.bg || "#F1F5F9", borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: 1 }}>
                  {s.label || a.action}
                </div>
                <div style={{ fontSize: 21, fontWeight: 700, color: s.fg || "#475569", marginTop: 4 }}>{a.n}</div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by what happened or who did it…" style={{ ...input, width: 300 }} />
        <select value={action} onChange={(e) => setAction(e.target.value)} style={{ ...input, width: 150 }}>
          <option value="">All actions</option>
          {Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ ...input, width: 150 }}>
          <option value="">Everything</option>
          {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ ...input, width: 145 }} />
        <span style={{ color: "#94A3B8" }}>→</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ ...input, width: 145 }} />
      </div>

      <div style={{ ...card, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: "center", color: "#94A3B8" }}>Loading activity…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "#94A3B8" }}>
            Nothing recorded for these filters.
            <div style={{ fontSize: 12, marginTop: 6 }}>
              The log starts from when it was switched on — earlier actions aren't in it.
            </div>
          </div>
        ) : (
          <>
            {grouped.map((g, i) =>
              g.header ? (
                <div key={`h-${i}`} style={{ padding: "10px 20px", background: "#F8FAFC",
                                             borderTop: i ? "1px solid #E2E8F0" : "none",
                                             borderBottom: "1px solid #E2E8F0",
                                             fontSize: 12, fontWeight: 700, color: "#475569" }}>
                  {dayLabel(g.iso)}
                </div>
              ) : (() => {
                const e = g.entry;
                const s = ACTION[e.action] || { bg: "#F1F5F9", fg: "#475569", icon: "•", label: e.action };
                const open = expanded === e.log_id;
                return (
                  <div key={e.log_id}
                    onClick={() => setExpanded(open ? null : e.log_id)}
                    style={{ display: "flex", gap: 14, padding: "14px 20px",
                             borderBottom: "1px solid #F8FAFC", cursor: "pointer",
                             background: open ? "#FAFBFC" : "#fff" }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                                  background: s.bg, color: s.fg, display: "flex",
                                  alignItems: "center", justifyContent: "center",
                                  fontWeight: 700, fontSize: 14 }}>
                      {s.icon}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: "#1E293B" }}>
                        <strong>{e.actor_name || "Someone"}</strong>{" "}
                        <span style={{ color: "#475569" }}>{e.summary}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                        <span style={badge(s)}>{s.label}</span>
                        <span style={badge({ bg: "#F1F5F9", fg: "#64748B" })}>
                          {ENTITY_LABEL[e.entity] || e.entity}
                        </span>
                        {e.role_id != null && (
                          <span style={{ fontSize: 11, color: "#94A3B8" }}>{ROLE[e.role_id] || `Role ${e.role_id}`}</span>
                        )}
                        <span style={{ fontSize: 11, color: "#94A3B8" }}>· {ago(e.created_at)}</span>
                      </div>

                      {open && (
                        <div style={{ marginTop: 10, padding: 12, background: "#F8FAFC",
                                      borderRadius: 8, fontSize: 12, color: "#475569" }}>
                          <div><strong>When:</strong> {stamp(e.created_at)}</div>
                          {e.entity_id && <div><strong>Record:</strong> {ENTITY_LABEL[e.entity] || e.entity} #{e.entity_id}</div>}
                          {e.ip_address && <div><strong>From:</strong> {e.ip_address}</div>}
                          {e.details && (
                            <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word",
                                          fontSize: 11, color: "#64748B" }}>
                              {JSON.stringify(e.details, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>

                    <div style={{ fontSize: 11, color: "#CBD5E1", whiteSpace: "nowrap", flexShrink: 0 }}>
                      {new Date(e.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                );
              })()
            )}

            {cursor && (
              <div style={{ padding: 16, textAlign: "center" }}>
                <button onClick={loadMore} disabled={loadingMore} style={btn("ghost")}>
                  {loadingMore ? "Loading…" : "Load older activity"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
