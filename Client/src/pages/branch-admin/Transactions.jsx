import React, { useEffect, useMemo, useState } from "react";
import Header from "../../components/branch-admin/Header";
import Sidebar from "../../components/branch-admin/Sidebar";
import TransactionFilters from "../../components/branch-admin/TransactionFilters";
import TransactionTable from "../../components/admin/TransactionTable";
import TransactionDetailsModal from "../../components/admin/TransactionDetailsModal";
import {
  getOrders,
  getSupplierPayments,
  getPayments,
  getPurchaseOrders,
  getBranches,
  getReportTransactions,
} from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { dayKey } from "../../utils/dates";

// An order is stored as a date and a time of day. Reading only the date put every
// sale at 12:00 AM, and made same-day sales impossible to tell apart.
const whenOrdered = (date, time) =>
  date && time ? new Date(`${dayKey(date)}T${String(time).slice(0, 8)}`) : date;

export default function Transactions() {
  const [filters, setFilters] = useState({
    search: "",
    method: "all",
    dateFrom: null,
    dateTo: null,
    tab: "all",
  });

  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [pageSize] = useState(10);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const orderParams = {}; // load all statuses so branch admin can see pending/in-progress too

        // Branch filter: branch-admin must only see their branch.
        const branchFromUser = user?.b_id ?? user?.B_id ?? user?.branchId ?? null;
        const isBranchAdmin = user?.role_id === 1;
        const branchFilter = isBranchAdmin ? branchFromUser : null;

        if (branchFilter) orderParams.b_id = branchFilter;

        const [sales, paymentsList, supplierPayments, purchaseOrders, branches, hotel] =
          await Promise.all([
            getOrders(orderParams).catch(() => []),
            getPayments().catch(() => []),
            getSupplierPayments().catch(() => []),
            getPurchaseOrders().catch(() => []),
            getBranches().catch(() => []),
            // Money taken at the front desk: booking advances, settlements and refunds.
            // This ledger only ever listed restaurant sales and purchases, so a hotel that
            // had taken LKR 60,000 in room payments showed "no transactions".
            branchFromUser
              ? getReportTransactions({ b_id: branchFromUser, kind: "hotel", from: "2000-01-01", to: "2100-12-31" }).catch(() => null)
              : Promise.resolve(null),
          ]);

        const paymentsByOrder = {};
        (paymentsList || []).forEach((p) => {
          const oid = p.or_id;
          if (!oid) return;
          const existing = paymentsByOrder[oid];
          const curDate = p.pay_date ? new Date(p.pay_date) : new Date();
          const existingDate =
            existing && existing.pay_date ? new Date(existing.pay_date) : null;
          if (!existing || (existingDate && curDate > existingDate) || !existingDate) {
            paymentsByOrder[oid] = p;
          }
        });

        const purchaseOrdersById = {};
        (purchaseOrders || []).forEach((po) => {
          if (po && po.po_id !== undefined && po.po_id !== null) {
            purchaseOrdersById[po.po_id] = po;
          }
        });

        const branchById = {};
        (branches || []).forEach((b) => {
          if (b && (b.B_id !== undefined && b.B_id !== null)) {
            branchById[b.B_id] = b;
          }
        });

        const normalizedSales = (sales || []).map((o) => {
          const pay = paymentsByOrder[o.or_id];
          const payMethod = pay?.pay_method ?? pay?.method ?? null;
          const branchName =
            branchById[o.b_id]?.B_name ?? o.B_name ?? o.b_name ?? null;

          return {
            id: `sale-${o.or_id}`,
            type: "sale",
            txId: `POS#${o.or_id}`,
            invoiceNo: o.or_id,
            branchId: o.b_id,
            branchLabel: branchName,
            cashierId: o.u_id,
            cashierLabel: o.u_name ?? null,
            date: whenOrdered(o.or_date, o.or_time) ?? o.or_time ?? o.created_at,
            paymentMethod:
              payMethod ? String(payMethod) : (o.or_paymentmethod ?? null) ?? "Cash",
            amount: Number(o.or_totalCostWtax ?? o.or_totalcost ?? 0),
            raw: o,
          };
        });

        let normalizedPayments = (supplierPayments || []).map((p) => {
          const po = purchaseOrdersById[p.po_id];

          // branchId may be stored as b_id or B_id in different endpoints
          const branchId = po?.b_id ?? po?.B_id ?? p.b_id ?? p.B_id ?? null;
          const branchName =
            po?.B_name ??
            po?.b_name ??
            branchById[branchId]?.B_name ??
            p.B_name ??
            p.b_name ??
            null;

          return {
            id: `pay-${p.pay_id}`,
            type: "purchase",
            txId: `PAY#${p.pay_id}`,
            invoiceNo: p.po_id,
            branchId,
            branchLabel: branchName,
            cashierId: p.sup_id,
            cashierLabel: p.sup_name,
            date: p.payment_date,
            paymentMethod: p.method,
            amount: Number(p.amount ?? 0),
            raw: p,
          };
        });

        // If branch-admin, apply branch filter to purchases too
        if (branchFilter) {
          normalizedPayments = normalizedPayments.filter(
            (p) => p.branchId !== null && Number(p.branchId) === Number(branchFilter),
          );
        }

        const hotelRows = ((hotel && hotel.transactions) || []).map((h, i) => ({
          id: `hotel-${i}-${h.reference}-${h.at}`,
          type: "hotel",
          direction: h.direction,
          txId: `HOTEL#${h.reference}`,
          invoiceNo: h.reference,
          branchId: branchFromUser,
          branchLabel: branchById[branchFromUser]?.B_name ?? null,
          cashierId: null,
          // "Handled by" is the staff member who took the payment, as it is for a sale.
          cashierLabel: h.handled_by || null,
          date: h.at,
          paymentMethod: h.method,
          amount: Number(h.amount ?? 0),
          raw: h,
        }));

        setTransactions(
          [...normalizedSales, ...normalizedPayments, ...hotelRows].sort(
            (a, b) => new Date(b.date) - new Date(a.date),
          ),
        );
      } catch (err) {
        console.error("Ledger load error:", err);
        setLoadError('Failed to load transactions. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [filters, user]);

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





















