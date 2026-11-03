"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import { listFlaggedSales, voidSale, getSettings } from "@/lib/api/pos";
import { PosSale, PosSettings } from "@/lib/types";
import PrintArea from "@/components/PrintArea";
import { ReceiptData } from "@/components/Receipt";
import PosShell from "@/components/PosShell";
import SaleCard from "@/components/SaleCard";

/**
 * Sales whose stock decrement went negative — a size/color that sold here
 * may also have sold out online before this sale synced. Pulled from a
 * dedicated flagged-only endpoint rather than filtering the full history
 * client-side, so this stays correct even once the history list is paginated.
 */
export default function ReconciliationPage() {
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canVoid = usePosAuthStore((s) => s.hasPermission("VOID_POS_SALE"));

  const [sales, setSales] = useState<PosSale[]>([]);
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [printData, setPrintData] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);

  const load = (token: string) => {
    Promise.all([listFlaggedSales(token), getSettings(token)])
      .then(([salesResp, settingsResp]) => {
        setSales(salesResp);
        setSettings(settingsResp);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the reconciliation list."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!hasHydrated || !session) return;
    load(session.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, session]);

  const handleVoid = async (sale: PosSale) => {
    if (!session) return;
    setVoidingId(sale.id);
    try {
      await voidSale(session.token, sale.id);
      // A voided sale's stock is restored and it's no longer a reconciliation
      // concern — drop it from this list rather than just updating its flag.
      setSales((prev) => prev.filter((s) => s.id !== sale.id));
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

  return (
    <>
      <PosShell title="Reconciliation">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-3">
            <p className="text-xs text-gray-400 -mt-1 mb-1">
              Sales that pushed a size/color's stock negative — likely sold here and online around the same time.
            </p>

            {loading && (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={24} className="animate-spin" />
              </div>
            )}
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</div>}
            {!loading && sales.length === 0 && (
              <div className="text-center py-16">
                <CheckCircle2 size={28} className="mx-auto text-green-400 mb-2" />
                <p className="text-gray-400 text-sm">Nothing to reconcile.</p>
              </div>
            )}

            {sales.map((sale) => (
              <SaleCard key={sale.id} sale={sale} canVoid={canVoid} voiding={voidingId === sale.id} onPrint={printSale} onVoid={handleVoid} />
            ))}
          </div>
        </div>
      </PosShell>

      <PrintArea settings={settings} data={printData} />
    </>
  );
}
