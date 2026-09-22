import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaSearch, FaClock } from "react-icons/fa";
import CashierHeader from "../../components/cashier/Header";
import { useAuth } from "../../context/AuthContext";
import { connectSocket } from "../../services/socket";
import { printKot } from "../../utils/printKot";
import {
	getBranchProducts,
	getOrderItems,
	getOrders,
	updateOrderStatus,
	getBranchById,
} from "../../services/api";

const statCards = [
    {
        key: "pending",
        title: "Pending",
        subtitle: "Items waiting",
        tone: "from-amber-100 to-yellow-200",
        accent: "text-amber-600",
        border: "border-amber-300",
        titleStyles: "font-sans font-medium text-sm tracking-wider uppercase",
        subtitleStyles: "font-sans font-semibold text-[12px] text-slate-500",
    },
    {
        key: "preparing",
        title: "Preparing",
        subtitle: "In progress",
        tone: "from-orange-100 to-orange-200",
        accent: "text-orange-600",
        border: "border-orange-300",
        titleStyles: "font-sans font-medium text-sm tracking-wider uppercase", 
        subtitleStyles: "font-sans font-semibold text-[12px] text-slate-500",
    },
    {
        key: "ready",
        title: "Ready",
        subtitle: "Ready to serve",
        tone: "from-emerald-100 to-emerald-200",
        accent: "text-emerald-600",
        border: "border-emerald-300",
        titleStyles: "font-sans font-medium text-sm tracking-wider uppercase",
        subtitleStyles: "font-sans font-normal text-[12px] text-slate-500",
    },
    {
        key: "active",
        title: "Active Orders",
        subtitle: "Total orders",
        tone: "from-sky-100 to-indigo-100",
        accent: "text-indigo-600",
        border: "border-indigo-300",
        titleStyles: "font-sans font-medium text-sm tracking-wider uppercase",
        subtitleStyles: "font-sans font-normal text-[12px] text-slate-500",
    },
];

const statusPalette = {
	Pending: "bg-slate-100 text-[12px] font-semibold text-slate-700 border-slate-200",
	Preparing: "bg-orange-100 text-[12px] font-semibold text-orange-700 border-orange-200",
	Completed: "bg-emerald-100 text-[12px] font-semibold text-emerald-700 border-emerald-200",
	Declined: "bg-rose-100 text-[12px] font-semibold text-rose-700 border-rose-200",
};



// Two things worth remembering between visits: whether tickets print by
// themselves, and which orders have already been put on paper.
const AUTO_PRINT_KEY = "kitchen.autoPrintKot";
const printedKey = (branchId) => `kitchen.printedKot:${branchId ?? "all"}`;

