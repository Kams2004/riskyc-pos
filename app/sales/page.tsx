"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Search,
  TrendingUp,
  CalendarDays,
  Wallet,
  ShoppingBag,
  Download,
  RotateCcw,
  Eye,
  Printer,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { ApiError } from "@/lib/apiClient";
import { listSales, listOnlineSales, voidSale, getSettings, getCatalog } from "@/lib/api/pos";
import { reconstructSaleDiscount } from "@/lib/pricing";
import { QueuedSale, saleRefOf, useOfflineSalesStore } from "@/lib/offlineSales";
import { OnlineOrder, PosSale, PosSettings, PosPaymentMethod, Product } from "@/lib/types";
import PrintArea from "@/components/PrintArea";
import { ReceiptData } from "@/components/Receipt";
import PosShell from "@/components/PosShell";
import Pagination from "@/components/Pagination";
import { TKey, t as tStatic, useT } from "@/lib/i18n";

const PAGE_SIZE = 10;

const PAYMENT_LABEL_KEYS: Record<PosPaymentMethod, TKey> = {
  CASH: "pay.cash",
  ORANGE_MONEY: "pay.orangeMoney",
  MOBILE_MONEY: "pay.mtnMomo",
};

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

/** A till sale or a completed (PACKAGED) online order, shown side by side in one history. */
interface SaleRow {
  id: string;
  channel: "STORE" | "ONLINE";
  soldAt: string;
  /** The cashier for a till sale, the customer for an online order. */
  person: string;
  items: { id: string; productId: string | null; productName: string; selectedColor: string; selectedSize: string; quantity: number; unitPrice: number }[];
  total: number;
  paymentMethod: PosPaymentMethod;
  voided: boolean;
  pos?: PosSale;
  online?: OnlineOrder;
  /** What the printed ticket shows as "Sale #" — see saleRefOf. */
  ref: string;
  /** Rung up on this till while offline and not on the server yet. */
  queued?: QueuedSale;
}

/** A sale still waiting on this till. A refused one is listed but, like a voided sale, never counted. */
function fromQueuedSale(s: QueuedSale): SaleRow {
  return {
    id: s.clientSaleId,
    ref: saleRefOf(s),
    channel: "STORE",
    soldAt: s.soldAt,
    person: s.cashierName,
    items: s.items.map((it, i) => ({ id: `${s.clientSaleId}-${i}`, ...it })),
    total: s.total,
    paymentMethod: s.paymentMethod,
    voided: s.status === "REJECTED",
    queued: s,
  };
}

function fromPosSale(s: PosSale): SaleRow {
  return {
    id: s.id,
    ref: saleRefOf(s),
    channel: "STORE",
    soldAt: s.soldAt,
    person: s.cashierName,
    items: s.items,
    total: s.total,
    paymentMethod: s.paymentMethod,
    voided: s.voided,
    pos: s,
  };
}

function fromOnlineOrder(o: OnlineOrder): SaleRow {
  const customer = o.customerInfo ? `${o.customerInfo.firstName} ${o.customerInfo.lastName}`.trim() : "";
  return {
    id: o.id,
    ref: o.id.slice(0, 8).toUpperCase(),
    channel: "ONLINE",
    soldAt: o.packagingCompletedAt ?? o.createdAt,
    person: customer || tStatic("sales.onlineCustomer"),
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      selectedColor: i.selectedColor ?? "",
      selectedSize: i.selectedSize ?? "",
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    total: o.total,
    paymentMethod: o.paymentMethod ?? "MOBILE_MONEY",
    voided: false,
    online: o,
  };
}

