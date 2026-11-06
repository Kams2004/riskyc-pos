import { PosPaymentMethod, PosSettings } from "@/lib/types";
import { TKey, useT } from "@/lib/i18n";

export interface ReceiptItem {
  productName: string;
  selectedColor: string;
  selectedSize: string;
  quantity: number;
  unitPrice: number;
}

export interface ReceiptData {
  saleRef: string;
  cashierName: string;
  items: ReceiptItem[];
  total: number;
  paymentMethod: PosPaymentMethod;
  soldAt: string;
  /** Bulk-price reduction on this sale, when known (printed right after the sale); 0/absent prints no discount line. */
  discount?: number;
}

const PAYMENT_LABEL_KEYS: Record<PosPaymentMethod, TKey> = {
  CASH: "pay.cash",
  ORANGE_MONEY: "pay.orangeMoney",
  MOBILE_MONEY: "pay.mtnMomo",
};

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

const WIDTH_MM: Record<PosSettings["paperWidth"], number> = { MM58: 58, MM80: 80, A4: 210 };

/**
 * The printed ticket — the single source of truth for what a receipt looks
 * like, used identically for an actual post-sale print, a sales-history
 * reprint, and the settings page's live preview (with sample data instead
 * of a real sale). Plain, print-friendly markup only: no app chrome, no
 * interactive controls, nothing that depends on screen-only CSS.
 */
export default function Receipt({ settings, data }: { settings: PosSettings; data: ReceiptData }) {
  const { t, locale } = useT();
  const widthMm = WIDTH_MM[settings.paperWidth];
  const small = settings.paperWidth === "MM58";

  return (
    <div
      className="bg-white text-black font-mono mx-auto"
      style={{ width: `${widthMm}mm`, fontSize: small ? "10px" : "11px", padding: small ? "6px" : "10px" }}
    >
      <div className="text-center mb-2">
        {settings.showLogo && settings.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={settings.logoUrl} alt="" className="mx-auto mb-1.5 max-h-12 object-contain" />
        )}
        <p className="font-bold uppercase" style={{ fontSize: small ? "12px" : "14px" }}>
          {settings.storeName}
        </p>
        {settings.storeAddress && <p>{settings.storeAddress}</p>}
        {settings.storePhone && <p>{settings.storePhone}</p>}
      </div>

      <div className="border-t border-dashed border-black my-1.5" />

      <p>{new Date(data.soldAt).toLocaleString(locale)}</p>
      {settings.showSaleId && <p>{t("receipt.saleNo", { ref: data.saleRef })}</p>}
      {settings.showCashierName && <p>{t("receipt.servedBy", { name: data.cashierName })}</p>}

      <div className="border-t border-dashed border-black my-1.5" />

      {data.items.map((item, i) => (
        <div key={i} className="mb-1">
          <div className="flex justify-between gap-2">
            <span className="flex-1">
              {item.quantity}× {item.productName}
            </span>
            <span className="tabular-nums whitespace-nowrap">{formatPrice(item.unitPrice * item.quantity)}</span>
          </div>
          {(item.selectedColor || item.selectedSize) && (
            <p className="text-[0.9em] opacity-70 pl-2">
              {[item.selectedColor, item.selectedSize].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      ))}

      <div className="border-t border-dashed border-black my-1.5" />

      {!!data.discount && data.discount > 0 && (
        <>
          <div className="flex justify-between">
            <span>{t("receipt.subtotal")}</span>
            <span className="tabular-nums">{formatPrice(data.total + data.discount)}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("receipt.bulkDiscount")}</span>
            <span className="tabular-nums">-{formatPrice(data.discount)}</span>
          </div>
        </>
      )}
      <div className="flex justify-between font-bold" style={{ fontSize: small ? "12px" : "14px" }}>
        <span>{t("receipt.total")}</span>
        <span className="tabular-nums">{formatPrice(data.total)}</span>
      </div>
      <div className="flex justify-between mt-0.5">
        <span>{t("receipt.payment")}</span>
        <span>{t(PAYMENT_LABEL_KEYS[data.paymentMethod])}</span>
      </div>

      {settings.footerMessage && (
        <>
          <div className="border-t border-dashed border-black my-1.5" />
          <p className="text-center whitespace-pre-wrap">{settings.footerMessage}</p>
        </>
      )}
    </div>
  );
}
