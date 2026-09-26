import React, { useEffect, useRef, useState } from 'react';
import {
  getOrderById,
  getOrderItemsByOrderId,
  getPurchaseOrderById,
  getPurchaseItemsByOrder,
  getPaymentsByOrder,
  getBranchProducts,
} from '../../services/api';
import { printElement } from '../../utils/printElement';

function formatAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

export default function TransactionDetailsModal({ item, onClose }) {
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(null);
  const [fetchError, setFetchError] = useState('');
  const [bpMap, setBpMap] = useState({});
  const receiptRef = useRef(null);

  useEffect(() => {
    if (!item) return;
    setFetchError('');
    const load = async () => {
      // A hotel payment, an expense, a commission record, a waste record, and
      // a COD settlement are each already the whole thing — a single row,
      // not an order with lines to fetch.
      if (item.type === 'hotel' || item.type === 'expense' || item.type === 'commission' || item.type === 'waste' || item.type === 'cod') {
        setDetails(null);
        return;
      }
      setLoading(true);
      try {
        const idToken = Number(item.invoiceNo);
        if (!Number.isFinite(idToken) || idToken <= 0) {
          setFetchError('Malformed transaction invoice parameters.');
          return;
        }

        if (item.type === 'sale') {
          const [orderRes, itemsRes] = await Promise.all([
            getOrderById(idToken).catch(() => null),
            getOrderItemsByOrderId(idToken).catch(() => []),
          ]);

          // Unpack custom API wrapper objects cleanly if the backend wraps arrays in .data
          const orderData = orderRes?.data ?? orderRes;
          const itemsData = Array.isArray(itemsRes) ? itemsRes : (itemsRes?.data ?? []);

          setDetails({ order: orderData, items: itemsData });
        } else {
          const [po, items, payments] = await Promise.all([
            getPurchaseOrderById(idToken).catch(() => null),
            getPurchaseItemsByOrder(idToken).catch(() => []),
            getPaymentsByOrder(idToken).catch(() => []),
          ]);
          setDetails({ po, items, payments });
        }
      } catch (err) {
        console.error('Modal data extraction capture crash:', err);
        setFetchError('Could not retrieve absolute item attributes.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [item]);

  if (!item) return null;

  useEffect(() => {
  let mounted = true;
  getBranchProducts()
    .then((res) => {
      const arr = Array.isArray(res) ? res : (res?.data ?? res) ?? [];
      if (!mounted) return;
      setBpMap(Object.fromEntries(arr.map(p => [String(p.Bpro_id), p])));
    })
    .catch(() => {})
  return () => { mounted = false; };
}, []);

  return (
    <div className="print-root fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm no-print" onClick={onClose} />

      <div ref={receiptRef} className="print-area relative z-10 flex flex-col w-full max-w-2xl bg-white rounded-xl shadow-xl overflow-hidden max-h-[85vh] border border-slate-100">
        {/* Modal Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {item.type === 'sale' ? 'Sales Transaction Receipt'
                : item.type === 'hotel' ? (item.direction === 'out' ? 'Hotel Refund' : 'Hotel Payment Receipt')
                : item.type === 'expense' ? 'Expense Record'
                : item.type === 'commission' ? 'Agent Commission'
                : item.type === 'waste' ? 'Waste Record'
                : item.type === 'cod' ? 'Delivery COD Settlement'
                : 'Purchase Expense Ledger'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Reference: {item.txId}</p>
          </div>
          <div className="flex gap-2 no-print">
            <button
              onClick={() => printElement(receiptRef.current, { title: `Receipt ${item.txId}`, widthMm: 80 })}
              disabled={loading}
              title={loading ? 'Wait for the line items to load' : 'Print this receipt'}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Loading…' : 'Print'}
            </button>
            <button
              onClick={onClose}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-slate-800 focus:outline-none"
            >
              Close
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {fetchError && (
            <div className="p-3 bg-rose-50 border border-rose-100 text-rose-800 text-xs rounded-lg font-medium">
              {fetchError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-xs">
            <div>
              <span className="block text-slate-400 font-medium uppercase tracking-wider">
                {item.type === 'hotel' ? 'Booking Reference'
                  : item.type === 'expense' ? 'Expense Record #'
                  : item.type === 'commission' ? 'Commission Record #'
                  : item.type === 'waste' ? 'Waste Record #'
                  : item.type === 'cod' ? 'Settlement #'
                  : 'Invoice / PO Number'}
              </span>
              <span className="text-sm font-semibold text-slate-800 mt-0.5 block">{item.type === 'hotel' ? '' : '#'}{item.invoiceNo}</span>
            </div>
            <div>
              <span className="block text-slate-400 font-medium uppercase tracking-wider">Transaction Timestamp</span>
              <span className="text-sm font-semibold text-slate-800 mt-0.5 block">
                {item.date ? new Date(item.date).toLocaleString() : '-'}
              </span>
            </div>
            <div>
              <span className="block text-slate-400 font-medium uppercase tracking-wider">Settlement Routing</span>
              <span className="text-sm font-semibold text-slate-800 mt-0.5 block capitalize">{item.paymentMethod ?? '-'}</span>
            </div>
            <div>
              <span className="block text-slate-400 font-medium uppercase tracking-wider">Total Value Gross</span>
              <span className={`text-sm font-bold font-mono mt-0.5 block ${item.type === 'sale' || item.type === 'cod' || (item.type === 'hotel' && item.direction !== 'out') ? 'text-emerald-600' : 'text-rose-600'}`}>
                LKR {formatAmount(item.amount)}
              </span>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-slate-400 text-sm">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600" />
              <span>Fetching transactional logs...</span>
            </div>
          ) : (
            <>
              {item.type === 'hotel' && (
                <div className="rounded-xl border border-slate-100 p-4 text-xs">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="block text-slate-400 font-medium uppercase tracking-wider">Guest</span>
                      <span className="text-sm font-semibold text-slate-800 mt-0.5 block">{item.raw?.party || '-'}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400 font-medium uppercase tracking-wider">Received by</span>
                      <span className="text-sm font-semibold text-slate-800 mt-0.5 block">{item.cashierLabel || '-'}</span>
                    </div>
                  </div>
                  <p className="mt-3 text-slate-500">
                    {item.direction === 'out' ? 'Money returned to the guest' : 'Money received from the guest'} for hotel booking {item.invoiceNo}.
                    Open the booking for the full bill.
                  </p>
                </div>
              )}
              {item.type === 'expense' && (
                <div className="rounded-xl border border-slate-100 p-4 text-xs">
                  <span className="block text-slate-400 font-medium uppercase tracking-wider">Description</span>
                  <span className="text-sm font-semibold text-slate-800 mt-0.5 block">{item.raw?.party || '—'}</span>
                  <p className="mt-3 text-slate-500">{item.raw?.type || 'Expense'}, recorded on the Accounting page.</p>
                </div>
              )}
              {item.type === 'commission' && (
                <div className="rounded-xl border border-slate-100 p-4 text-xs">
                  <span className="block text-slate-400 font-medium uppercase tracking-wider">Agent</span>
                  <span className="text-sm font-semibold text-slate-800 mt-0.5 block">{item.raw?.party || item.cashierLabel || '—'}</span>
                  <p className="mt-3 text-slate-500">
                    {item.raw?.type?.includes('paid')
                      ? 'Paid out to this agent.'
                      : 'Owed to this agent, not yet paid — counted as a cost against this period regardless.'}
                  </p>
                </div>
              )}
              {item.type === 'waste' && (
                <div className="rounded-xl border border-slate-100 p-4 text-xs">
                  <span className="block text-slate-400 font-medium uppercase tracking-wider">Item</span>
                  <span className="text-sm font-semibold text-slate-800 mt-0.5 block">{item.raw?.party || '—'}</span>
                  <p className="mt-3 text-slate-500">{item.raw?.reference || 'No reason recorded.'} — see Waste Tracking for the full record.</p>
                </div>
              )}
              {item.type === 'cod' && (
                <div className="rounded-xl border border-slate-100 p-4 text-xs">
                  <span className="block text-slate-400 font-medium uppercase tracking-wider">Delivery Partner</span>
                  <span className="text-sm font-semibold text-slate-800 mt-0.5 block">{item.raw?.party || '—'}</span>
                  <p className="mt-3 text-slate-500">
                    Cash-on-delivery cash settled by this partner{item.raw?.reference ? ` — ${item.raw.reference}` : ''}.
                    See Delivery COD for which orders it covered.
                  </p>
                </div>
              )}
              {item.type === 'sale' && details?.items && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Line Items Detail Breakout</h4>
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-xs font-semibold text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="p-2.5 pl-4">Item ID/ Reference</th>
                          <th className="p-2.5 text-center">Quantity</th>
                          <th className="p-2.5 text-right">Unit Price</th>
                          <th className="p-2.5 text-right pr-4">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white text-xs">
                        {details.items.map((it, idx) => {
                        const name = it.pro_name
                            ?? bpMap[String(it.Bpro_id)]?.pro_name
                            ?? it.name
                            ?? (it.pro_id ? `Product ID: #${it.pro_id}` : "Unknown Item Ref");
                        const refId = name;
                          const qty = Number(it.pro_quantity ?? 0);
                          const unitPrice = Number(it.unit_price ?? 0);
                          const totalLine = Number(it.total_price ?? (qty * unitPrice));
              

                          return (
                            <tr key={it.orderItem_id || idx}>
                              <td className="p-2.5 pl-4 font-medium text-slate-800">{refId}</td>
                              <td className="p-2.5 text-center text-slate-600">{qty}</td>
                              <td className="p-2.5 text-right font-mono text-slate-600">LKR {formatAmount(unitPrice)}</td>
                              <td className="p-2.5 text-right font-mono font-semibold text-slate-800 pr-4">
                                LKR {formatAmount(totalLine)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {item.type === 'purchase' && details?.po && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Raw Material Input Procurement</h4>
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="p-2.5 pl-4">Resource Designation</th>
                            <th className="p-2.5 text-center">Qty Bought</th>
                            <th className="p-2.5 text-right">Cost per Unit</th>
                            <th className="p-2.5 text-right pr-4">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white text-xs">
                          {(details.items || []).map((it, idx) => (
                            <tr key={idx}>
                              <td className="p-2.5 pl-4 font-medium text-slate-800">{it.rm_name}</td>
                              <td className="p-2.5 text-center text-slate-600">{it.qty}</td>
                              <td className="p-2.5 text-right font-mono text-slate-600">{formatAmount(it.unit_price)}</td>
                              <td className="p-2.5 text-right font-mono font-semibold text-slate-800 pr-4">{formatAmount(it.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}






