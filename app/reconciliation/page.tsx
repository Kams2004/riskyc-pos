"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, AlertTriangle, Package, Layers, CheckCircle2, Clock, Check } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { listReconciliation, resolveReconciliation } from "@/lib/api/pos";
import { PosReconciliationLine } from "@/lib/types";
import PosShell from "@/components/PosShell";

/**
 * Per-line stock discrepancies — a sale that oversold a (color, size) goes
 * negative on that specific variant, not the whole sale, so this works line
 * by line rather than sale by sale (see GET /api/pos/reconciliation).
 */
export default function ReconciliationPage() {
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canManage = usePosAuthStore((s) => s.hasPermission("MANAGE_POS"));

  const [lines, setLines] = useState<PosReconciliationLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"pending" | "resolved">("pending");
  const [search, setSearch] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    listReconciliation(session.token)
      .then(setLines)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the reconciliation list."))
      .finally(() => setLoading(false));
  }, [hasHydrated, session]);

  const pending = lines.filter((l) => !l.reconciled);
  const resolved = lines.filter((l) => l.reconciled);

  const stats = [
    { label: "Oversold sales", value: new Set(lines.map((l) => l.saleId)).size, icon: AlertTriangle, color: "text-orange-500 bg-orange-50" },
    { label: "Lines affected", value: lines.length, icon: Package, color: "text-rose-500 bg-rose-50" },
    { label: "Units short", value: lines.reduce((s, l) => s + l.oversoldBy, 0), icon: Layers, color: "text-purple-500 bg-purple-50" },
    { label: "Resolved", value: resolved.length, icon: CheckCircle2, color: "text-green-500 bg-green-50" },
    { label: "Pending", value: pending.length, icon: Clock, color: "text-amber-500 bg-amber-50" },
  ];

  const visible = tab === "pending" ? pending : resolved;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((l) => [l.productName, l.saleId, l.cashierName].join(" ").toLowerCase().includes(q));
  }, [visible, search]);

  const handleResolve = async (line: PosReconciliationLine) => {
    if (!session) return;
    setResolvingId(line.itemId);
    try {
      const updated = await resolveReconciliation(session.token, line.itemId);
      setLines((prev) => prev.map((l) => (l.itemId === line.itemId ? updated : l)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resolve that line.");
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <PosShell title="Reconciliation">
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 lg:p-8 space-y-5">
          <p className="text-sm text-gray-400 -mt-2">Sales that pushed a size/color's stock negative — likely sold here and online around the same time.</p>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-center gap-3">
                <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", s.color)}>
                  <s.icon size={17} />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-gray-900">{s.value}</p>
                  <p className="text-[11px] text-gray-400 leading-tight">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Tabs + search */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setTab("pending")}
              className={clsx(
                "px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors",
                tab === "pending" ? "bg-brand-500 text-white shadow-sm" : "bg-white border border-gray-200 text-gray-600"
              )}
            >
              Pending ({pending.length})
            </button>
            <button
              onClick={() => setTab("resolved")}
              className={clsx(
                "px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors",
                tab === "resolved" ? "bg-brand-500 text-white shadow-sm" : "bg-white border border-gray-200 text-gray-600"
              )}
            >
              Resolved ({resolved.length})
            </button>
            <div className="relative flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a product, sale # or cashier…"
                className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle2 size={28} className="mx-auto text-green-400 mb-2" />
              <p className="text-gray-400 text-sm">{tab === "pending" ? "Nothing to reconcile." : "Nothing resolved yet."}</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-3 text-left">Sold</th>
                    <th className="px-4 py-3 text-left">Sale #</th>
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">Color</th>
                    <th className="px-4 py-3 text-left">Size</th>
                    <th className="px-4 py-3 text-right">Qty sold</th>
                    <th className="px-4 py-3 text-right">Stock before</th>
                    <th className="px-4 py-3 text-right">Stock after</th>
                    <th className="px-4 py-3 text-right">Short by</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((line) => (
                    <tr key={line.itemId} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(line.soldAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                        <br />
                        {new Date(line.soldAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-bold text-gray-700">{line.saleId.slice(0, 8)}…</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                            {line.thumbnailUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={line.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            )}
                          </div>
                          <span className="text-xs font-semibold text-gray-900 max-w-[140px] truncate">{line.productName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{line.selectedColor || "—"}</td>
                      <td className="px-4 py-3 text-xs text-gray-600">{line.selectedSize || "—"}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-gray-900 text-right tabular-nums">{line.quantity}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 text-right tabular-nums">{line.stockBefore}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-red-500 text-right tabular-nums">{line.stockAfter}</td>
                      <td className="px-4 py-3 text-xs font-bold text-red-600 text-right tabular-nums">-{line.oversoldBy}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center">
                          {line.reconciled ? (
                            <span title={line.reconciledByName ? `By ${line.reconciledByName}` : undefined} className="flex items-center gap-1 text-[11px] font-semibold text-green-600 bg-green-50 px-2.5 py-1.5 rounded-lg whitespace-nowrap">
                              <Check size={11} /> {line.reconciledByName ?? "Resolved"}
                            </span>
                          ) : canManage ? (
                            <button
                              onClick={() => handleResolve(line)}
                              disabled={resolvingId === line.itemId}
                              className="flex items-center gap-1 text-[11px] font-semibold text-white bg-gray-900 hover:bg-brand-600 px-2.5 py-1.5 rounded-lg disabled:opacity-50 whitespace-nowrap"
                            >
                              {resolvingId === line.itemId ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                              Resolve
                            </button>
                          ) : (
                            <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded-lg">Pending</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PosShell>
  );
}