export default function SalesHistoryPage() {
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canVoid = usePosAuthStore((s) => s.hasPermission("VOID_POS_SALE"));
  const { t, lang, locale } = useT();

  const [sales, setSales] = useState<PosSale[]>([]);
  const [onlineSales, setOnlineSales] = useState<OnlineOrder[]>([]);
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [printData, setPrintData] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "voided">("all");
  const [channelFilter, setChannelFilter] = useState<"all" | "STORE" | "ONLINE">("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | PosPaymentMethod>("all");
  const [cashierFilter, setCashierFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  // An upload of offline sales moves them onto the server: reload so they reappear as recorded sales.
  const syncedVersion = useOfflineSalesStore((s) => s.syncedVersion);
  // Only used to work out a reprinted ticket's bulk discount; the page works without it.
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    Promise.all([listSales(session.token), listOnlineSales(session.token).catch(() => []), getSettings(session.token)])
      .then(([salesResp, onlineResp, settingsResp]) => {
        setError("");
        setSales(salesResp);
        setOnlineSales(onlineResp);
        setSettings(settingsResp);
      })
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? e.message
            : t("sales.offlineOnly")
        )
      )
      .finally(() => setLoading(false));
    getCatalog(session.token)
      .then((c) => setCatalogProducts(c.products))
      .catch(() => {});
  }, [hasHydrated, session, syncedVersion]);

  const queuedSales = useOfflineSalesStore((s) => s.sales);
  const rows = useMemo(() => {
    const onServer = new Set(sales.map((s) => s.clientSaleId));
    return [
      ...sales.map(fromPosSale),
      ...onlineSales.map(fromOnlineOrder),
      // Once uploaded a sale comes back from the server; skip its queued copy if both are briefly present.
      ...queuedSales.filter((q) => !onServer.has(q.clientSaleId)).map(fromQueuedSale),
    ];
    // lang: the "Online customer" fallback name follows the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, onlineSales, queuedSales, lang]);
  // Cashiers from server sales and from sales still waiting on this till (e.g. someone who only sold offline today).
  const cashiers = useMemo(
    () => Array.from(new Set([...sales.map((s) => s.cashierName), ...queuedSales.map((q) => q.cashierName)])).sort(),
    [sales, queuedSales]
  );

  const today = new Date();
  const last30 = new Date();
  last30.setDate(last30.getDate() - 30);

  const todaySales = rows.filter((s) => !s.voided && isSameDay(new Date(s.soldAt), today));
  const last30Sales = rows.filter((s) => !s.voided && new Date(s.soldAt) >= last30);

  const stats = [
    { label: t("sales.today"), value: String(todaySales.length), icon: ShoppingBag, color: "text-brand-500 bg-brand-50" },
    { label: t("sales.revenueToday"), value: formatPrice(todaySales.reduce((s, x) => s + x.total, 0)), icon: Wallet, color: "text-purple-500 bg-purple-50" },
    { label: t("sales.30days"), value: String(last30Sales.length), icon: CalendarDays, color: "text-blue-500 bg-blue-50" },
    { label: t("sales.revenue30"), value: formatPrice(last30Sales.reduce((s, x) => s + x.total, 0)), icon: TrendingUp, color: "text-green-500 bg-green-50" },
  ];

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setChannelFilter("all");
    setPaymentFilter("all");
    setCashierFilter("all");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((s) => {
        if (statusFilter === "completed" && s.voided) return false;
        if (statusFilter === "voided" && !s.voided) return false;
        if (channelFilter !== "all" && s.channel !== channelFilter) return false;
        if (paymentFilter !== "all" && s.paymentMethod !== paymentFilter) return false;
        if (cashierFilter !== "all" && (s.channel !== "STORE" || s.person !== cashierFilter)) return false;
        if (fromDate && new Date(s.soldAt) < new Date(fromDate)) return false;
        if (toDate && new Date(s.soldAt) > new Date(`${toDate}T23:59:59`)) return false;
        if (q) {
          // Matches the ticket's ref and either id, so an older ticket (printed with the server id) is found too.
          const haystack = [s.ref, s.id, s.pos?.clientSaleId ?? "", s.person, ...s.items.map((i) => i.productName)].join(" ").toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime());
  }, [rows, search, statusFilter, channelFilter, paymentFilter, cashierFilter, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleFilterChange = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const handleVoid = async (sale: PosSale) => {
    if (!session) return;
    if (!window.confirm(t("sales.voidConfirm"))) return;
    setVoidingId(sale.id);
    try {
      const updated = await voidSale(session.token, sale.id);
      setSales((prev) => prev.map((s) => (s.id === sale.id ? updated : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sales.voidFailed"));
    } finally {
      setVoidingId(null);
    }
  };

  const printSale = (sale: SaleRow) => {
    setPrintData({
      saleRef: sale.ref,
      cashierName: sale.person,
      items: sale.items.map((i) => ({
        productName: i.productName,
        selectedColor: i.selectedColor,
        selectedSize: i.selectedSize,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      total: sale.total,
      paymentMethod: sale.paymentMethod,
      soldAt: sale.soldAt,
      // Same "Bulk discount" line the original ticket had, when it can be worked out reliably.
      discount: sale.queued ? sale.queued.discount : reconstructSaleDiscount(sale.items, sale.total, catalogProducts),
    });
    setTimeout(() => window.print(), 50);
  };

  const exportCsv = () => {
    const header = [t("col.saleNo"), t("sales.colChannel"), t("sales.colDate"), t("sales.colPerson"), t("orders.colItems"), t("orders.colAmount"), t("orders.colPayment"), t("orders.colStatus")];
    const csvRows = filtered.map((s) => [
      s.ref,
      s.channel === "ONLINE" ? t("sales.online") : t("sales.inStore"),
      new Date(s.soldAt).toLocaleString(locale),
      s.person,
      String(s.items.reduce((n, i) => n + i.quantity, 0)),
      String(Math.round(s.total)),
      t(PAYMENT_LABEL_KEYS[s.paymentMethod]),
      s.queued ? (s.queued.status === "REJECTED" ? t("sales.notAccepted") : t("sales.pendingSync")) : s.voided ? t("sales.voided") : t("sales.completed"),
    ]);
    const csv = [header, ...csvRows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pos-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PosShell title={t("sales.title")}>
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 lg:p-8 space-y-5">
            <p className="text-sm text-gray-400 -mt-2">{t("sales.intro")}</p>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {stats.map((s) => (
                <div key={s.label} className="bg-white border border-gray-200 shadow-sm rounded-2xl p-4 flex items-center gap-3">
                  <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", s.color)}>
                    <s.icon size={17} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-gray-900 truncate">{s.value}</p>
                    <p className="text-[11px] text-gray-400">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Toolbar */}
            <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={search}
                    onChange={(e) => handleFilterChange(setSearch)(e.target.value)}
                    placeholder={t("sales.search")}
                    className="w-full bg-gray-100 border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white"
                  />
                </div>
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-gray-600 border border-gray-300 hover:bg-gray-100"
                >
                  <Download size={13} /> {t("sales.export")}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => handleFilterChange(setStatusFilter)(e.target.value as typeof statusFilter)}
                  className="text-xs font-medium bg-gray-100 border border-gray-200 rounded-xl px-2.5 py-2 outline-none"
                >
                  <option value="all">{t("sales.allStatuses")}</option>
                  <option value="completed">{t("sales.completed")}</option>
                  <option value="voided">{t("sales.voided")}</option>
                </select>
                <select
                  value={channelFilter}
                  onChange={(e) => handleFilterChange(setChannelFilter)(e.target.value as typeof channelFilter)}
                  className="text-xs font-medium bg-gray-100 border border-gray-200 rounded-xl px-2.5 py-2 outline-none"
                >
                  <option value="all">{t("sales.allChannels")}</option>
                  <option value="STORE">{t("sales.inStore")}</option>
                  <option value="ONLINE">{t("sales.online")}</option>
                </select>
                <select
                  value={paymentFilter}
                  onChange={(e) => handleFilterChange(setPaymentFilter)(e.target.value as typeof paymentFilter)}
                  className="text-xs font-medium bg-gray-100 border border-gray-200 rounded-xl px-2.5 py-2 outline-none"
                >
                  <option value="all">{t("sales.allPayments")}</option>
                  <option value="CASH">{t("pay.cash")}</option>
                  <option value="ORANGE_MONEY">Orange Money</option>
                  <option value="MOBILE_MONEY">MTN MoMo</option>
                </select>
                <select
                  value={cashierFilter}
                  onChange={(e) => handleFilterChange(setCashierFilter)(e.target.value)}
                  className="text-xs font-medium bg-gray-100 border border-gray-200 rounded-xl px-2.5 py-2 outline-none"
                >
                  <option value="all">{t("sales.allCashiers")}</option>
                  {cashiers.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-xl px-2.5 py-1.5">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => handleFilterChange(setFromDate)(e.target.value)}
                    className="text-xs bg-transparent outline-none"
                  />
                  <span className="text-gray-300 text-xs">→</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => handleFilterChange(setToDate)(e.target.value)}
                    className="text-xs bg-transparent outline-none"
                  />
                </div>
                <button
                  onClick={resetFilters}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold text-gray-500 hover:bg-gray-100"
                >
                  <RotateCcw size={12} /> {t("sales.reset")}
                </button>
              </div>
            </div>

            {!loading && error && rows.length > 0 && (
              <div className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">{error}</div>
            )}

            {/* Table */}
            {loading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : error && rows.length === 0 ? (
              <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</div>
            ) : filtered.length === 0 ? (
              <p className="text-center text-gray-400 py-16 text-sm">{t("sales.noMatch")}</p>
            ) : (
              <>
                <div className="bg-white border border-gray-200 shadow-sm rounded-2xl overflow-hidden overflow-x-auto">
                  <table className="w-full min-w-[820px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        <th className="px-4 py-3 text-left">{t("col.saleNo")}</th>
                        <th className="px-4 py-3 text-left">{t("sales.colDateTime")}</th>
                        <th className="px-4 py-3 text-left">{t("sales.colPerson")}</th>
                        <th className="px-4 py-3 text-left">{t("orders.colItems")}</th>
                        <th className="px-4 py-3 text-left">{t("orders.colAmount")}</th>
                        <th className="px-4 py-3 text-left">{t("orders.colPayment")}</th>
                        <th className="px-4 py-3 text-left">{t("orders.colStatus")}</th>
                        <th className="px-4 py-3 text-center">{t("col.actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {paginated.map((sale) => {
                        const totalQty = sale.items.reduce((n, i) => n + i.quantity, 0);
                        const expanded = expandedId === sale.id;
                        return (
                          <Fragment key={`${sale.channel}-${sale.id}`}>
                            <tr className="hover:bg-gray-50/60 transition-colors">
                              <td className="px-4 py-3">
                                <p className="font-mono text-xs font-bold text-gray-700">{sale.ref}</p>
                                <span
                                  className={clsx(
                                    "inline-flex mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                                    sale.channel === "ONLINE" ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500"
                                  )}
                                >
                                  {sale.channel === "ONLINE" ? t("sales.online") : t("sales.inStore")}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-500">
                                {new Date(sale.soldAt).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })}
                                <br />
                                {new Date(sale.soldAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                                    {initials(sale.person)}
                                  </div>
                                  <span className="text-xs text-gray-700">{sale.person}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs text-gray-500">{t(totalQty === 1 ? "items.one" : "items.other", { n: totalQty })}</td>
                              <td className="px-4 py-3 text-sm font-bold tabular-nums text-gray-900">{formatPrice(sale.total)}</td>
                              <td className="px-4 py-3">
                                <span className="inline-flex text-[11px] font-medium px-2 py-1 rounded-lg bg-gray-100 text-gray-600 whitespace-nowrap">
                                  {t(PAYMENT_LABEL_KEYS[sale.paymentMethod])}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {sale.queued ? (
                                  sale.queued.status === "REJECTED" ? (
                                    <span title={sale.queued.error} className="text-[11px] font-bold px-2 py-1 rounded-full bg-red-50 text-red-600">
                                      {t("sales.notAccepted")}
                                    </span>
                                  ) : (
                                    <span title={t("sales.pendingSyncTitle")} className="text-[11px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700">
                                      {t("sales.pendingSync")}
                                    </span>
                                  )
                                ) : sale.voided ? (
                                  <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-500">{t("sales.voided")}</span>
                                ) : (
                                  <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-green-50 text-green-600">{t("sales.completed")}</span>
                                )}
                                {sale.pos?.stockReconciliationFlag && !sale.voided && (
                                  <span title={t("sales.negativeStock")} className="ml-1 inline-flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full">
                                    <AlertTriangle size={9} />
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => setExpandedId(expanded ? null : sale.id)}
                                    title={t("sales.viewItems")}
                                    className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                  >
                                    {expanded ? <ChevronUp size={14} /> : <Eye size={14} />}
                                  </button>
                                  {!sale.voided && (
                                    <button onClick={() => printSale(sale)} title={t("sales.reprint")} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                                      <Printer size={14} />
                                    </button>
                                  )}
                                  {sale.pos && !sale.voided && canVoid && (
                                    <button
                                      onClick={() => handleVoid(sale.pos!)}
                                      disabled={voidingId === sale.id}
                                      title={t("sales.void")}
                                      className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                                    >
                                      {voidingId === sale.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {expanded && (
                              <tr className="bg-gray-50/60">
                                <td colSpan={8} className="px-4 py-3">
                                  <div className="space-y-1 max-w-lg">
                                    {sale.items.map((item) => (
                                      <div key={item.id} className="flex items-center justify-between text-xs text-gray-600">
                                        <span>
                                          {item.quantity}× {item.productName}
                                          {[item.selectedColor, item.selectedSize].filter(Boolean).length > 0
                                            ? ` (${[item.selectedColor, item.selectedSize].filter(Boolean).join(", ")})`
                                            : ""}
                                        </span>
                                        <span className="tabular-nums">{formatPrice(item.unitPrice * item.quantity)}</span>
                                      </div>
                                    ))}
                                    {sale.pos?.voided && sale.pos.voidedByName && (
                                      <p className="text-[11px] text-gray-400 pt-1">
                                        {t("sales.voidedBy", { name: sale.pos.voidedByName })}
                                        {sale.pos.voidedAt ? ` · ${new Date(sale.pos.voidedAt).toLocaleString(locale)}` : ""}
                                      </p>
                                    )}
                                    {sale.online && (
                                      <p className="text-[11px] text-gray-400 pt-1">
                                        {sale.online.packagingCompletedByName
                                          ? t("sales.onlinePackedBy", { name: sale.online.packagingCompletedByName })
                                          : t("sales.onlinePacked")}
                                        {sale.online.customerInfo?.phone ? ` · ${sale.online.customerInfo.phone}` : ""}
                                      </p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  total={filtered.length}
                  pageSize={PAGE_SIZE}
                  noun={t("noun.sales")}
                  onPageChange={setPage}
                />
              </>
            )}
          </div>
        </div>
      </PosShell>

      <PrintArea settings={settings} data={printData} />
    </>
  );
}
