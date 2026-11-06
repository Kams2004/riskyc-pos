"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Eye, ChevronUp, Phone, MapPin } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { listOrders } from "@/lib/api/pos";
import { OnlineOrder, OrderStatus } from "@/lib/types";
import PosShell from "@/components/PosShell";
import { TKey, useT } from "@/lib/i18n";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";

const STATUS_META: Record<OrderStatus, { label: TKey; classes: string }> = {
  PENDING: { label: "status.PENDING", classes: "bg-gray-100 text-gray-600" },
  AWAITING_PAYMENT: { label: "status.AWAITING_PAYMENT", classes: "bg-amber-50 text-amber-700" },
  REVIEWING: { label: "status.REVIEWING", classes: "bg-purple-50 text-purple-700" },
  VALIDATED: { label: "status.VALIDATED", classes: "bg-blue-50 text-blue-700" },
  PACKAGING: { label: "status.PACKAGING", classes: "bg-indigo-50 text-indigo-700" },
  PACKAGED: { label: "status.PACKAGED", classes: "bg-green-50 text-green-700" },
  CANCELLED: { label: "status.CANCELLED", classes: "bg-red-50 text-red-600" },
};

const TABS: { value: "all" | "active" | OrderStatus; label: TKey }[] = [
  { value: "all", label: "orders.tabAll" },
  { value: "active", label: "orders.tabActive" },
  { value: "PACKAGED", label: "status.PACKAGED" },
  { value: "CANCELLED", label: "status.CANCELLED" },
];

const ACTIVE_STATUSES: OrderStatus[] = ["PENDING", "AWAITING_PAYMENT", "REVIEWING", "VALIDATED", "PACKAGING"];

const PAYMENT_LABEL_KEYS = { ORANGE_MONEY: "pay.orangeMoney", MOBILE_MONEY: "pay.mtnMomo" } as const;

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

function formatDate(iso: string, locale: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })} · ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
}

