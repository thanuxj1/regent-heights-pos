import React, { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
	Chart as ChartJS,
	CategoryScale,
	LinearScale,
	BarElement,
	PointElement,
	LineElement,
	ArcElement,
	Tooltip,
	Legend,
	Filler,
} from "chart.js";
import { FaDownload } from "react-icons/fa";
import Sidebar from "../../components/branch-admin/Sidebar";
import Header from "../../components/branch-admin/Header";
import { useAuth } from "../../context/AuthContext";
import { getOrders, getUsers, getReportTransactions } from "../../services/api";
import { dayKey, dayOffset } from "../../utils/dates";
import topPerformerIcon from "../../assets/images/top performer.png";
import timeIcon from "../../assets/images/time.png";
import salesIcon from "../../assets/images/sales.png";

ChartJS.register(
	CategoryScale,
	LinearScale,
	BarElement,
	PointElement,
	LineElement,
	ArcElement,
	Tooltip,
	Legend,
	Filler,
);

const formatCurrency = (value) => {
	const number = Number(value || 0);
	if (Number.isNaN(number)) return "LKR 0.00";
	return `LKR ${number.toFixed(2)}`;
};

// The hotel's calendar day — see utils/dates.js for why toISOString().slice(0, 10) was wrong.
const getDateKey = (date) => dayKey(date);

// How long an order took from being placed to being completed, in minutes.
const minutesToComplete = (order) => {
	if (!order?.status_changed_at || !order?.or_time || !order?.or_date) return null;
	const start = new Date(`${dayKey(order.or_date)}T${String(order.or_time).slice(0, 8)}`);
	const minutes = (new Date(order.status_changed_at) - start) / 60000;
	return Number.isFinite(minutes) && minutes >= 0 && minutes <= 720 ? minutes : null;
};

