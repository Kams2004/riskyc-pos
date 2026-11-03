"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import { listSales, voidSale, getSettings } from "@/lib/api/pos";
import { PosSale, PosSettings } from "@/lib/types";
import PrintArea from "@/components/PrintArea";
import { ReceiptData } from "@/components/Receipt";
import PosShell from "@/components/PosShell";
import SaleCard from "@/components/SaleCard";

export default function SalesHistoryPage() {
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canVoid = usePosAuthStore((s) => s.hasPermission("VOID_POS_SALE"));

  const [sales, setSales] = useState<PosSale[]>([]);
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [printData, setPrintData] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [voidingId, setVoidingId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    Promise.all([listSales(session.token), getSettings(session.token)])
      .then(([salesResp, settingsResp]) => {
        setSales(salesResp);
        setSettings(settingsResp);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load sales."))
      .finally(() => setLoading(false));
  }, [hasHydrated, session]);

  const handleVoid = async (sale: PosSale) => {
    if (!session) return;
    setVoidingId(sale.id);
    try {
      const updated = await voidSale(session.token, sale.id);
      setSales((prev) => prev.map((s) => (s.id === sale.id ? updated : s)));
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
      <PosShell title="Sales History">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-3">
            {loading && (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={24} className="animate-spin" />
              </div>
            )}
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</div>}
            {!loading && sales.length === 0 && <p className="text-center text-gray-400 py-16 text-sm">No sales yet.</p>}

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