export default function OrdersPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canView = usePosAuthStore((s) => s.hasPermission("VIEW_ORDERS"));
  const { t, locale } = useT();

  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canView) {
      router.replace("/");
      return;
    }
    listOrders(session.token)
      .then(setOrders)
      .catch((e) => setError(e instanceof Error ? e.message : t("orders.loadFailed")))
      .finally(() => setLoading(false));
  }, [hasHydrated, session, canView, router]);

  const counts = useMemo(
    () => ({
      all: orders.length,
      active: orders.filter((o) => ACTIVE_STATUSES.includes(o.status)).length,
      PACKAGED: orders.filter((o) => o.status === "PACKAGED").length,
      CANCELLED: orders.filter((o) => o.status === "CANCELLED").length,
    }),
    [orders]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (tab === "active" && !ACTIVE_STATUSES.includes(o.status)) return false;
      if (tab !== "all" && tab !== "active" && o.status !== tab) return false;
      if (q) {
        const c = o.customerInfo;
        const haystack = [o.id, c?.firstName, c?.lastName, c?.phone, ...o.items.map((i) => i.productName)].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [orders, tab, search]);

  const pagination = usePagination(filtered, 10, [tab, search]);

  return (
    <PosShell title={t("orders.title")}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 space-y-5">
          <p className="text-sm text-gray-400 -mt-1">{t("orders.intro")}</p>

          <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {TABS.map((tabDef) => (
                <button
                  key={tabDef.value}
                  onClick={() => setTab(tabDef.value)}
                  className={clsx(
                    "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                    tab === tabDef.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
                  )}
                >
                  {t(tabDef.label)}
                  <span className="ml-1.5 text-gray-400 tabular-nums">{counts[tabDef.value as keyof typeof counts]}</span>
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[220px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("orders.search")}
                className="w-full bg-gray-100 border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white"
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-16 text-sm">{t("orders.none")}</p>
          ) : (
            <>
            <div className="bg-white border border-gray-200 shadow-sm rounded-2xl overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 text-left">{t("orders.colOrder")}</th>
                    <th className="px-4 py-3 text-left">{t("orders.colPlaced")}</th>
                    <th className="px-4 py-3 text-left">{t("orders.colCustomer")}</th>
                    <th className="px-4 py-3 text-left">{t("orders.colItems")}</th>
                    <th className="px-4 py-3 text-left">{t("orders.colAmount")}</th>
                    <th className="px-4 py-3 text-left">{t("orders.colPayment")}</th>
                    <th className="px-4 py-3 text-left">{t("orders.colStatus")}</th>
                    <th className="px-4 py-3 text-center">{t("orders.colDetails")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pagination.pageItems.map((order) => {
                    const qty = order.items.reduce((n, i) => n + i.quantity, 0);
                    const expanded = expandedId === order.id;
                    const c = order.customerInfo;
                    return (
                      <Fragment key={order.id}>
                        <tr className="hover:bg-gray-50/60 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs font-bold text-gray-700">{order.id.slice(0, 8)}…</td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(order.createdAt, locale)}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{c ? `${c.firstName} ${c.lastName}` : "—"}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {t(qty === 1 ? "items.one" : "items.other", { n: qty })}
                          </td>
                          <td className="px-4 py-3 text-sm font-bold tabular-nums text-gray-900">{formatPrice(order.total)}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex text-[11px] font-medium px-2 py-1 rounded-lg bg-gray-100 text-gray-600 whitespace-nowrap">
                              {order.paymentMethod ? t(PAYMENT_LABEL_KEYS[order.paymentMethod]) : t("orders.notChosen")}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={clsx("text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap", STATUS_META[order.status].classes)}>
                              {t(STATUS_META[order.status].label)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => setExpandedId(expanded ? null : order.id)}
                              title={t("orders.view")}
                              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            >
                              {expanded ? <ChevronUp size={14} /> : <Eye size={14} />}
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={8} className="px-4 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px] gap-6">
                                <div className="space-y-2">
                                  {order.items.map((item) => (
                                    <div key={item.id} className="flex items-center gap-3 text-xs text-gray-600">
                                      <div className="w-9 h-9 rounded-lg overflow-hidden bg-gray-200 flex-shrink-0">
                                        {item.productThumbnailUrl && (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={item.productThumbnailUrl} alt="" className="w-full h-full object-cover" />
                                        )}
                                      </div>
                                      <span className="flex-1">
                                        {item.quantity}× {item.productName}
                                        {[item.selectedColor, item.selectedSize].filter(Boolean).length > 0
                                          ? ` (${[item.selectedColor, item.selectedSize].filter(Boolean).join(", ")})`
                                          : ""}
                                      </span>
                                      <span className="tabular-nums">{formatPrice(item.unitPrice * item.quantity)}</span>
                                    </div>
                                  ))}
                                  {order.status === "CANCELLED" && order.rejectionReason && (
                                    <p className="text-[11px] text-red-500 pt-1">{t("orders.reason", { reason: order.rejectionReason })}</p>
                                  )}
                                </div>
                                {c && (
                                  <div className="space-y-1.5 text-xs text-gray-600">
                                    <p className="font-semibold text-gray-900">
                                      {c.firstName} {c.lastName}
                                    </p>
                                    <p className="flex items-center gap-1.5">
                                      <Phone size={12} className="text-gray-400" /> {c.phone}
                                    </p>
                                    {(c.town || c.street) && (
                                      <p className="flex items-center gap-1.5">
                                        <MapPin size={12} className="text-gray-400" /> {[c.street, c.town].filter(Boolean).join(", ")}
                                      </p>
                                    )}
                                    {order.packagingCompletedAt && (
                                      <p className="text-[11px] text-gray-400 pt-1">
                                        {order.packagingCompletedByName
                                          ? t("orders.packedBy", { date: formatDate(order.packagingCompletedAt, locale), name: order.packagingCompletedByName })
                                          : t("orders.packed", { date: formatDate(order.packagingCompletedAt, locale) })}
                                      </p>
                                    )}
                                  </div>
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
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pagination.pageSize}
              noun={t("noun.orders")}
              onPageChange={pagination.setPage}
            />
            </>
          )}
        </div>
      </div>
    </PosShell>
  );
}
