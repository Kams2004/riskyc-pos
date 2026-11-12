"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, Delete, Plus, Trash2, X } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import { ApiError } from "@/lib/apiClient";
import { usePosPreferencesStore } from "@/lib/posPreferencesStore";
import { createSale, getSettings } from "@/lib/api/pos";
import { desktop, isDesktop } from "@/lib/desktop";
import { useTillStore } from "@/lib/tillStore";
import { QueuedSale, queuedSaleAsPosSale, saleRefOf, useOfflineSalesStore } from "@/lib/offlineSales";
import { PosPaymentMethod, PosSale, PosSettings } from "@/lib/types";
import { ReceiptData } from "@/components/Receipt";
import PrintArea from "@/components/PrintArea";
import PosShell from "@/components/PosShell";
import { CheckoutBar, SuccessToast } from "@/components/SaleCheckout";
import { useT } from "@/lib/i18n";

/** One amount typed on the calculator: `amount` × `qty`. */
type CalcLine = { amount: number; qty: number };

function formatAmount(n: number) {
  return `${Math.round(n).toLocaleString("fr-FR").replace(/ /g, " ")} FCFA`;
}

/**
 * Calculator mode for a busy shop: instead of picking articles one by one, the cashier types the amounts
 * (3000 + 2500 × 2 + 1500 …), sees the running total and charges it like any sale. Each typed amount becomes a sale
 * line called "Articles divers" (no product, no stock — see the backend's amount lines), so the receipt and Sales
 * History list exactly what was typed. Offline on the desktop app, it's kept on the till like any other sale.
 */
