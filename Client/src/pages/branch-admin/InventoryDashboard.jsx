import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../../components/branch-admin/Sidebar';
import Header from '../../components/branch-admin/Header';
import ReorderModal from '../../components/branch-admin/ReorderModal';
import EditMaterialModal from '../../components/branch-admin/EditMaterialModal';
import CountStockModal from '../../components/branch-admin/CountStockModal';
import StatCard from '../../components/branch-admin/StatCard';
import { getRawMaterials, countRawMaterial, getBranchProducts, countBranchProduct } from '../../services/api';
import { stockOf } from '../../utils/stockLabel';

const InventoryDashboard = () => {
  const navigate = useNavigate();

  const getCachedMaterials = () => {
    const saved = localStorage.getItem('cached_materials');
    try {
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.data)) return parsed.data;
      if (Array.isArray(parsed?.materials)) return parsed.materials;
      return [];
    } catch { return []; }
  };

  const [materials, setMaterials] = useState(getCachedMaterials);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true); // always fetch fresh on mount
  const [fetchError, setFetchError] = useState("");
  const [activeFilter, setActiveFilter] = useState('all'); // New state: 'all' | 'low' | 'out'
  const [activeTab, setActiveTab] = useState('all_categories'); // 'all_categories', 'ingredient', 'product', 'supply'
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [countingItem, setCountingItem] = useState(null);

  useEffect(() => {
    fetchInventory();
  }, []);

  const extractArray = (data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.materials)) return data.materials;
    return [];
  };

  const fetchInventory = async () => {
    setIsLoading(true);
    setFetchError("");
    try {
      const [raw, branchProds] = await Promise.all([
        getRawMaterials(),
        getBranchProducts()
      ]);
      const rawItems = extractArray(raw);
      const prodItems = extractArray(branchProds);
      setMaterials(rawItems);
      setProducts(prodItems);
      localStorage.setItem('cached_materials', JSON.stringify(rawItems));
    } catch (err) {
      if (err?.response?.status === 401) { navigate('/login'); return; }
      setFetchError(err?.response?.data?.message || err?.response?.data?.error || err.message || 'Failed to load inventory data');
      console.error('Failed to load inventory', err);
    } finally {
      setIsLoading(false);
    }
  };

  // A menu item is one of three things (see utils/stockLabel.js). `low_stock` on a
  // product is the *level* the owner set (10), not a yes/no — reading it as a flag made
  // every counted product "low", and a dish cooked to order has no count to run out.
  const productItems = useMemo(() => (Array.isArray(products) ? products : []).map((p) => {
    const s = stockOf(p);
    return {
      rm_id: p.Bpro_id,
      rm_name: p.pro_name,
      unit: "",
      stock_qty: s.madeToOrder ? null : s.count,
      record_level: p.low_stock ?? 0,
      low_stock: s.low,
      storeroomQty: p.storeroom_qty,
      madeToOrder: s.madeToOrder,
      fromRecipe: p.stock_mode === "recipe",
      item_category: 'product',
      isProduct: true,
      originalProduct: p,
    };
  }), [products]);

  const isTracked = (m) => !m.madeToOrder;

  const stats = useMemo(() => {
    const list = [...(Array.isArray(materials) ? materials : []), ...productItems].filter(isTracked);
    return {
      total: list.length,
      lowStock: list.filter(m => m.low_stock === true && Number(m.stock_qty) > 0).length,
      outOfStock: list.filter(m => Number(m.stock_qty) <= 0).length
    };
  }, [materials, productItems]);

  // Handle Filtering Logic
  const listToRender = useMemo(() => {
    const rawList = Array.isArray(materials) ? materials : [];
    const allItems = [...rawList, ...productItems];
    
    // First filter by tab
    let filtered = activeTab === 'all_categories' ? allItems : allItems.filter(m => (m.item_category || 'ingredient') === activeTab);

    // Then filter by out/low
    if (activeFilter === 'out') return filtered.filter(m => isTracked(m) && Number(m?.stock_qty) <= 0);
    if (activeFilter === 'low') return filtered.filter(m => isTracked(m) && m?.low_stock === true && Number(m?.stock_qty) > 0);
    
    return filtered;
  }, [materials, productItems, activeFilter, activeTab]);

  const getStatus = (item) => {
    if (item?.madeToOrder) return { label: 'MADE TO ORDER', color: 'bg-gray-100 text-gray-600' };
    const qty = Number(item?.stock_qty ?? 0);
    // Below zero means more was sold than the count knew about. Sales never stop
    // for stock, so this is the signal to go and count it.
    if (qty < 0) return { label: 'BELOW ZERO — RECOUNT', color: 'bg-red-600 text-white' };
    if (qty <= 0) return { label: 'OUT OF STOCK', color: 'bg-red-100 text-red-600' };
    if (item?.low_stock) return { label: 'LOW STOCK', color: 'bg-yellow-100 text-yellow-600' };
    return { label: 'IN STOCK', color: 'bg-green-100 text-green-600' };
  };

  const ItemSkeleton = () => (
    <div className="bg-white p-5 rounded-xl border border-gray-100 flex justify-between items-center animate-pulse">
      <div className="flex-1 space-y-3">
        <div className="h-5 bg-gray-200 rounded w-1/4"></div>
        <div className="h-3 bg-gray-100 rounded w-1/6"></div>
        <div className="flex gap-12 pt-2"><div className="h-8 bg-gray-50 rounded w-20"></div></div>
      </div>
      <div className="h-10 bg-gray-100 rounded-lg w-32"></div>
    </div>
  );

  return (
    <>
      <Sidebar />
      <div style={{ marginLeft: "var(--sidebar-w, 240px)" }}>
        <Header title="Inventory Management" />

        <div className="p-8 bg-gray-50 min-h-screen">
          {/* STAT CARDS BASED ON IMAGE_A300BA.PNG */}
          <div className="flex gap-6 mb-8">
            <StatCard 
              title="Items Out of Stock"
              count={isLoading ? '...' : stats.outOfStock}
              subtitle="Immediate kitchen impact. Essential items are depleted."
              badgeText="Critical"
              badgeColor="bg-red-500"
              bgColor={activeFilter === 'out' ? 'bg-red-100 ring-2 ring-red-400' : 'bg-red-50'}
              textColor="text-red-700"
              icon="⭕"
              actionText="Reorder immediately"
              onClick={() => setActiveFilter(activeFilter === 'out' ? 'all' : 'out')}
            />
            <StatCard 
              title="Items Low Stock"
              count={isLoading ? '...' : stats.lowStock}
              subtitle="Replenish soon to avoid service disruption. Stocks under threshold."
              badgeText="Warning"
              badgeColor="bg-blue-600"
              bgColor={activeFilter === 'low' ? 'bg-blue-100 ring-2 ring-blue-400' : 'bg-blue-50'}
              textColor="text-blue-700"
              icon="⚠️"
              actionText="View Details"
              onClick={() => setActiveFilter(activeFilter === 'low' ? 'all' : 'low')}
            />
          </div>

          <div className="flex justify-between items-center mb-6">
            <div className="flex flex-col gap-4 w-full">
              {/* Tab switcher */}
              <div style={{ display: "flex", gap: "0", background: "#F1F5F9", borderRadius: "12px", padding: "4px", width: "fit-content" }}>
                {[
                  ["all_categories", "All Categories"],
                  ["ingredient", "Ingredients"],
                  ["product",    "Resale Products"],
                  ["supply",     "Hotel Supplies"],
                ].map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setActiveTab(type)}
                    style={{
                      padding: "8px 20px", border: "none", borderRadius: "10px", fontWeight: "600",
                      fontSize: "13px", cursor: "pointer", transition: "all 0.15s",
                      background: activeTab === type ? "#fff" : "transparent",
                      color: activeTab === type ? "#1565C0" : "#64748B",
                      boxShadow: activeTab === type ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              
              <div className="flex justify-between items-center w-full mt-2">
                <div className="flex items-center gap-4">
                  <h1 className="text-2xl font-bold text-gray-800">
                    {activeFilter === 'all' ? 'All Items' : 
                     activeFilter === 'low' ? 'Low Stock Items' : 'Out of Stock Items'}
                  </h1>
                  {activeFilter !== 'all' && (
                    <button 
                      onClick={() => setActiveFilter('all')}
                      className="text-sm text-blue-600 hover:underline font-medium"
                    >
                      Clear Filter
                    </button>
                  )}
                </div>
                <button
                  onClick={() => navigate(activeTab === 'product' ? '/branch-admin/products' : '/branch-admin/raw-ingredient')}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-lg active:scale-95"
                >
                  <span>+</span> Add New {activeTab === 'product' ? 'Product' : 'Item'}
                </button>
              </div>
            </div>
          </div>

          {fetchError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {fetchError} — showing cached data if available.
            </div>
          )}

          <div className="space-y-4">
            {isLoading ? (
              [...Array(5)].map((_, i) => <ItemSkeleton key={i} />)
            ) : listToRender.length > 0 ? (
              listToRender.map((item, idx) => {
                const status = getStatus(item);
                const key = item?.rm_id ?? item?.id ?? item?._id ?? idx;
                return (
                  <div key={key} className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex justify-between items-center hover:shadow-md transition-all duration-200">
                    <div className="flex-1">
                      <h3 className="font-bold text-lg text-gray-800">{item?.rm_name}</h3>
                      <p className="text-sm text-gray-500 mb-3">
                        {item?.isProduct ? (item.madeToOrder ? 'Made to order' : 'Resale product — counted in pieces') : `Unit: ${item?.unit}`}
                      </p>
                      <div className="flex gap-12">
                        <div>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{item?.isProduct && !item?.madeToOrder ? "Ready to sell" : "Current Stock"}</p>
                          <p className={`font-semibold ${Number(item?.stock_qty) < 0 ? 'text-red-600' : 'text-gray-700'}`}>{item?.madeToOrder ? '—' : item?.isProduct ? Number(item?.stock_qty ?? 0) : `${item?.stock_qty ?? 0} ${item?.unit}`}
                            {item?.madeToOrder && <span className="ml-2 text-xs font-normal text-gray-400">nothing is counted</span>}
                            {item?.fromRecipe && <span className="ml-2 text-xs font-normal text-gray-400">from ingredients</span>}</p>
                        </div>
                        {item.isProduct && !item.madeToOrder && item.storeroomQty != null && (
                          <div>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">In the storeroom</p>
                            <p className="font-semibold text-gray-700">{Number(item.storeroomQty)}</p>
                          </div>
                        )}
                        {!item.isProduct && (
                          <div>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Reorder Level</p>
                            <p className="font-semibold text-gray-700">{item?.record_level ?? 0} {item?.unit}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className={`px-4 py-1.5 rounded-full text-[11px] font-bold tracking-wide ${status.color}`}>
                        {status.label}
                      </span>
                      {!item.madeToOrder && !item.fromRecipe && (
                      <button
                        onClick={() => setCountingItem(item)}
                        title="Count what is on the shelf and correct the figure"
                        className="px-3 py-2 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all"
                      >
                        Count
                      </button>
                      )}
                      {item.isProduct ? (
                        <button
                          onClick={() => navigate('/branch-admin/products')}
                          className="px-4 py-2 text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all"
                        >
                          Manage Product
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => { setSelectedMaterial(item); setIsEditModalOpen(true); }}
                            className="p-2.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { setSelectedMaterial(item); setIsModalOpen(true); }}
                            className="flex items-center gap-2 px-4 py-2 bg-white hover:bg-blue-600 hover:text-white text-blue-600 font-medium rounded-lg border border-blue-600 transition-all group shadow-sm"
                          >
                            <span className="group-hover:rotate-12 transition-transform"></span> Reorder
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-20 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                <p className="text-gray-500 text-lg">No {activeFilter} items found.</p>
                <button onClick={() => setActiveFilter('all')} className="mt-2 text-blue-600 font-bold">Show all inventory</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <ReorderModal material={selectedMaterial} onClose={() => setIsModalOpen(false)} onSuccess={fetchInventory} />
      )}

      {isEditModalOpen && (
        <EditMaterialModal material={selectedMaterial} onClose={() => setIsEditModalOpen(false)} onSuccess={fetchInventory} setMaterials={setMaterials} />
      )}

      {countingItem && (
        <CountStockModal
          title={countingItem.rm_name}
          unit={countingItem.unit}
          current={countingItem.stock_qty}
          onClose={() => setCountingItem(null)}
          onSave={async (count) => {
            if (countingItem.isProduct) {
              await countBranchProduct(countingItem.rm_id, { counted: count, note: "Inventory Dashboard count" });
            } else {
              await countRawMaterial(countingItem.rm_id, { counted: count, note: "Inventory Dashboard count" });
            }
            await fetchInventory();
          }}
        />
      )}
    </>
  );
};

export default InventoryDashboard;
