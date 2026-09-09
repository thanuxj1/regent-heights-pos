import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getSuppliers, createPurchaseOrder, createPurchaseItem } from '../../services/api';

const VALID_UNITS = ["kg", "g", "l", "ml", "pcs", "units", "box", "pack"];

const ReorderModal = ({ material, onClose, onSuccess }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoaded, setSuppliersLoaded] = useState(false);
  const [formData, setFormData] = useState({
    sup_id: '',
    quantity: '',
    unit: material?.unit || 'pcs',
    unitPrice: ''
  });
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    getSuppliers()
      .then(data => { setSuppliers(Array.isArray(data) ? data : []); setSuppliersLoaded(true); })
      .catch(() => { setSuppliers([]); setSuppliersLoaded(true); });
    return () => { document.body.style.overflow = 'unset'; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const branchId = user?.b_id ?? user?.B_id ?? null;
      if (!branchId) {
        setError('Branch ID missing for current user. Cannot create purchase order.');
        setLoading(false);
        return;
      }

      const order = await createPurchaseOrder({
        sup_id: parseInt(formData.sup_id, 10),
        B_id: Number(branchId),
        status: 'pending',
      });

      const po_id = order?.po_id ?? order?.data?.po_id;
      if (!po_id) throw new Error('Purchase order created but ID is missing');

      await createPurchaseItem({
        po_id,
        rm_id: material.rm_id,
        qty: parseFloat(formData.quantity),
        unit_price: parseFloat(formData.unitPrice),
        price: parseFloat(formData.quantity) * parseFloat(formData.unitPrice),
      });

      setIsSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      if (err?.response?.status === 401) { navigate('/login'); return; }
      setError(err?.response?.data?.message || err?.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-[1000] p-4">
      <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl relative animate-in fade-in zoom-in duration-200">
        {isSuccess ? (
          <div className="text-center py-10">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">✓</div>
            <h2 className="text-2xl font-bold text-gray-800">Order Placed!</h2>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-800">Reorder: {material?.rm_name}</h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</div>
            )}

            {suppliersLoaded && suppliers.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-center mb-4">
                <div className="text-2xl mb-2">📦</div>
                <p className="text-sm font-semibold text-amber-800 mb-1">No suppliers found</p>
                <p className="text-xs text-amber-700 mb-3">Add a supplier first to create a purchase order.</p>
                <button
                  type="button"
                  onClick={() => { onClose(); navigate('/branch-admin/supplier-directory'); }}
                  className="px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-xl hover:bg-amber-700"
                >
                  Go to Supplier Directory
                </button>
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Select Supplier</label>
                <select
                  className="w-full border-gray-200 border rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500"
                  required
                  value={formData.sup_id}
                  onChange={(e) => setFormData({ ...formData, sup_id: e.target.value })}
                >
                  <option value="">Choose a supplier...</option>
                  {suppliers.map(s => (
                    <option key={s.sup_id} value={s.sup_id}>{s.sup_name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Quantity</label>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    className="w-full border-gray-200 border rounded-xl p-3"
                    required
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Unit</label>
                  <select
                    className="w-full border-gray-200 border rounded-xl p-3"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  >
                    {VALID_UNITS.map(u => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase mb-1">Unit Price (LKR)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="w-full border-gray-200 border rounded-xl p-3"
                  required
                  value={formData.unitPrice}
                  onChange={(e) => setFormData({ ...formData, unitPrice: e.target.value })}
                />
              </div>

              <div className="pt-6 flex gap-3">
                <button type="button" onClick={onClose} className="flex-1 py-3 text-gray-500 font-semibold">Cancel</button>
                <button
                  type="submit"
                  disabled={loading || !formData.sup_id}
                  className="flex-1 bg-blue-600 text-white font-bold py-3 rounded-xl disabled:bg-blue-300"
                >
                  {loading ? 'Ordering...' : 'Confirm Order'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ReorderModal;
