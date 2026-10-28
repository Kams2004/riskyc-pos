"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, AlertTriangle, Undo2, Loader2, Printer } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { listSales, voidSale, getSettings } from "@/lib/api/pos";
import { PosSale, PosSettings } from "@/lib/types";
import PrintArea from "@/components/PrintArea";
import { ReceiptData } from "@/components/Receipt";

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

export default function SalesHistoryPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canVoid = usePosAuthStore((s) => s.hasPermission("VOID_POS_SALE"));

  const [sales, setSales] = useState<PosSale[]>([]);
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [printData, setPrintData] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const load = () => {
    if (!session) return;
    Promise.all([listSales(session.token), getSettings(session.token)])
      .then(([salesResp, settingsResp]) => {
        setSales(salesResp);
        setSettings(settingsResp);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load sales."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!hasHydrated) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, session]);

  const handleVoid = async (saleId: string) => {
    if (!session) return;
    setVoidingId(saleId);
    try {
      const updated = await voidSale(session.token, saleId);
      setSales((prev) => prev.map((s) => (s.id === saleId ? updated : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't void that sale.");
    } finally {
      setVoidingId(null);
    }
  };

  const printSale = (sale: PosSale) => {
    setPrintData({
      saleRef: sale.id.slice(0, 8).toUpperCase(),
      cashierName: sale.cashierName,
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
    });
    setTimeout(() => window.print(), 50);
  };

  if (!session) return null;

  return (
    <>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => router.push("/pos")} className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
            <ChevronLeft size={18} />
          </button>
          <h1 className="font-bold text-gray-900">Sales history</h1>
        </header>

        <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          )}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</div>}
          {!loading && sales.length === 0 && <p className="text-center text-gray-400 py-16 text-sm">No sales yet.</p>}

          {sales.map((sale) => (
            <div key={sale.id} className={clsx("bg-white rounded-2xl border p-4", sale.voided ? "border-gray-100 opacity-60" : "border-gray-100")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-gray-900">{formatPrice(sale.total)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(sale.soldAt).toLocaleString()} · {sale.cashierName} · {sale.paymentMethod.replace("_", " ")}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {sale.stockReconciliationFlag && !sale.voided && (
                    <span title="This sale pushed stock negative" className="flex items-center gap-1 text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-full">
                      <AlertTriangle size={11} /> Reconcile
                    </span>
                  )}
                  {!sale.voided && (
                    <button
                      onClick={() => printSale(sale)}
                      title="Reprint ticket"
                      className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-100 px-2.5 py-1.5 rounded-lg"
                    >
                      <Printer size={11} /> Print
                    </button>
                  )}
                  {sale.voided ? (
                    <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                      Voided{sale.voidedByName ? ` · ${sale.voidedByName}` : ""}
                    </span>
                  ) : canVoid ? (
                    <button
                      onClick={() => handleVoid(sale.id)}
                      disabled={voidingId === sale.id}
                      className="flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      {voidingId === sale.id ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
                      Void
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-50 space-y-1">
                {sale.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {item.quantity}× {item.productName}
                      {[item.selectedColor, item.selectedSize].filter(Boolean).length > 0
                        ? ` (${[item.selectedColor, item.selectedSize].filter(Boolean).join(", ")})`
                        : ""}
                    </span>
                    <span>{formatPrice(item.unitPrice * item.quantity)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <PrintArea settings={settings} data={printData} />
    </>
  );
}
