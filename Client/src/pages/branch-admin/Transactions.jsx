import React, { useEffect, useMemo, useState } from "react";
import Header from "../../components/branch-admin/Header";
import Sidebar from "../../components/branch-admin/Sidebar";
import TransactionFilters from "../../components/branch-admin/TransactionFilters";
import TransactionTable from "../../components/admin/TransactionTable";
import TransactionDetailsModal from "../../components/admin/TransactionDetailsModal";
import { getBranchById, getReportTransactions } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { dayKey } from "../../utils/dates";

// The report endpoint's `type` string sorts a row into one of the ledger's
// five kinds. Doing it here, once, is what lets the table and the details
// modal stay generic instead of each re-deriving it their own way.
function ledgerType(reportType) {
  if (reportType === "Hotel payment") return "hotel";
  if (reportType.startsWith("Restaurant")) return "sale";
  if (reportType.startsWith("Expense")) return "expense";
  if (reportType.startsWith("Commission")) return "commission";
  if (reportType === "Supplier payment") return "purchase";
  return "other";
}

export default function Transactions() {
  const [filters, setFilters] = useState({
    search: "",
    method: "all",
    dateFrom: null,
    dateTo: null,
    tab: "all",
  });

  const { user } = useAuth();
  const branchFromUser = user?.b_id ?? user?.B_id ?? user?.branchId ?? null;

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [pageSize] = useState(10);
  const [branchName, setBranchName] = useState(null);

  useEffect(() => {
    if (!branchFromUser) return;
    getBranchById(branchFromUser)
      .then((b) => setBranchName(b?.B_name ?? b?.data?.B_name ?? null))
      .catch(() => {});
  }, [branchFromUser]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        if (!branchFromUser) { setTransactions([]); return; }

        // One source for every kind of money movement — sales, supplier
        // payments, hotel payments, expenses and agent commissions — so this
        // ledger can't drift out of sync with what Reports/Accounting count.
        // It used to reassemble the same picture from four separate raw
        // endpoints, and left out expenses and commissions entirely because
        // nothing here ever fetched them.
        const report = await getReportTransactions({
          b_id: branchFromUser, kind: "all", from: "2000-01-01", to: "2100-12-31",
        });

        const rows = (report?.transactions || []).map((t, i) => {
          const type = ledgerType(t.type);
          const invoiceNo = type === "sale" ? t.or_id
            : type === "purchase" ? t.po_id
            : type === "expense" ? t.exp_id
            : type === "commission" ? t.record_id
            : t.reference;
          const txPrefix = { sale: "POS", purchase: "PAY", hotel: "HOTEL", expense: "EXP", commission: "COMM" }[type] || "TX";

          return {
            id: `${type}-${invoiceNo ?? i}-${t.at}`,
            type,
            direction: t.direction,
            txId: `${txPrefix}#${invoiceNo ?? t.reference ?? i}`,
            invoiceNo,
            branchId: branchFromUser,
            branchLabel: branchName,
            cashierId: t.handled_by_id ?? null,
            // For a sale or a hotel payment this is the staff member who took
            // it; the ledger reused the same column for "who the money went
            // to or came from" on the other three kinds (a supplier, an
            // expense's description, a commission agent) rather than leaving
            // it blank.
            cashierLabel: t.handled_by || t.party || null,
            date: t.at,
            paymentMethod: t.method,
            amount: Number(t.amount ?? 0),
            raw: t,
          };
        });

        setTransactions(rows.sort((a, b) => new Date(b.date) - new Date(a.date)));
      } catch (err) {
        console.error("Ledger load error:", err);
        setLoadError('Failed to load transactions. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    };

    load();
    // Filtering happens client-side in `filtered` below — changing a filter
    // must not re-fetch the whole ledger from the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFromUser, branchName]);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      // Room payments count as income; a refund to a guest counts as money out.
      const moneyIn = t.type === "sale" || (t.type === "hotel" && t.direction !== "out");
      if (filters.tab === "income" && !moneyIn) return false;
      if (filters.tab === "expense" && moneyIn) return false;

      if (filters.method !== "all" && filters.method !== "") {
        const targetMethod = String(t.paymentMethod || "").toLowerCase();
        if (targetMethod !== String(filters.method).toLowerCase()) return false;
      }

      if (filters.search.trim()) {
        const s = filters.search.toLowerCase();
        const matches =
          String(t.txId || "").toLowerCase().includes(s) ||
          String(t.invoiceNo || "").toLowerCase().includes(s) ||
          String(t.branchLabel || "").toLowerCase().includes(s) ||
          String(t.cashierLabel || "").toLowerCase().includes(s) ||
          // a hotel payment can still be found by the guest's name
          String(t.raw?.party || "").toLowerCase().includes(s);
        if (!matches) return false;
      }

      // Compared as calendar days. The old test set the boundary at UTC midnight, which
      // is 05:30 here, so anything dated the first day at 00:00 was cut off.
      const day = dayKey(t.date);
      if (filters.dateFrom && day && day < filters.dateFrom) return false;
      if (filters.dateTo && day && day > filters.dateTo) return false;

      return true;
    });
  }, [transactions, filters]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-800 antialiased">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden" style={{ marginLeft: "var(--sidebar-w, 240px)" }}>
        <Header title="Transaction Details" />

        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Financial Ledger</h1>
                <p className="text-sm text-slate-500">Audit, inspect, and trace branch transactions.</p>
              </div>
            </div>

            <TransactionFilters filters={filters} setFilters={setFilters} />

            {loadError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
                {loadError}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              {!loading && filtered.length === 0 ? (
                <div className="p-20 text-center">
                  <p className="text-base font-medium text-slate-600">No transaction history for this branch.</p>
                  <p className="text-xs text-slate-400 mt-1">Try a different date range or clearing filters.</p>
                </div>
              ) : (
                <TransactionTable
                  data={filtered}
                  loading={loading}
                  pageSize={pageSize}
                  onView={(item) => setSelected(item)}
                />
              )}
            </div>
          </div>
        </main>
      </div>

      {selected && <TransactionDetailsModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}





