const CashierPerformance = () => {
	const { user } = useAuth();
	const [orders, setOrders] = useState([]);
	const [users, setUsers] = useState([]);
	const [hotelPayments, setHotelPayments] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState("");
	const [timeRange, setTimeRange] = useState("30days");
	const [page, setPage] = useState(1);
	const PAGE_SIZE = 6;

	useEffect(() => {
		let isMounted = true;

		const loadData = async () => {
			setIsLoading(true);
			setError("");

			const params = { status: "completed" };
			if (user?.b_id) {
				params.b_id = user.b_id;
			}

			// The front desk takes money too — room deposits and settlements are the same
			// till work, so they count toward whoever received them.
			const hotelReq = user?.b_id
				? getReportTransactions({ b_id: user.b_id, kind: "hotel", from: dayOffset(-29), to: dayOffset(0) })
				: Promise.resolve({ transactions: [] });
			const results = await Promise.allSettled([getOrders(params), getUsers(), hotelReq]);

			if (!isMounted) return;

			const [ordersResult, usersResult, hotelResult] = results;
			const nextOrders = ordersResult.status === "fulfilled" ? ordersResult.value : [];
			const nextUsers = usersResult.status === "fulfilled" ? usersResult.value : [];

			setOrders(Array.isArray(nextOrders) ? nextOrders : []);
			setUsers(Array.isArray(nextUsers) ? nextUsers : []);
			const nextHotel = hotelResult.status === "fulfilled" ? hotelResult.value?.transactions : [];
			setHotelPayments(Array.isArray(nextHotel) ? nextHotel : []);

			if (results.some((result) => result.status === "rejected")) {
				setError("Some performance data could not be loaded.");
			}

			setIsLoading(false);
		};

		loadData();

		return () => {
			isMounted = false;
		};
	}, [user?.b_id]);

	const rangeDays = useMemo(() => {
		const counts = { today: 1, weekly: 7, monthly: 30, "30days": 30 };
		const total = counts[timeRange] || 30;
		const days = [];
		for (let i = total - 1; i >= 0; i -= 1) {
			const date = new Date();
			date.setDate(date.getDate() - i);
			const key = dayKey(date);
			const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
			days.push({ key, label });
		}
		return days;
	}, [timeRange]);

	const rangeKeys = useMemo(() => new Set(rangeDays.map((day) => day.key)), [rangeDays]);

	const rangeOrders = useMemo(() => {
		return orders.filter((order) => rangeKeys.has(getDateKey(order?.or_date)));
	}, [orders, rangeKeys]);

	// Room payments taken in this range, by the person who took them.
	const rangeHotel = useMemo(
		() => hotelPayments.filter((t) => t?.handled_by_id && rangeKeys.has(dayKey(t.at))),
		[hotelPayments, rangeKeys],
	);

	// Cashiers, plus anyone else who rang up a sale or took a room payment in this range.
	// Only role-3 accounts were counted, so an owner's or a front-desk person's takings
	// vanished from every total.
	const cashierUsers = useMemo(() => {
		const sellers = new Set([
			...rangeOrders.map((order) => order?.u_id),
			...rangeHotel.map((t) => t.handled_by_id),
		].filter(Boolean));
		return users.filter((item) => Number(item?.role_id) === 3 || sellers.has(item?.u_id));
	}, [users, rangeOrders, rangeHotel]);

	const cashierStats = useMemo(() => {
		const totals = new Map();
		rangeOrders.forEach((order) => {
			const cashierId = order?.u_id;
			if (!cashierId) return;
			const total = Number(order.or_totalCostWtax ?? order.or_totalcost ?? 0);
			const entry = totals.get(cashierId) || { revenue: 0, orders: 0 };
			entry.revenue += Number.isNaN(total) ? 0 : total;
			entry.orders += 1;
			totals.set(cashierId, entry);
		});

		return cashierUsers.map((cashier) => {
			const metrics = totals.get(cashier.u_id) || { revenue: 0, orders: 0 };
			const avgOrder = metrics.orders ? metrics.revenue / metrics.orders : 0;
			const mine = rangeHotel.filter((t) => t.handled_by_id === cashier.u_id);
			// refunds go back out of the till
			const hotel = mine.reduce((sum, t) => sum + (t.direction === "out" ? -1 : 1) * Number(t.amount || 0), 0);
			return {
				id: cashier.u_id,
				name:
					`${cashier.u_fname || ""} ${cashier.u_lname || ""}`.trim() || "Staff",
				sales: metrics.revenue,
				hotel,
				hotelCount: mine.length,
				revenue: metrics.revenue + hotel,
				orders: metrics.orders,
				avgOrder,
			};
		});
	}, [cashierUsers, rangeOrders, rangeHotel]);

	const sortedCashiers = useMemo(() => {
		return [...cashierStats].sort((a, b) => b.revenue - a.revenue);
	}, [cashierStats]);

	const totalRevenue = useMemo(() => {
		return sortedCashiers.reduce((sum, cashier) => sum + cashier.revenue, 0);
	}, [sortedCashiers]);

	const totalOrders = useMemo(() => {
		return sortedCashiers.reduce((sum, cashier) => sum + cashier.orders, 0);
	}, [sortedCashiers]);

	// The average restaurant order — room payments are not orders.
	const avgOrderValue = useMemo(() => {
		if (!totalOrders) return 0;
		return sortedCashiers.reduce((sum, c) => sum + c.sales, 0) / totalOrders;
	}, [sortedCashiers, totalOrders]);

	const topCashier = sortedCashiers[0];

	// Measured from the orders, not a constant: order placed to order completed.
	const avgProcessingTime = useMemo(() => {
		const times = rangeOrders.map(minutesToComplete).filter((m) => m !== null);
		if (!times.length) return "--";
		const seconds = Math.round((times.reduce((sum, m) => sum + m, 0) / times.length) * 60);
		return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
	}, [rangeOrders]);

	const exportCsv = () => {
		if (!sortedCashiers.length) return;
		const quote = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
		const rows = [
			["Rank", "Staff", "Restaurant orders", "Restaurant sales (LKR)", "Room payments", "Room payments taken (LKR)", "Total collected (LKR)", "Average order (LKR)"],
			...sortedCashiers.map((c, i) => [i + 1, c.name, c.orders, c.sales.toFixed(2), c.hotelCount, c.hotel.toFixed(2), c.revenue.toFixed(2), c.avgOrder.toFixed(2)]),
		];
		const csv = rows.map((r) => r.map(quote).join(",")).join("\n");
		const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = `cashier-performance_${rangeDays[0]?.key}_to_${rangeDays[rangeDays.length - 1]?.key}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const revenueChartData = useMemo(() => {
		const topEntries = sortedCashiers.slice(0, 6);
		return {
			labels: topEntries.map((entry) => {
				const parts = entry.name.split(" ");
				const first = parts[0] || "Staff";
				const last = parts[1] ? `${parts[1][0]}.` : "";
				return `${first} ${last}`.trim();
			}),
			datasets: [
				{
					label: "Restaurant sales",
					data: topEntries.map((entry) => entry.sales),
					backgroundColor: "#0D5EA8",
					barThickness: 26,
				},
				{
					label: "Room payments taken",
					data: topEntries.map((entry) => entry.hotel),
					backgroundColor: "#22C55E",
					barThickness: 26,
				},
			],
		};
	}, [sortedCashiers]);

	const barOptions = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: { legend: { display: false }, tooltip: { enabled: true } },
		scales: {
			x: { stacked: true, grid: { display: false }, ticks: { color: "#94A3B8", font: { size: 10 } } },
			y: { stacked: true, display: false, grid: { display: false } },
		},
	};

	const pageCount = Math.max(1, Math.ceil(sortedCashiers.length / PAGE_SIZE));
	const safePage = Math.min(page, pageCount);
	const pageStart = (safePage - 1) * PAGE_SIZE;
	const pageRows = sortedCashiers.slice(pageStart, pageStart + PAGE_SIZE);

	const statusForCashier = (cashier, index) => {
		if (index === 0) return { label: "Top Performer", color: "bg-green-100 text-green-700" };
		if (cashier.orders > 0 && cashier.sales >= avgOrderValue * cashier.orders) {
			return { label: "High Efficiency", color: "bg-emerald-100 text-emerald-700" };
		}
		if (cashier.revenue >= totalRevenue * 0.2) {
			return { label: "Steady", color: "bg-sky-100 text-sky-700" };
		}
		return { label: "Needs Attention", color: "bg-rose-100 text-rose-700" };
	};

	return (
		<>
			<Sidebar />
			<div style={{ marginLeft: "var(--sidebar-w, 240px)", background: "#F4F6FB", minHeight: "100vh" }}>
				<Header title="Cashier Performance" showAddUserIcon={false} />

				<div className="p-8">
					<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
						<h2 className="text-[22px] font-bold text-slate-900">Cashier Performance</h2>
						<div className="flex items-center gap-3">
							<label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm">
								<span className="text-slate-400">📅</span>
								<select
									value={timeRange}
									onChange={(e) => { setTimeRange(e.target.value); setPage(1); }}
									className="bg-transparent text-xs font-semibold text-slate-600 outline-none"
									aria-label="Date range"
								>
									<option value="today">Today</option>
									<option value="weekly">Last 7 days</option>
									<option value="30days">Last 30 days</option>
								</select>
							</label>
							<button
								type="button"
								onClick={exportCsv}
								disabled={!sortedCashiers.length}
								className="flex items-center gap-2 rounded-full bg-[#0D5EA8] px-4 py-2 text-xs font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-50"
							>
								<FaDownload />
								Export Report
							</button>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
						<div
							className="rounded-2xl px-5 py-4 flex items-center gap-4"
							style={{ backgroundColor: "#B7F5BC" }}
						>
							<div className="w-10 h-10 rounded-full  flex items-center justify-center">
								<img
									src={topPerformerIcon}
									alt="Top performer"
									className="h-10 w-10 object-contain"
								/>
							</div>
							<div>
								<div className="text-xs font-semibold text-gray-700">Top Performer</div>
								<div className="text-sm font-semibold text-slate-900">
									{isLoading ? "..." : topCashier?.name || "-"}
								</div>
							</div>
						</div>

						<div
							className="rounded-2xl px-5 py-4 flex items-center gap-4"
							style={{ backgroundColor: "#FFC0D4" }}
						>
							<div className="w-10 h-10 rounded-full flex items-center justify-center">
								<img
									src={timeIcon}
									alt="Average processing time"
									className="h-10 w-10 object-contain"
								/>
							</div>
							<div>
								<div className="text-xs font-semibold text-gray-700">AVG Processing Time</div>
								<div className="text-sm font-semibold text-slate-900">
									{isLoading ? "..." : avgProcessingTime}
								</div>
							</div>
						</div>

						<div
							className="rounded-2xl px-5 py-4 flex items-center gap-4"
							style={{ backgroundColor: "#A8E6FF" }}
						>
							<div className="w-10 h-10 rounded-full  flex items-center justify-center">
								<img
									src={salesIcon}
									alt="Total collected"
									className="h-10 w-10 object-contain"
								/>
							</div>
							<div>
								<div className="text-xs font-semibold text-gray-700">Total Collected</div>
								<div className="text-sm font-semibold text-slate-900">
									{isLoading ? "..." : formatCurrency(totalRevenue)}
								</div>
							</div>
						</div>
					</div>

					{error && (
						<div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
							{error}
						</div>
					)}

					<div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm mb-6">
						<div className="flex items-center justify-between">
							<div>
								<h3 className="text-sm font-semibold text-slate-900">Takings by Staff Member</h3>
								<p className="text-xs text-slate-400">Restaurant sales and room payments taken, per staff member</p>
							</div>
							<div className="flex items-center gap-2 text-xs text-slate-500">
								<span className="h-2 w-2 rounded-full bg-[#0D5EA8]" />
								Restaurant sales
								<span className="ml-3 h-2 w-2 rounded-full bg-[#22C55E]" />
								Room payments taken
							</div>
						</div>
						<div className="h-56 mt-4">
							{isLoading ? (
								<div className="h-full rounded-xl bg-slate-50 animate-pulse" />
							) : (
								<Bar data={revenueChartData} options={barOptions} />
							)}
						</div>
					</div>

					<div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
						<div className="mb-4">
							<h4 className="text-sm font-semibold text-slate-900">Detailed Performance Metrics</h4>
						</div>

						<div className="overflow-x-auto">
							<table className="min-w-full text-xs">
								<thead>
									<tr className="text-slate-400 text-[11px] text-left border-b">
										<th className="py-3">Cashier Name</th>
										<th className="py-3">Restaurant orders</th>
										<th className="py-3">Restaurant sales</th><th className="py-3">Room payments taken</th><th className="py-3">Total</th>
										<th className="py-3">Performance Status</th>
									</tr>
								</thead>
								<tbody>
									{sortedCashiers.length === 0 && !isLoading && (
										<tr>
											<td colSpan="6" className="py-4 text-slate-500">
												No cashier data available.
											</td>
										</tr>
									)}
									{(isLoading ? Array.from({ length: 4 }) : pageRows).map((cashier, index) => {
										if (!cashier) {
											return (
												<tr key={`cashier-row-${index}`} className="border-b">
													<td colSpan="6" className="py-4">
														<div className="h-4 bg-slate-100 rounded animate-pulse" />
													</td>
												</tr>
											);
										}

										const status = statusForCashier(cashier, pageStart + index);
										const initials = cashier.name
											.split(" ")
											.map((part) => part[0])
											.join("")
											.slice(0, 2)
											.toUpperCase();

										return (
											<tr key={cashier.id} className="border-b last:border-b-0">
												<td className="py-3">
													<div className="flex items-center gap-3">
														<div className="w-9 h-9 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-[11px] font-semibold">
															{initials}
														</div>
														<div className="text-slate-700 font-semibold">{cashier.name}</div>
													</div>
												</td>
												<td className="py-3 text-slate-500">{cashier.orders}</td>
												<td className="py-3 text-slate-500">{formatCurrency(cashier.sales)}</td>
													<td className="py-3 text-slate-500">
														{formatCurrency(cashier.hotel)}
														{cashier.hotelCount > 0 && <span className="ml-1 text-[10px] text-slate-400">({cashier.hotelCount})</span>}
													</td>
													<td className="py-3 font-semibold text-slate-700">{formatCurrency(cashier.revenue)}</td>
												<td className="py-3">
													<span className={`px-3 py-1 rounded-full text-[11px] font-semibold ${status.color}`}>
														{status.label}
													</span>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>

						<div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[11px] text-slate-400">
							<div>
							{sortedCashiers.length === 0
									? "No orders in this period"
									: `Showing ${pageStart + 1}–${pageStart + pageRows.length} of ${sortedCashiers.length} staff`}
							</div>
							{pageCount > 1 && (
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => setPage(safePage - 1)}
										disabled={safePage <= 1}
										className="px-3 py-1 rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40"
									>
										Previous
									</button>
									<span className="px-1">Page {safePage} of {pageCount}</span>
									<button
										type="button"
										onClick={() => setPage(safePage + 1)}
										disabled={safePage >= pageCount}
										className="px-3 py-1 rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40"
									>
										Next
									</button>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</>
	);
};

export default CashierPerformance;
