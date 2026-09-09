import React, { useEffect, useState } from 'react';
import AdminSidebar from '../../components/admin/Sidebar';
import AdminHeader from '../../components/admin/Header';
import BranchSidebar from '../../components/branch-admin/Sidebar';
import BranchHeader from '../../components/branch-admin/Header';
import {
  getDiscounts,
  createDiscount,
  updateDiscount,
  deleteDiscount,
  toggleDiscount,
  getBranches,
  getBranchProducts,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { ROLE } from '../../constants/roles';

const DISCOUNT_TYPES = ['order', 'product', 'loyalty', 'combo'];
const VALUE_TYPES = ['percentage', 'fixed'];

const empty = () => ({
  discount_name: '',
  discount_type: 'order',
  value_type: 'percentage',
  discount_value: '',
  coupon_code: '',
  start_date: '',
  end_date: '',
  max_uses: '',
  min_order_amount: '',
  Bpro_id: '',
  b_id: '',
  is_active: true,
});

const Promotions = () => {
  const { user } = useAuth();
  const [view, setView] = useState('list'); // 'list' | 'form'
  const [discounts, setDiscounts] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [branches, setBranches] = useState([]);
  const [branchProducts, setBranchProducts] = useState([]);

  // True only for roles that span branches, so they must choose one. The
  // Administrator (role 1) is pinned to its own branch and never sees a picker.
  const isAdmin = [ROLE.ADMIN, ROLE.SUPER_ADMIN].includes(Number(user?.role_id));
  const userBranchId = user?.b_id ?? null;

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (!isAdmin && userBranchId) params.branch_id = userBranchId;
      const [discountList, branchList] = await Promise.all([
        getDiscounts(params).catch(() => []),
        isAdmin ? getBranches().catch(() => []) : Promise.resolve([]),
      ]);
      setDiscounts(discountList);
      setBranches(branchList);
    } catch (err) {
      setError('Failed to load promotions.');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (d) => {
    setEditing(d);
    setView('form');
    // Pre-load branch products if product/combo type
    if ((d.discount_type === 'product' || d.discount_type === 'combo') && d.b_id) {
      getBranchProducts(d.b_id).then(setBranchProducts).catch(() => {});
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this promotion?')) return;
    try {
      await deleteDiscount(id);
      setDiscounts(prev => prev.filter(d => d.discount_id !== id));
    } catch (err) {
      alert(err?.response?.data?.message || 'Delete failed.');
    }
  };

  const handleToggle = async (id) => {
    try {
      const res = await toggleDiscount(id);
      setDiscounts(prev => prev.map(d =>
        d.discount_id === id ? { ...d, is_active: res.data?.is_active ?? !d.is_active } : d
      ));
    } catch (err) {
      alert('Toggle failed.');
    }
  };

  const handleFormSave = async (formData) => {
    const payload = {
      discount_name: formData.discount_name.trim(),
      discount_type: formData.discount_type,
      value_type: formData.value_type,
      discount_value: Number(formData.discount_value),
      discount_amount: 0,
      b_id: Number(formData.b_id || userBranchId),
      is_active: formData.is_active,
    };
    if (formData.coupon_code?.trim()) payload.coupon_code = formData.coupon_code.trim();
    if (formData.start_date) payload.start_date = formData.start_date;
    if (formData.end_date) payload.end_date = formData.end_date;
    if (formData.max_uses) payload.max_uses = Number(formData.max_uses);
    if (formData.min_order_amount) payload.min_order_amount = Number(formData.min_order_amount);
    if (formData.Bpro_id) payload.Bpro_id = Number(formData.Bpro_id);

    try {
      if (editing) {
        const res = await updateDiscount(editing.discount_id, payload);
        setDiscounts(prev => prev.map(d => d.discount_id === editing.discount_id ? res.data : d));
      } else {
        const res = await createDiscount(payload);
        setDiscounts(prev => [res.data, ...prev]);
      }
      setEditing(null);
      setView('list');
    } catch (err) {
      const msgs = err?.response?.data?.errors?.join(', ') || err?.response?.data?.message || 'Save failed.';
      alert(msgs);
    }
  };

  // Branch Admin keeps its own Hotel/Restaurant/Business nav here — swapping in the
  // admin shell would drop them out of the section they navigated from.
  const isBranchAdmin = Number(user?.role_id) === 1;
  const Sidebar = isBranchAdmin ? BranchSidebar : AdminSidebar;
  const Header = isBranchAdmin ? BranchHeader : AdminHeader;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#f5f6fa' }}>
      <Sidebar />
      <div style={{ marginLeft: 'var(--sidebar-w, 240px)', flex: 1 }}>
        <Header title="Promotions" />
        <div style={{ padding: '30px' }}>
          {view === 'list' ? (
            <DiscountList
              discounts={discounts}
              loading={loading}
              error={error}
              onAdd={() => { setEditing(null); setView('form'); }}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggle={handleToggle}
            />
          ) : (
            <DiscountForm
              initialData={editing}
              isAdmin={isAdmin}
              userBranchId={userBranchId}
              branches={branches}
              branchProducts={branchProducts}
              setBranchProducts={setBranchProducts}
              onBack={() => { setEditing(null); setView('list'); }}
              onSave={handleFormSave}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const badge = (type) => {
  const map = {
    order: { bg: '#dbeafe', color: '#1d4ed8' },
    product: { bg: '#dcfce7', color: '#15803d' },
    loyalty: { bg: '#fef9c3', color: '#854d0e' },
    combo: { bg: '#fae8ff', color: '#7e22ce' },
  };
  const s = map[type] || { bg: '#f1f5f9', color: '#475569' };
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 10px', borderRadius: '99px',
      fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
    }}>{type}</span>
  );
};

const DiscountList = ({ discounts, loading, error, onAdd, onEdit, onDelete, onToggle }) => (
  <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
      <div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#1a1a2e', margin: 0 }}>Promotional Offers</h2>
        <p style={{ color: '#888', margin: '4px 0 0', fontSize: '14px' }}>Manage discounts and coupons</p>
      </div>
      <button
        onClick={onAdd}
        style={{ background: '#1565C0', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontWeight: 600, cursor: 'pointer', fontSize: '14px' }}
      >
        + Add Promotion
      </button>
    </div>

    {error && <p style={{ color: '#dc2626', marginBottom: 16 }}>{error}</p>}

    {loading ? (
      <p style={{ color: '#888', textAlign: 'center', marginTop: 60 }}>Loading promotions…</p>
    ) : discounts.length === 0 ? (
      <div style={{ background: '#fff', borderRadius: '12px', padding: '80px 20px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div style={{ fontSize: '40px', color: '#ccc', marginBottom: '16px' }}>🏷️</div>
        <h3 style={{ color: '#333', fontSize: '20px', marginBottom: '8px' }}>No promotions yet</h3>
        <p style={{ color: '#999', fontSize: '14px', marginBottom: '24px' }}>Create your first promotion to start driving sales</p>
        <button onClick={onAdd} style={{ background: '#1565C0', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontWeight: 600, cursor: 'pointer' }}>
          + Create Promotion
        </button>
      </div>
    ) : (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
        {discounts.map((d) => (
          <div key={d.discount_id} style={{
            background: '#fff', borderRadius: '12px', padding: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            border: `2px solid ${d.is_active ? '#1565C0' : '#e5e7eb'}`,
            opacity: d.is_active ? 1 : 0.6,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 4px', color: '#1a1a2e' }}>{d.discount_name}</h3>
                {badge(d.discount_type)}
              </div>
              <button
                onClick={() => onToggle(d.discount_id)}
                style={{
                  border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  background: d.is_active ? '#dcfce7' : '#fee2e2',
                  color: d.is_active ? '#15803d' : '#dc2626',
                }}
              >
                {d.is_active ? 'Active' : 'Inactive'}
              </button>
            </div>

            <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.7 }}>
              <div><b>Value:</b> {d.discount_value}{d.value_type === 'percentage' ? '%' : ' LKR'} off</div>
              {d.coupon_code && <div><b>Coupon:</b> {d.coupon_code}</div>}
              {d.end_date && <div><b>Expires:</b> {d.end_date}</div>}
              {d.max_uses && <div><b>Uses:</b> {d.uses_count ?? 0} / {d.max_uses}</div>}
              {d.min_order_amount > 0 && <div><b>Min order:</b> LKR {d.min_order_amount}</div>}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => onEdit(d)} style={{ flex: 1, padding: '7px', border: '1px solid #1565C0', borderRadius: '8px', background: '#fff', color: '#1565C0', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                Edit
              </button>
              <button
                onClick={() => onDelete(d.discount_id)}
                style={{ flex: 1, padding: '7px', border: '1px solid #fca5a5', borderRadius: '8px', background: '#fee2e2', color: '#dc2626', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

const DiscountForm = ({ initialData, isAdmin, userBranchId, branches, branchProducts, setBranchProducts, onBack, onSave }) => {
  const [form, setForm] = useState(initialData ? {
    discount_name: initialData.discount_name || '',
    discount_type: initialData.discount_type || 'order',
    value_type: initialData.value_type || 'percentage',
    discount_value: initialData.discount_value ?? '',
    coupon_code: initialData.coupon_code || '',
    start_date: initialData.start_date || '',
    end_date: initialData.end_date || '',
    max_uses: initialData.max_uses ?? '',
    min_order_amount: initialData.min_order_amount ?? '',
    Bpro_id: initialData.Bpro_id ?? '',
    b_id: initialData.b_id ?? '',
    is_active: initialData.is_active ?? true,
  } : empty());
  const [saving, setSaving] = useState(false);

  const needsBproId = form.discount_type === 'product' || form.discount_type === 'combo';

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));

    if (name === 'b_id' && value) {
      getBranchProducts(Number(value)).then(setBranchProducts).catch(() => {});
    }
    if (name === 'discount_type') {
      setBranchProducts([]);
      setForm(prev => ({ ...prev, discount_type: value, Bpro_id: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.discount_name.trim()) return alert('Discount name is required.');
    if (!form.discount_value || Number(form.discount_value) <= 0) return alert('Discount value must be positive.');
    if (!form.b_id && !userBranchId) return alert('Please select a branch.');
    if (needsBproId && !form.Bpro_id) return alert('Please select a branch product for this discount type.');
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const inp = {
    width: '100%', border: '1px solid #d8e0ed', borderRadius: '8px',
    padding: '10px 14px', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
  };
  const lbl = { display: 'block', marginBottom: '6px', fontWeight: 600, fontSize: '13px', color: '#333' };
  const field = { marginBottom: '16px' };

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#1565C0', cursor: 'pointer', fontSize: '14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px', padding: 0, fontWeight: 600 }}>
        ← Back to Promotions
      </button>

      <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#1a1a2e', margin: '0 0 4px' }}>
        {initialData ? 'Edit Promotion' : 'Create New Promotion'}
      </h2>
      <p style={{ color: '#888', fontSize: '14px', margin: '0 0 24px' }}>Configure a discount or promotional offer</p>

      <form onSubmit={handleSubmit}>
        <div style={{ background: '#fff', borderRadius: '12px', padding: '28px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '2px solid #1565C0', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 20px', color: '#1a1a2e' }}>Promotion Details</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ ...field, gridColumn: '1 / -1' }}>
              <label style={lbl}>Promotion Name *</label>
              <input name="discount_name" value={form.discount_name} onChange={handleChange} placeholder="e.g. Happy Hour 20% Off" style={inp} required />
            </div>

            <div style={field}>
              <label style={lbl}>Discount Type *</label>
              <select name="discount_type" value={form.discount_type} onChange={handleChange} style={inp}>
                {DISCOUNT_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>

            <div style={field}>
              <label style={lbl}>Value Type *</label>
              <select name="value_type" value={form.value_type} onChange={handleChange} style={inp}>
                {VALUE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>

            <div style={field}>
              <label style={lbl}>Discount Value * {form.value_type === 'percentage' ? '(%)' : '(LKR)'}</label>
              <input name="discount_value" type="number" min="0.01" step="0.01" value={form.discount_value} onChange={handleChange} placeholder="e.g. 20" style={inp} required />
            </div>

            <div style={field}>
              <label style={lbl}>Coupon Code</label>
              <input name="coupon_code" value={form.coupon_code} onChange={handleChange} placeholder="e.g. SUMMER20" style={inp} />
            </div>

            {isAdmin && (
              <div style={field}>
                <label style={lbl}>Branch *</label>
                <select name="b_id" value={form.b_id} onChange={handleChange} style={inp} required>
                  <option value="">Select branch…</option>
                  {branches.map(b => <option key={b.B_id} value={b.B_id}>{b.B_name}</option>)}
                </select>
              </div>
            )}

            {needsBproId && (
              <div style={{ ...field, gridColumn: isAdmin ? '2' : '1 / -1' }}>
                <label style={lbl}>Branch Product * (for {form.discount_type} discount)</label>
                <select name="Bpro_id" value={form.Bpro_id} onChange={handleChange} style={inp} required={needsBproId}>
                  <option value="">Select product…</option>
                  {branchProducts.map(p => <option key={p.Bpro_id} value={p.Bpro_id}>{p.pro_name}</option>)}
                </select>
              </div>
            )}

            <div style={field}>
              <label style={lbl}>Start Date</label>
              <input name="start_date" type="date" value={form.start_date} onChange={handleChange} style={inp} />
            </div>
            <div style={field}>
              <label style={lbl}>End Date</label>
              <input name="end_date" type="date" value={form.end_date} onChange={handleChange} style={inp} />
            </div>

            <div style={field}>
              <label style={lbl}>Max Uses</label>
              <input name="max_uses" type="number" min="1" value={form.max_uses} onChange={handleChange} placeholder="Unlimited" style={inp} />
            </div>
            <div style={field}>
              <label style={lbl}>Min Order Amount (LKR)</label>
              <input name="min_order_amount" type="number" min="0" step="0.01" value={form.min_order_amount} onChange={handleChange} placeholder="0" style={inp} />
            </div>

            <div style={{ ...field, display: 'flex', alignItems: 'center', gap: '10px', gridColumn: '1 / -1' }}>
              <input name="is_active" type="checkbox" checked={form.is_active} onChange={handleChange} id="is_active" style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <label htmlFor="is_active" style={{ fontWeight: 600, fontSize: '13px', color: '#333', cursor: 'pointer' }}>Active (visible to POS)</label>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button type="button" onClick={onBack} style={{ padding: '10px 24px', border: '1px solid #ddd', borderRadius: '8px', background: '#fff', color: '#333', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} style={{ padding: '10px 28px', border: 'none', borderRadius: '8px', background: saving ? '#9aadd6' : '#1565C0', color: '#fff', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : (initialData ? 'Update Promotion' : 'Create Promotion')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Promotions;