export default function CalculatorScreen() {
  const { t } = useT();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const autoPrintAfterSale = usePosPreferencesStore((s) => s.autoPrintAfterSale);
  const enqueueOfflineSale = useOfflineSalesStore((s) => s.enqueue);

  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [lines, setLines] = useState<CalcLine[]>([]);
  /** What's being typed: the amount, and — after × — the multiplier (null until × is pressed). */
  const [amountText, setAmountText] = useState("");
  const [qtyText, setQtyText] = useState<string | null>(null);
  const [successSale, setSuccessSale] = useState<PosSale | null>(null);
  const [successOffline, setSuccessOffline] = useState(false);
  const [printData, setPrintData] = useState<ReceiptData | null>(null);

  // Shop ticket settings (enabled payment methods, receipt header): the till's saved copy first, then the server's.
  useEffect(() => {
    if (!hasHydrated || !session) return;
    let cancelled = false;
    if (isDesktop()) {
      desktop
        .cacheGet<PosSettings>("settings")
        .then((cached) => !cancelled && cached && setSettings((cur) => cur ?? cached))
        .catch(() => {});
    }
    getSettings(session.token)
      .then((s) => !cancelled && setSettings(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasHydrated, session]);

  const pendingAmount = Number(amountText || 0);
  const pendingQty = qtyText ? Math.max(1, Number(qtyText || 1)) : 1;
  const pendingTotal = pendingAmount * pendingQty;
  const total = lines.reduce((s, l) => s + l.amount * l.qty, 0) + pendingTotal;
  const label = t("calc.mixed");

  /** The amount being typed joins the tape (nothing happens for an empty or zero entry). */
  const commitEntry = useCallback((): CalcLine[] => {
    if (pendingAmount <= 0) return lines;
    const next = [...lines, { amount: pendingAmount, qty: pendingQty }];
    setLines(next);
    setAmountText("");
    setQtyText(null);
    return next;
  }, [lines, pendingAmount, pendingQty]);

  const press = useCallback(
    (key: string) => {
      if (/^\d+$/.test(key)) {
        // Digits go to the multiplier once × was pressed, otherwise to the amount. Capped to keep it sane on a till.
        if (qtyText !== null) setQtyText((q) => ((q ?? "") + key).replace(/^0+/, "").slice(0, 4));
        else setAmountText((a) => (a + key).replace(/^0+/, "").slice(0, 9));
        return;
      }
      if (key === "×") {
        if (amountText && qtyText === null) setQtyText("");
        return;
      }
      if (key === "+") {
        commitEntry();
        return;
      }
      if (key === "⌫") {
        if (qtyText !== null && qtyText.length > 0) setQtyText(qtyText.slice(0, -1));
        else if (qtyText !== null) setQtyText(null);
        else setAmountText((a) => a.slice(0, -1));
        return;
      }
      if (key === "C") {
        setAmountText("");
        setQtyText(null);
      }
    },
    [amountText, qtyText, commitEntry]
  );

  // A desktop till's keyboard works too: digits, * or x for ×, + or Enter to add a line, Backspace, Esc to clear.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "*" || e.key === "x" || e.key === "X") press("×");
      else if (e.key === "+" || e.key === "Enter") press("+");
      else if (e.key === "Backspace") press("⌫");
      else if (e.key === "Escape" || e.key === "Delete") press("C");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  const printSale = (sale: PosSale) => {
    setPrintData({
      saleRef: saleRefOf(sale),
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
      discount: 0,
    });
    setTimeout(() => window.print(), 50);
  };

  /** Same rules as the Sale screen: online it's recorded on the server; unreachable on the desktop app, kept on the till. */
  const handleCharge = async (method: PosPaymentMethod) => {
    if (!session) return;
    const finalLines = commitEntry();
    if (finalLines.length === 0) return;
    const clientSaleId = crypto.randomUUID();
    const soldAt = new Date().toISOString();
    const saleTotal = finalLines.reduce((s, l) => s + l.amount * l.qty, 0);
    const canQueue = isDesktop() && !!useTillStore.getState().device;

    const saveOffline = async (): Promise<QueuedSale> => {
      const queued: QueuedSale = {
        clientSaleId,
        cashierId: session.id,
        cashierName: `${session.firstName} ${session.lastName}`.trim(),
        items: finalLines.map((l) => ({
          productId: null,
          productName: label,
          thumbnailUrl: null,
          quantity: l.qty,
          selectedColor: "",
          selectedSize: "",
          unitPrice: l.amount,
        })),
        paymentMethod: method,
        soldAt,
        total: saleTotal,
        discount: 0,
        status: "PENDING",
      };
      await enqueueOfflineSale(queued);
      return queued;
    };

    let sale: PosSale;
    let offline = false;
    if (canQueue && (session.offline || !useTillStore.getState().online)) {
      sale = queuedSaleAsPosSale(await saveOffline());
      offline = true;
    } else {
      try {
        sale = await createSale(session.token, {
          clientSaleId,
          items: finalLines.map((l) => ({ amount: l.amount, quantity: l.qty, label })),
          paymentMethod: method,
          soldAt,
        });
      } catch (e) {
        const unreachable = !(e instanceof ApiError) || e.status >= 502;
        if (!canQueue || !unreachable) throw e;
        sale = queuedSaleAsPosSale(await saveOffline());
        offline = true;
      }
    }

    setLines([]);
    setAmountText("");
    setQtyText(null);
    setSuccessSale(sale);
    setSuccessOffline(offline);
    if (autoPrintAfterSale) printSale(sale);
  };

  if (!session) return null;

  const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "00", "0", "000"];
  const entryDisplay = amountText
    ? `${Number(amountText).toLocaleString("fr-FR").replace(/ /g, " ")}${qtyText !== null ? ` × ${qtyText}` : ""}`
    : "0";

  const headerExtra = (
    <div className="flex justify-end">
      <Link
        href="/pos"
        className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:border-gray-300 px-3 py-2 rounded-xl"
      >
        <ArrowLeft size={15} /> {t("calc.backToSale")}
      </Link>
    </div>
  );

  return (
    <>
      <PosShell title={t("calc.title")} headerExtra={headerExtra}>
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* Keypad */}
          <div className="flex-1 flex flex-col min-h-0 p-4 sm:p-6 overflow-y-auto">
            <div className="max-w-xl w-full mx-auto space-y-4">
              <div className="bg-gray-900 text-white rounded-2xl px-5 py-4 text-right">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">{t("calc.pending")}</p>
                <p className="text-4xl font-bold tabular-nums break-all" data-testid="calc-entry">
                  {entryDisplay}
                </p>
                {pendingQty > 1 && pendingAmount > 0 && (
                  <p className="text-sm text-gray-400 tabular-nums">= {formatAmount(pendingTotal)}</p>
                )}
              </div>

              <div className="grid grid-cols-4 gap-2.5">
                <div className="col-span-3 grid grid-cols-3 gap-2.5">
                  {KEYS.map((k) => (
                    <button
                      key={k}
                      onClick={() => press(k)}
                      className="h-16 sm:h-[72px] rounded-2xl bg-white border border-gray-200 text-2xl font-bold text-gray-900 hover:bg-gray-50 active:scale-[0.97] transition-transform"
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <div className="grid grid-rows-4 gap-2.5">
                  <button
                    onClick={() => press("⌫")}
                    aria-label="⌫"
                    className="rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center active:scale-[0.97] transition-transform"
                  >
                    <Delete size={24} />
                  </button>
                  <button
                    onClick={() => press("C")}
                    className="rounded-2xl bg-gray-100 hover:bg-gray-200 text-xl font-bold text-gray-700 active:scale-[0.97] transition-transform"
                  >
                    C
                  </button>
                  <button
                    onClick={() => press("×")}
                    disabled={!amountText || qtyText !== null}
                    className="rounded-2xl bg-gray-100 hover:bg-gray-200 text-2xl font-bold text-gray-700 disabled:opacity-40 active:scale-[0.97] transition-transform"
                  >
                    ×
                  </button>
                  <button
                    onClick={() => press("+")}
                    disabled={pendingAmount <= 0}
                    aria-label={t("calc.add")}
                    className="rounded-2xl bg-brand-500 hover:bg-brand-600 text-white flex items-center justify-center disabled:opacity-40 active:scale-[0.97] transition-transform"
                  >
                    <Plus size={26} />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 hidden md:block">{t("calc.keyboardHint")}</p>
            </div>
          </div>

          {/* Tape + charge */}
          <div className="w-full lg:w-96 bg-white border-t lg:border-t-0 lg:border-l border-gray-100 flex flex-col flex-shrink-0 min-h-0">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <h2 className="font-bold text-gray-900 text-sm">{label}</h2>
              {lines.length > 0 && <span className="text-xs font-semibold text-gray-400">· {t("calc.lines", { n: lines.length })}</span>}
              {lines.length > 0 && (
                <button
                  onClick={() => setLines([])}
                  className="ml-auto flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={13} /> {t("calc.clear")}
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5 min-h-[120px]" data-testid="calc-tape">
              {lines.length === 0 && pendingAmount <= 0 && <p className="text-center text-gray-400 text-sm py-8 px-4">{t("calc.empty")}</p>}
              {lines.map((l, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2 bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 truncate">{label}</p>
                    <p className="text-sm font-semibold text-gray-900 tabular-nums">
                      {l.qty > 1 ? `${l.qty} × ${formatAmount(l.amount)}` : formatAmount(l.amount)}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-gray-900 tabular-nums">{formatAmount(l.amount * l.qty)}</span>
                  <button
                    onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                    title={t("calc.remove")}
                    aria-label={t("calc.remove")}
                    className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              {pendingAmount > 0 && (
                <div className="flex items-center gap-3 rounded-xl px-3 py-2 border border-dashed border-gray-200">
                  <p className="flex-1 text-xs text-gray-400">{t("calc.pending")}</p>
                  <span className="text-sm font-semibold text-gray-400 tabular-nums">{formatAmount(pendingTotal)}</span>
                </div>
              )}
            </div>
            <div className="border-t border-gray-100 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-500">{t("calc.total")}</span>
                <span className="text-2xl font-bold text-gray-900 tabular-nums" data-testid="calc-total">
                  {formatAmount(total)}
                </span>
              </div>
              <CheckoutBar total={total} settings={settings} onCharge={handleCharge} />
            </div>
          </div>
        </div>
      </PosShell>

      {successSale && (
        <SuccessToast
          sale={successSale}
          offline={successOffline}
          onPrint={() => printSale(successSale)}
          onDismiss={() => setSuccessSale(null)}
        />
      )}
      <PrintArea settings={settings} data={printData} />
    </>
  );
}
