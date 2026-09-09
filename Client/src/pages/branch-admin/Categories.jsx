import React, { useCallback, useEffect, useState } from "react";
import { FaPlus, FaPen, FaTrashAlt, FaCheck, FaTimes } from "react-icons/fa";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../../services/api";
import { card, input, btn, errorBox } from "../hotel/ui";

/**
 * Menu categories — the groups the till, the waiter tablet and the kitchen all
 * filter by. They belong to this company, so what is added here appears in
 * every property it runs and nowhere else.
 */
export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getCategories();
      setCategories(Array.isArray(data) ? data : []);
      setError("");
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load your categories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 3000);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;

    try {
      setAdding(true);
      setError("");
      await createCategory({ cat_name: name });
      setNewName("");
      flash(`Added "${name}"`);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not add that category.");
    } finally {
      setAdding(false);
    }
  };

  const handleRename = async (catId) => {
    const name = editingName.trim();
    if (!name) return;

    try {
      setBusyId(catId);
      setError("");
      await updateCategory(catId, { cat_name: name });
      setEditingId(null);
      flash("Renamed");
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not rename that category.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (cat) => {
    if (!window.confirm(`Delete the category "${cat.cat_name}"?`)) return;

    try {
      setBusyId(cat.cat_id);
      setError("");
      await deleteCategory(cat.cat_id);
      flash(`Deleted "${cat.cat_name}"`);
      await load();
    } catch (err) {
      // The server refuses while items are still filed under it, and says how
      // many — that message is more useful than anything invented here.
      setError(err?.response?.data?.message || "Could not delete that category.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#F4F7FB" }}>
      <Sidebar />
      <div style={{ flex: 1, marginLeft: "var(--sidebar-w, 240px)", display: "flex", flexDirection: "column" }}>
        <Header title="Menu Categories" />

        <main style={{ flex: 1, padding: 24, overflowY: "auto" }}>
          <div style={{ maxWidth: 720 }}>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748B" }}>
              These are the groups your menu is sorted into — on the till, the waiter
              tablet and the kitchen screen. Add as many as you need, then choose one
              for each item on the Menu&nbsp;/&nbsp;Products page.
            </p>

            {error && <div style={errorBox}>{error}</div>}
            {notice && (
              <div style={{
                background: "#ECFDF5", border: "1px solid #A7F3D0", color: "#047857",
                padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13,
              }}>
                {notice}
              </div>
            )}

            <form onSubmit={handleAdd} style={{ ...card, display: "flex", gap: 10, padding: 16, marginBottom: 18 }}>
              <input
                style={{ ...input, flex: 1 }}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New category name — Rice &amp; Curry, Short Eats, Beverages…"
                maxLength={50}
              />
              <button
                type="submit"
                disabled={adding || !newName.trim()}
                style={{ ...btn("primary"), opacity: adding || !newName.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}
              >
                <FaPlus size={11} style={{ marginRight: 6 }} />
                {adding ? "Adding…" : "Add Category"}
              </button>
            </form>

            <div style={{ ...card, overflow: "hidden" }}>
              {loading ? (
                <p style={{ padding: 20, margin: 0, fontSize: 13, color: "#64748B" }}>Loading…</p>
              ) : categories.length === 0 ? (
                <p style={{ padding: 24, margin: 0, fontSize: 13, color: "#64748B", textAlign: "center" }}>
                  No categories yet. Add your first one above.
                </p>
              ) : (
                categories.map((cat, i) => (
                  <div
                    key={cat.cat_id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "12px 16px",
                      borderTop: i === 0 ? "none" : "1px solid #F1F5F9",
                    }}
                  >
                    {editingId === cat.cat_id ? (
                      <>
                        <input
                          autoFocus
                          style={{ ...input, flex: 1 }}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(cat.cat_id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          maxLength={50}
                        />
                        <button
                          onClick={() => handleRename(cat.cat_id)}
                          disabled={busyId === cat.cat_id}
                          style={{ ...btn("success"), padding: "7px 12px" }}
                          title="Save"
                        >
                          <FaCheck size={11} />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          style={{ ...btn("ghost"), padding: "7px 12px" }}
                          title="Cancel"
                        >
                          <FaTimes size={11} />
                        </button>
                      </>
                    ) : (
                      <>
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1E293B" }}>
                          {cat.cat_name}
                        </span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, color: "#64748B",
                          background: "#F1F5F9", borderRadius: 20, padding: "3px 10px",
                        }}>
                          {cat.product_count ?? 0} item{Number(cat.product_count) === 1 ? "" : "s"}
                        </span>
                        <button
                          onClick={() => { setEditingId(cat.cat_id); setEditingName(cat.cat_name); }}
                          style={{ ...btn("ghost"), padding: "7px 12px" }}
                          title={`Rename ${cat.cat_name}`}
                        >
                          <FaPen size={11} />
                        </button>
                        <button
                          onClick={() => handleDelete(cat)}
                          disabled={busyId === cat.cat_id}
                          style={{ ...btn("danger"), padding: "7px 12px" }}
                          title={`Delete ${cat.cat_name}`}
                        >
                          <FaTrashAlt size={11} />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