const KitchenManagement = () => {
	const { user } = useAuth();
	const [orders, setOrders] = useState([]);
	const [orderItems, setOrderItems] = useState([]);
	const [branchProducts, setBranchProducts] = useState([]);
	const [searchTerm, setSearchTerm] = useState("");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [updatingOrderId, setUpdatingOrderId] = useState(null);
	const [branchName, setBranchName] = useState("");

	// Track statuses confirmed by local user actions so a socket-triggered
	// silent refresh cannot revert them before the DB propagates.
	const confirmedStatuses = useRef({});

	// Tickets print themselves as orders arrive. This screen stands by the pass
	// and is the one with the printer, so this is where it belongs: nobody
	// should have to watch a list and press Print.
	const [autoPrint, setAutoPrint] = useState(() => {
		try {
			return localStorage.getItem(AUTO_PRINT_KEY) !== "off";
		} catch {
			return true;
		}
	});
	// Orders already on paper, remembered across reloads so refreshing the
	// screen does not reprint the whole board.
	const printedRef = useRef(new Set());
	const seededRef = useRef(false);

	useEffect(() => {
		let isMounted = true;
		let refreshTimer = null;
		const socket = connectSocket();

		const loadData = async (silent = false) => {
			if (!isMounted) return;
			if (!silent) setLoading(true);
			setError("");

			try {
				const params = {};
				if (user?.b_id) params.b_id = user.b_id;

				const [ordersData, itemsResult, productsResult] =
					await Promise.allSettled([
						getOrders(params),
						getOrderItems(user?.b_id ? { b_id: user.b_id } : {}),
						user?.b_id ? getBranchProducts(user.b_id) : getBranchProducts(),
					]);

				if (!isMounted) return;

				if (ordersData.status === "fulfilled") {
					const freshOrders = Array.isArray(ordersData.value) ? ordersData.value : [];
					// Use functional updater so we always have access to current orders
					// (avoids stale-closure issues inside the async loadData call).
					setOrders((currentOrders) => {
						const pending = confirmedStatuses.current;
						if (Object.keys(pending).length === 0) return freshOrders;

						const freshIds = new Set(freshOrders.map((o) => o.or_id));

						// Apply confirmed statuses to orders that exist in fresh data
						const merged = freshOrders.map((o) =>
							pending[o.or_id] !== undefined
								? { ...o, or_status: pending[o.or_id] }
								: o,
						);

						// Keep orders we confirmed locally that are missing from fresh data
						// (handles the case where the backend b_id filter excludes the order)
						const ghosts = [];
						Object.entries(pending).forEach(([id, status]) => {
							const numId = Number(id);
							if (!freshIds.has(numId)) {
								const ghost = currentOrders.find((o) => o.or_id === numId);
								if (ghost) ghosts.push({ ...ghost, or_status: status });
							}
						});

						return [...merged, ...ghosts];
					});
				} else if (!silent) {
					setOrders([]);
					setError("Failed to load orders.");
				}

				if (itemsResult.status === "fulfilled") {
					const newItems = Array.isArray(itemsResult.value) ? itemsResult.value : [];
					// In silent mode, never wipe existing items with an empty result –
					// an empty return likely means a transient error or auth hiccup.
					if (newItems.length > 0 || !silent) {
						setOrderItems(newItems);
					}
				}

				if (productsResult.status === "fulfilled") {
					setBranchProducts(
						Array.isArray(productsResult.value) ? productsResult.value : [],
					);
				}
			} catch (err) {
				if (!isMounted) return;
				if (!silent) {
					setOrders([]);
					setOrderItems([]);
					setBranchProducts([]);
					setError("Failed to load kitchen data.");
				}
			} finally {
				if (isMounted && !silent) setLoading(false);
			}
		};

		const scheduleRefresh = (silent = true) => {
			if (refreshTimer) window.clearTimeout(refreshTimer);
			refreshTimer = window.setTimeout(() => loadData(silent), 1000);
		};

		loadData(false);

		socket.on("order:created", () => scheduleRefresh(true));
		socket.on("order:updated", () => scheduleRefresh(true));
		socket.on("order:deleted", () => scheduleRefresh(true));

		return () => {
			isMounted = false;
			if (refreshTimer) window.clearTimeout(refreshTimer);
			socket.off("order:created");
			socket.off("order:updated");
			socket.off("order:deleted");
		};
	}, [user]);

	const branchProductMap = useMemo(() => {
		return branchProducts.reduce((acc, product) => {
			acc[product.Bpro_id] = product;
			return acc;
		}, {});
	}, [branchProducts]);

	const itemsByOrderId = useMemo(() => {
		return orderItems.reduce((acc, item) => {
			const product = branchProductMap[item.Bpro_id];
			const stations = product?.stations || {};

			// --- THE FIX FOR PREMADE FOODS ---
			// 1. If Kitchen is explicitly false, hide it.
			// 2. If the item is marked for Bar and NOT explicitly Kitchen, hide it.
			if (stations.Kitchen === false) return acc;
			if (stations.Bar === true && stations.Kitchen !== true) return acc;

			const orderId = item.order_id;
			if (!acc[orderId]) acc[orderId] = [];
			acc[orderId].push(item);
			return acc;
		}, {});
	}, [orderItems, branchProductMap]);

	const filteredOrders = useMemo(() => {
		const query = searchTerm.trim().toLowerCase();

		// Only show orders that have items requiring kitchen preparation
		const withKitchenPrep = orders.filter((order) => {
			const items = itemsByOrderId[order.or_id] || [];
			return items.length > 0;
		});

		if (!query) return withKitchenPrep;

		return withKitchenPrep.filter((order) => {
			if (String(order.or_id ?? "").includes(query)) return true;

			const items = itemsByOrderId[order.or_id] || [];
			return items.some((item) => {
				const product = branchProductMap[item.Bpro_id] || {};
				return String(product.pro_name || "")
					.toLowerCase()
					.includes(query);
			});
		});
	}, [orders, searchTerm, itemsByOrderId, branchProductMap]);

	const statusCounts = useMemo(() => {
		const counts = { pending: 0, preparing: 0, ready: 0 };

		filteredOrders.forEach((order) => {
			if (order.or_status === "pending") counts.pending += 1;
			if (order.or_status === "preparing") counts.preparing += 1;
			if (order.or_status === "completed") counts.ready += 1;
		});

		return {
			pending: counts.pending,
			preparing: counts.preparing,
			ready: counts.ready,
			active: counts.pending + counts.preparing,
		};
	}, [filteredOrders]);

	const sortedOrders = useMemo(() => {
		const toTimestamp = (order) => {
			const dateValue = order?.or_date || order?.created_at || order?.createdAt || null;
			const timeValue = order?.or_time || "";

			if (dateValue) {
				const dateOnly = String(dateValue).split("T")[0];
				if (timeValue) {
					const combined = new Date(`${dateOnly}T${timeValue}`);
					if (!Number.isNaN(combined.getTime())) return combined.getTime();
				}

				const parsed = new Date(dateValue);
				if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
			}

			return 0;
		};

		return [...filteredOrders].sort((a, b) => {
			const delta = toTimestamp(b) - toTimestamp(a);
			if (delta !== 0) return delta;
			return Number(b?.or_id || 0) - Number(a?.or_id || 0);
		});
	}, [filteredOrders]);

	const pendingOrders = useMemo(
		() => sortedOrders.filter((order) => order.or_status === "pending"),
		[sortedOrders],
	);

	const acceptedOrders = useMemo(
		() => sortedOrders.filter((order) => order.or_status === "preparing"),
		[sortedOrders],
	);

	const rejectedOrders = useMemo(
		() => sortedOrders.filter((order) => order.or_status === "cancelled"),
		[sortedOrders],
	);

	const renderOrderCard = (order) => {
		const statusLabel = getStatusLabel(order);
		const tagStyle = statusPalette[statusLabel] || statusPalette.Pending;
		const isPending = order.or_status === "pending";
		const isPreparing = order.or_status === "preparing";

		return (
			<div
				key={order.or_id}
				className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4"
			>
				<div className="flex flex-col gap-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<div className="text-sm font-semibold text-slate-900">
								ORD{String(order.or_id).padStart(5, "0")}
							</div>
							<div className="text-[12px] font-semibold text-slate-500">
								{order.or_type || "Dine in"} | {order.or_time?.slice(0, 5) || "--:--"}
							</div>
						</div>

						<div className="flex items-center gap-2">
							<span
								className={`px-2 py-1 rounded-full text-[10px] font-semibold border ${tagStyle}`}
							>
								{statusLabel}
							</span>
							<span className="text-[12px] text-slate-400 flex items-center gap-1">
								<FaClock />
								<span>{order.or_time?.slice(0, 5) || "--:--"}</span>
							</span>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						{renderOrderItems(order.or_id)}
						{order.kitchen_note && (
							<div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
								{order.kitchen_note}
							</div>
						)}
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<button
							onClick={() => handlePrintKot(order)}
							title="Print this ticket again"
							className="px-4 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-semibold cursor-pointer transition-colors duration-200 hover:bg-slate-900 hover:text-white hover:border-slate-900"
						>
							Print KOT
						</button>

						{isPending && (
							<>
								<button
									onClick={() => updateStatus(order.or_id, "preparing")}
									disabled={updatingOrderId === order.or_id}
									className="px-5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-100 text-emerald-700 text-sm font-semibold cursor-pointer transition-colors duration-200 hover:bg-emerald-300 hover:text-emerald-800 hover:border-emerald-300"
								>
									Accept
								</button>
								<button
									onClick={() => updateStatus(order.or_id, "cancelled")}
									disabled={updatingOrderId === order.or_id}
									className="px-5 py-1.5 rounded-lg border border-rose-200 bg-rose-100 text-rose-600 text-sm font-semibold cursor-pointer transition-colors duration-200 hover:bg-rose-300 hover:text-rose-800 hover:border-rose-300"
								>
									Decline
								</button>
							</>
						)}

						{isPreparing && (
							<button
								onClick={() => updateStatus(order.or_id, "completed")}
								disabled={updatingOrderId === order.or_id}
								className="px-4 py-1.5 rounded-lg border border-emerald-200 bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
							>
								Ready
							</button>
						)}
					</div>
				</div>
			</div>
		);
	};

	const renderOrderColumn = (title, ordersInColumn) => {
		return (
			<div className="flex flex-col gap-3">
				<div className="flex items-center justify-between">
					<h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
						{title}
					</h2>
					<span className="text-xs text-slate-400">
						{ordersInColumn.length}
					</span>
				</div>
				{ordersInColumn.length ? (
					ordersInColumn.map(renderOrderCard)
				) : (
					<div className="text-sm text-slate-500">No orders</div>
				)}
			</div>
		);
	};

	const updateStatus = async (orderId, nextStatus) => {
		if (!orderId || updatingOrderId) return;

		// Store previous state for rollback
		const previousOrders = [...orders];

		// Optimistic Update
		setOrders((prev) =>
			prev.map((order) =>
				order.or_id === orderId ? { ...order, or_status: nextStatus } : order,
			),
		);

		setUpdatingOrderId(orderId);
		setError("");

		try {
			const updated = await updateOrderStatus(orderId, nextStatus);
			const confirmedStatus = updated?.data?.or_status ?? updated?.or_status ?? nextStatus;

			// Lock this status so that any simultaneous socket-triggered silent
			// refresh cannot revert the order back to its previous state.
			confirmedStatuses.current[orderId] = confirmedStatus;
			// For terminal statuses, release the lock after a short delay so
			// subsequent refreshes can show the canonical server state.
			if (confirmedStatus === "completed" || confirmedStatus === "cancelled") {
				setTimeout(() => delete confirmedStatuses.current[orderId], 5000);
			}

			setOrders((prev) =>
				prev.map((order) =>
					order.or_id === orderId
						? { ...order, or_status: confirmedStatus }
						: order,
				),
			);
		} catch (err) {
			// Rollback on error and clear any confirmed lock
			delete confirmedStatuses.current[orderId];
			setOrders(previousOrders);
			setError(
				err?.response?.data?.error ||
					err?.response?.data?.message ||
					"Failed to update order status.",
			);
		} finally {
			setUpdatingOrderId(null);
		}
	};

	const getStatusLabel = (order) => {
		if (order.or_status === "preparing") return "Preparing";
		if (order.or_status === "completed") return "Completed";
		if (order.or_status === "cancelled") return "Declined";
		return "Pending";
	};


	// The kitchen prints its own copy of the same ticket the till prints — the
	// paper on the pass has to match the paper at the counter.
	const ticketFor = (order) =>
		(itemsByOrderId[order.or_id] || []).map((item) => {
			const product = branchProductMap[item.Bpro_id] || {};
			return {
				name: product.pro_name || `Item ${item.Bpro_id}`,
				qty: item.pro_quantity ?? 1,
				note: item.notes || "",
			};
		});

	const handlePrintKot = (order) => {
		printKot(order, ticketFor(order), {
			branchName: branchName || "",
			// Anything printed by hand is a second copy: the ticket printed
			// itself when the order came in.
			reprint: true,
		});
	};

	// An order that arrives puts itself on paper, once.
	//
	// The first pass after the screen opens only takes note of what is already
	// on the board — reloading the page must not reprint the lunch rush. After
	// that, every order that arrives with something to cook prints one ticket.
	useEffect(() => {
		if (loading) return;
		const branchId = user?.b_id ?? user?.B_id ?? null;
		const printed = printedRef.current;
		const firstPass = !seededRef.current;

		if (firstPass) {
			try {
				const saved = JSON.parse(localStorage.getItem(printedKey(branchId)) || "[]");
				for (const id of saved) printed.add(Number(id));
			} catch {
				// A lost list costs one extra ticket, nothing worse.
			}
		}

		const waiting = orders.filter(
			(order) =>
				order.or_status === "pending" && (itemsByOrderId[order.or_id] || []).length > 0,
		);
		const fresh = waiting.filter((order) => !printed.has(Number(order.or_id)));
		for (const order of fresh) printed.add(Number(order.or_id));
		if (fresh.length) {
			try {
				localStorage.setItem(printedKey(branchId), JSON.stringify([...printed].slice(-300)));
			} catch {
				// Not being able to remember only means a repeat after a reload.
			}
		}

		seededRef.current = true;
		if (firstPass || !autoPrint || !fresh.length) return;

		// One at a time. Two print dialogs at once is one too many.
		fresh.reduce(
			(wait, order) =>
				wait.then(
					() =>
						new Promise((resolve) => {
							printKot(order, ticketFor(order), {
								branchName: branchName || "",
								reprint: false,
							});
							window.setTimeout(resolve, 1200);
						}),
				),
			Promise.resolve(),
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loading, orders, itemsByOrderId, branchProductMap, branchName, autoPrint, user]);

	// The property name is printed on every ticket.
	useEffect(() => {
		const branchId = user?.b_id ?? user?.B_id ?? null;
		if (!branchId) return;
		let alive = true;
		getBranchById(branchId)
			.then((res) => { if (alive) setBranchName(res?.B_name ?? res?.data?.B_name ?? ""); })
			.catch(() => { if (alive) setBranchName(""); });
		return () => { alive = false; };
	}, [user?.b_id, user?.B_id]);

	const renderOrderItems = (orderId) => {
		const items = itemsByOrderId[orderId] || [];
		if (!items.length) {
			return (
				<div className="text-xs text-slate-400 italic">
					Items not available
				</div>
			);
		}

		return items.map((item) => {
			const product = branchProductMap[item.Bpro_id] || {};
			const name = product.pro_name || `Item ${item.Bpro_id}`;
			const quantity = item.pro_quantity ?? "-";
			const image = product.pro_image || "";

			return (
				<div
					key={item.orderItem_id}
					className="flex gap-3 items-center rounded-xl border border-slate-100 bg-white px-3 py-2"
				>
					<div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden flex items-center justify-center">
						{image ? (
							<img src={image} alt={name} className="w-full h-full object-cover" />
						) : (
							<span className="text-xs text-slate-500">IMG</span>
						)}
					</div>
					<div className="flex-1">
						<div className="text-sm font-semibold text-slate-900">{name}</div>
						<div className="text-[11px] text-slate-500">Qty: {quantity}</div>
					</div>
				</div>
			);
		});
	};

	return (
		<div className="min-h-screen bg-[#F4F7FB] flex flex-col">
			<CashierHeader />

			<main className="flex-1">
				<div className="max-w-none mx-0 px-4 sm:px-6 py-6">
					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
						<div>
							<h1 className="text-xl sm:text-2xl font-semibold text-slate-900">
								Kitchen Order Management
							</h1>
							<p className="text-xs sm:text-sm text-slate-500 mt-1">
								Manage and track all incoming orders
							</p>
						</div>

						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => {
									const next = !autoPrint;
									setAutoPrint(next);
									try {
										localStorage.setItem(AUTO_PRINT_KEY, next ? "on" : "off");
									} catch {
										// The screen still works; it just forgets by tomorrow.
									}
								}}
								title={
									autoPrint
										? "Every new order prints a ticket as it arrives"
										: "Tickets print only when you press Print on an order"
								}
								className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
									autoPrint
										? "border-emerald-200 bg-emerald-50 text-emerald-700"
										: "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
								}`}
							>
								<span
									className={`h-2 w-2 rounded-full ${autoPrint ? "bg-emerald-500" : "bg-slate-300"}`}
								/>
								Auto-print tickets: {autoPrint ? "on" : "off"}
							</button>
						</div>
					</div>

					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
						{statCards.map((card) => (
							<div
								key={card.key}
								className={`rounded-2xl border ${card.border} bg-gradient-to-br ${card.tone} p-4 shadow-sm`}
							>
								<div className={card.titleStyles || "text-[11px] uppercase tracking-wide text-slate-500"}>
									{card.title}
								</div>
								<div className={`text-1xl font-semibold ${card.accent} mt-2`}>
									{statusCounts[card.key]}
								</div>
								<div className={card.subtitleStyles || "text-[11px] text-slate-500 mt-1"}>
									{card.subtitle}
								</div>
							</div>
						))}
					</div>

					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
						<div className="relative w-full sm:w-72">
							<FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
							<input
								value={searchTerm}
								onChange={(event) => setSearchTerm(event.target.value)}
								placeholder="Search items..."
								className="w-full rounded-xl border border-slate-200 bg-white px-9 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-200"
							/>
						</div>
					</div>

					{error && (
						<div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-600">
							{error}
						</div>
					)}

					{loading ? (
						<div className="text-sm text-slate-500">Loading orders...</div>
					) : (
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
							{renderOrderColumn("Received orders", pendingOrders)}
							{renderOrderColumn("Accepted orders", acceptedOrders)}
							{renderOrderColumn("Rejected orders", rejectedOrders)}
						</div>
					)}
				</div>
			</main>
		</div>
	);
};

export default KitchenManagement;