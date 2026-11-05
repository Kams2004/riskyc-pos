"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Eye, ChevronUp, Phone, MapPin } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { listOrders } from "@/lib/api/pos";
import { OnlineOrder, OrderStatus } from "@/lib/types";
import PosShell from "@/components/PosShell";

const STATUS_META: Record<OrderStatus, { label: string; classes: string }> = {
  PENDING: { label: "Pending", classes: "bg-gray-100 text-gray-600" },
  AWAITING_PAYMENT: { label: "Awaiting payment", classes: "bg-amber-50 text-amber-700" },
  REVIEWING: { label: "Payment review", classes: "bg-purple-50 text-purple-700" },
  VALIDATED: { label: "Validated", classes: "bg-blue-50 text-blue-700" },
  PACKAGING: { label: "Packing", classes: "bg-indigo-50 text-indigo-700" },
  PACKAGED: { label: "Completed", classes: "bg-green-50 text-green-700" },
  CANCELLED: { label: "Cancelled", classes: "bg-red-50 text-red-600" },
};

const TABS: { value: "all" | "active" | OrderStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "In progress" },
  { value: "PACKAGED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const ACTIVE_STATUSES: OrderStatus[] = ["PENDING", "AWAITING_PAYMENT", "REVIEWING", "VALIDATED", "PACKAGING"];

const PAYMENT_LABELS = { ORANGE_MONEY: "Orange Money", MOBILE_MONEY: "MTN MoMo" } as const;

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function OrdersPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canView = usePosAuthStore((s) => s.hasPermission("VIEW_ORDERS"));

  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canView) {
      router.replace("/pos");
      return;
    }
    listOrders(session.token)
      .then(setOrders)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load orders."))
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

  return (
    <PosShell title="Orders">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 space-y-5">
          <p className="text-sm text-gray-400 -mt-1">
            Orders placed on the online shop. Completed orders also count as sales in Sales History.
          </p>

          <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {TABS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={clsx(
                    "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                    tab === t.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-800"
                  )}
                >
                  {t.label}
                  <span className="ml-1.5 text-gray-400 tabular-nums">{counts[t.value as keyof typeof counts]}</span>
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[220px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by order #, customer, phone, product…"
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
            <p className="text-center text-gray-400 py-16 text-sm">No orders here.</p>
          ) : (
            <div className="bg-white border border-gray-200 shadow-sm rounded-2xl overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 text-left">Order #</th>
                    <th className="px-4 py-3 text-left">Placed</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Items</th>
                    <th className="px-4 py-3 text-left">Amount</th>
                    <th className="px-4 py-3 text-left">Payment</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-center">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filtered.map((order) => {
                    const qty = order.items.reduce((n, i) => n + i.quantity, 0);
                    const expanded = expandedId === order.id;
                    const c = order.customerInfo;
                    return (
                      <Fragment key={order.id}>
                        <tr className="hover:bg-gray-50/60 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs font-bold text-gray-700">{order.id.slice(0, 8)}…</td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(order.createdAt)}</td>
                          <td className="px-4 py-3 text-xs text-gray-700">{c ? `${c.firstName} ${c.lastName}` : "—"}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {qty} item{qty !== 1 ? "s" : ""}
                          </td>
                          <td className="px-4 py-3 text-sm font-bold tabular-nums text-gray-900">{formatPrice(order.total)}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex text-[11px] font-medium px-2 py-1 rounded-lg bg-gray-100 text-gray-600 whitespace-nowrap">
                              {order.paymentMethod ? PAYMENT_LABELS[order.paymentMethod] : "Not chosen"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={clsx("text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap", STATUS_META[order.status].classes)}>
                              {STATUS_META[order.status].label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => setExpandedId(expanded ? null : order.id)}
                              title="View order"
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
                                    <p className="text-[11px] text-red-500 pt-1">Reason: {order.rejectionReason}</p>
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
                                        Packed {formatDate(order.packagingCompletedAt)}
                                        {order.packagingCompletedByName ? ` by ${order.packagingCompletedByName}` : ""}
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
          )}
        </div>
      </div>
    </PosShell>
  );
}
