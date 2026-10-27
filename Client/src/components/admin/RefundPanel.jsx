import React, { useEffect, useMemo, useState } from 'react';
import { getOrderRefunds, refundOrder, getDiscountApproval } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

/**
 * Refunds on one paid restaurant sale: what has gone back already, and a form
 * to hand more back — chosen dishes, the whole order, or just an amount.
 * A reason always, and a PIN (the server's approveMoneyBack decides whose).
 */

const METHODS = [['cash', 'Cash'], ['card', 'Card'], ['bank_transfer', 'Bank transfer'], ['online', 'Online']];
const money = (v) => `LKR ${Number(v || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n) => Math.round(Number(n) * 100) / 100;

export default function RefundPanel({ orderId, onRefunded }) {
  const { user } = useAuth();
  const isAdministrator = [1, 2, 6].includes(Number(user?.role_id));
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState(null); // { qty: {id: n}, amount, amountTouched, method, reason, pin, pinNeeded, busy, error }

  const load = async () => {
    try { setInfo(await getOrderRefunds(orderId)); setLoadError(''); }
    catch (e) { setLoadError(e?.response?.data?.message || e?.response?.data?.error || 'Could not load refunds'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orderId]);

  // What the chosen dishes come to, after the bill's discount and charges.
  const itemsValue = useMemo(() => {
    if (!form || !info) return 0;
    return r2(info.lines.reduce((n, l) => n + (form.qty[l.orderItem_id] || 0) * l.paid_each, 0));
  }, [form, info]);

  const open = async () => {
    const method = METHODS.some(([m]) => m === info.payment_method) ? info.payment_method : 'cash';
    setForm({ qty: {}, amount: '', amountTouched: false, method, reason: '', pin: '', pinNeeded: !isAdministrator, busy: false, error: '' });
    if (!isAdministrator) return; // till staff always need a manager's PIN
    let pinNeeded = true;
    try { pinNeeded = Boolean((await getDiscountApproval())?.pin_needed); } catch { /* ask for it */ }
    setForm((f) => f && { ...f, pinNeeded });
  };
  const setQty = (id, q) => setForm((f) => {
    const qty = { ...f.qty, [id]: q };
    if (f.amountTouched) return { ...f, qty };
    const value = r2(info.lines.reduce((n, l) => n + (qty[l.orderItem_id] || 0) * l.paid_each, 0));
    return { ...f, qty, amount: value ? String(Math.min(value, info.refundable)) : '' };
  });
  const wholeOrder = () => setForm((f) => ({
    ...f,
    qty: Object.fromEntries(info.lines.map((l) => [l.orderItem_id, l.refundable_qty])),
    amount: String(info.refundable), amountTouched: false,
  }));

  const submit = async (e) => {
    e.preventDefault();
    const amount = r2(form.amount);
    if (!(amount > 0)) return setForm({ ...form, error: 'Enter the amount being handed back.' });
    if (amount > info.refundable + 0.005) return setForm({ ...form, error: `Only ${money(info.refundable)} can still be refunded.` });
    if (form.reason.trim().length < 3) return setForm({ ...form, error: 'Write why the money is going back.' });
    if (form.pinNeeded && !/^\d{4,8}$/.test(form.pin)) return setForm({ ...form, error: 'Enter the PIN (4 to 8 digits).' });
    setForm({ ...form, busy: true, error: '' });
    try {
      await refundOrder(orderId, {
        amount, method: form.method, reason: form.reason.trim(), pin: form.pin,
        items: Object.entries(form.qty).filter(([, q]) => q > 0).map(([id, q]) => ({ orderItem_id: Number(id), qty: q })),
      });
      setForm(null);
      await load();
      onRefunded?.();
    } catch (err) {
      setForm((f) => f && { ...f, busy: false, pin: '',
        error: err?.response?.data?.message || err?.response?.data?.error || 'Could not give the refund' });
    }
  };

  if (loadError) return <div className="text-xs text-rose-700">{loadError}</div>;
  if (!info) return null;

  return (
    <div className="space-y-3 no-print">
      {info.refunds.length > 0 && (
        <div className="rounded-lg border border-rose-100 bg-rose-50/60 p-3 text-xs">
          <div className="font-bold text-rose-800 mb-1">Refunded {money(info.refunded)} of {money(info.total)}</div>
          {info.refunds.map((r) => (
            <div key={r.refund_id} className="flex justify-between gap-3 py-0.5 text-rose-900">
              <span>
                {new Date(r.created_at).toLocaleString()} · {String(r.method).replace(/_/g, ' ')} · {r.reason}
                {r.refunded_by ? ` · by ${r.refunded_by}` : ''}{r.approved_by ? `, approved by ${r.approved_by}` : ''}
              </span>
              <span className="font-mono font-semibold whitespace-nowrap">−{money(r.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {!form && (
        info.blocked
          ? <div className="text-xs text-slate-500">{info.blocked}</div>
          : <button onClick={open}
              className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
              Refund…
            </button>
      )}

      {form && (
        <form onSubmit={submit} className="rounded-lg border border-slate-200 p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="font-bold text-slate-800 text-sm">Give a refund</div>
            <button type="button" onClick={wholeOrder} className="text-indigo-600 font-semibold hover:underline">
              Whole order ({money(info.refundable)})
            </button>
          </div>
          <div className="text-slate-500">Choose what came back, or just type an amount. It comes off today&apos;s restaurant sales.</div>
          <div className="divide-y divide-slate-100 rounded-md border border-slate-100">
            {info.lines.map((l) => {
              const q = form.qty[l.orderItem_id] || 0;
              return (
                <div key={l.orderItem_id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <div className="font-medium text-slate-800">{l.name}</div>
                    <div className="text-slate-400">
                      {l.qty} sold{l.refunded_qty ? ` · ${l.refunded_qty} refunded` : ''} · {money(l.paid_each)} each
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" aria-label={`One less ${l.name}`} disabled={q <= 0}
                      onClick={() => setQty(l.orderItem_id, q - 1)}
                      className="h-6 w-6 rounded border border-slate-200 disabled:opacity-40">−</button>
                    <span className="w-6 text-center font-semibold">{q}</span>
                    <button type="button" aria-label={`One more ${l.name}`} disabled={q >= l.refundable_qty}
                      onClick={() => setQty(l.orderItem_id, q + 1)}
                      className="h-6 w-6 rounded border border-slate-200 disabled:opacity-40">+</button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-slate-500 font-medium">Amount handed back (LKR)</span>
              <input type="number" min="0.01" step="0.01" max={info.refundable} value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value, amountTouched: true })}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5" />
              {itemsValue > 0 && r2(form.amount) !== itemsValue && (
                <span className="text-amber-700">The chosen items come to {money(itemsValue)}.</span>
              )}
            </label>
            <label className="block">
              <span className="text-slate-500 font-medium">How it goes back</span>
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 bg-white">
                {METHODS.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-slate-500 font-medium">Reason</span>
            <input value={form.reason} maxLength={200} placeholder="e.g. dish sent back cold"
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5" />
          </label>
          {form.pinNeeded && (
            <label className="block">
              <span className="text-slate-500 font-medium">{isAdministrator ? 'PIN' : "Manager's approval PIN"}</span>
              <input type="password" inputMode="numeric" autoComplete="off" value={form.pin}
                onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 8) })}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 tracking-widest" />
            </label>
          )}
          {form.error && <div className="font-semibold text-rose-700">{form.error}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={form.busy} onClick={() => setForm(null)}
              className="flex-1 rounded-md border border-slate-200 bg-white py-2 font-semibold text-slate-600">Cancel</button>
            <button type="submit" disabled={form.busy}
              className="flex-1 rounded-md bg-rose-600 py-2 font-semibold text-white disabled:opacity-60">
              {form.busy ? 'Refunding…' : `Refund ${form.amount ? money(form.amount) : ''}`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
