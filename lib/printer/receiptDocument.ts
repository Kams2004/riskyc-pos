/**
 * The receipt as a ReceiptDocument for the thermal printer — the same content, in the same order, as the on-screen /
 * window.print ticket (components/Receipt.tsx): store header, date, sale number, cashier, items with colour and size,
 * subtotal and bulk discount, total, payment, footer. Only the logo is left out (thermal tickets are text).
 *
 * Type-only imports, and the translator is passed in: this file has no dependency on React or the stores, so the
 * printer tests can run it under plain Node.
 */
import type { ReceiptData } from "../../components/Receipt";
import type { TKey, TVars } from "../i18n";
import type { PosPaymentMethod, PosSettings } from "../types";
import type { ReceiptDocument } from "./escpos";

const PAYMENT_LABEL_KEYS: Record<PosPaymentMethod, TKey> = {
  CASH: "pay.cash",
  ORANGE_MONEY: "pay.orangeMoney",
  MOBILE_MONEY: "pay.mtnMomo",
};

/** Same as Receipt.tsx: "12,000 FCFA". */
export function formatReceiptPrice(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

export function buildReceiptDocument(
  data: ReceiptData,
  settings: PosSettings,
  t: (key: TKey, vars?: TVars) => string,
  locale: string
): ReceiptDocument {
  const infoLines = [new Date(data.soldAt).toLocaleString(locale)];
  if (settings.showSaleId) infoLines.push(t("receipt.saleNo", { ref: data.saleRef }));
  if (settings.showCashierName) infoLines.push(t("receipt.servedBy", { name: data.cashierName }));

  const adjustments: ReceiptDocument["adjustments"] = [];
  if (data.discount && data.discount > 0) {
    adjustments.push({ label: t("receipt.subtotal"), amount: formatReceiptPrice(data.total + data.discount) });
    adjustments.push({ label: t("receipt.bulkDiscount"), amount: `-${formatReceiptPrice(data.discount)}` });
  }

  return {
    storeName: settings.storeName,
    storeAddress: settings.storeAddress,
    storePhone: settings.storePhone,
    infoLines,
    items: data.items.map((item) => ({
      label: `${item.quantity}× ${item.productName}`,
      detail: [item.selectedColor, item.selectedSize].filter(Boolean).join(" · "),
      amount: formatReceiptPrice(item.unitPrice * item.quantity),
    })),
    adjustments,
    total: { label: t("receipt.total"), amount: formatReceiptPrice(data.total) },
    payment: { label: t("receipt.payment"), value: t(PAYMENT_LABEL_KEYS[data.paymentMethod]) },
    footer: settings.footerMessage,
  };
}
