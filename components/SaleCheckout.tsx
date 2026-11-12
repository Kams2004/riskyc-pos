"use client";

import { useEffect, useState } from "react";
import { Banknote, Check, Loader2, Printer, X } from "lucide-react";
import clsx from "clsx";
import { ApiError } from "@/lib/apiClient";
import { usePosPreferencesStore } from "@/lib/posPreferencesStore";
import { OfflineSaveError } from "@/lib/offlineSales";
import { PosPaymentMethod, PosSale, PosSettings } from "@/lib/types";
import { TKey, useT } from "@/lib/i18n";

/** Payment buttons and the "sale recorded" toast — shared by the Sale screen and the Calculator. */

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

export const PAYMENT_METHODS: {
  value: PosPaymentMethod;
  label: TKey;
  /** Brand logo for the mobile-money buttons; cash keeps the banknote icon. */
  logo?: string;
  enabledKey: "cashEnabled" | "orangeMoneyEnabled" | "mobileMoneyEnabled";
  classes: string;
}[] = [
  { value: "CASH", label: "pay.cash", enabledKey: "cashEnabled", classes: "bg-green-500 hover:bg-green-600 text-white" },
  { value: "ORANGE_MONEY", label: "pay.orangeMoney", logo: "/orange-money.png", enabledKey: "orangeMoneyEnabled", classes: "bg-orange-500 hover:bg-orange-600 text-white" },
  { value: "MOBILE_MONEY", label: "pay.mtnMomo", logo: "/mtn-momo.png", enabledKey: "mobileMoneyEnabled", classes: "bg-amber-400 hover:bg-amber-500 text-gray-900" },
];

export function CheckoutBar({
  total,
  settings,
  onCharge,
}: {
  total: number;
  settings: PosSettings | null;
  onCharge: (method: PosPaymentMethod) => Promise<void>;
}) {
  const confirmBeforeCharge = usePosPreferencesStore((s) => s.confirmBeforeCharge);
  const { t } = useT();
  const [charging, setCharging] = useState<PosPaymentMethod | null>(null);
  const [armed, setArmed] = useState<PosPaymentMethod | null>(null);
  const [chargeError, setChargeError] = useState("");

  // With the "confirm before charging" preference on, the first tap arms the
  // button (it switches to "Confirm?") and only a second tap actually charges;
  // the arm disarms itself after a few seconds or when another method is tapped.
  const handleTap = async (method: PosPaymentMethod) => {
    if (charging) return;
    if (confirmBeforeCharge && armed !== method) {
      setArmed(method);
      setTimeout(() => setArmed((cur) => (cur === method ? null : cur)), 3000);
      return;
    }
    setArmed(null);
    setCharging(method);
    setChargeError("");
    try {
      await onCharge(method);
    } catch (e) {
      setChargeError(
        e instanceof OfflineSaveError
          ? e.message
          : e instanceof ApiError && e.status === 403
          ? t("sale.notAllowed")
          : e instanceof ApiError
            ? t("sale.notRecorded", { message: e.message })
            : t("sale.notRecordedOffline")
      );
    } finally {
      setCharging(null);
    }
  };

  const methods = settings ? PAYMENT_METHODS.filter((m) => settings[m.enabledKey]) : PAYMENT_METHODS;

  return (
    <>
    {chargeError && (
      <div role="alert" className="mb-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
        {chargeError}
      </div>
    )}
    <div className="grid grid-cols-3 gap-2">
      {methods.map((m) => {
        const isCharging = charging === m.value;
        const isArmed = armed === m.value;
        return (
          <button
            key={m.value}
            onClick={() => handleTap(m.value)}
            disabled={!!charging || total <= 0}
            className={clsx(
              "flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl font-bold text-xs transition-all disabled:opacity-40",
              isArmed ? "bg-gray-900 text-white ring-2 ring-offset-2 ring-gray-900" : m.classes
            )}
          >
            {isCharging ? (
              <Loader2 size={18} className="animate-spin" />
            ) : m.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.logo} alt="" className="w-8 h-8 rounded-lg object-cover ring-2 ring-white/80 shadow-sm" />
            ) : (
              <Banknote size={18} />
            )}
            {isCharging ? t("sale.charging") : isArmed ? t("sale.confirm") : t(m.label)}
          </button>
        );
      })}
    </div>
    </>
  );
}

export function SuccessToast({
  sale,
  offline,
  onPrint,
  onDismiss,
}: {
  sale: PosSale;
  /** Saved on this till because the server couldn't be reached — it uploads by itself later. */
  offline: boolean;
  onPrint: () => void;
  onDismiss: () => void;
}) {
  const { t } = useT();
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  const paymentLabel = PAYMENT_METHODS.find((m) => m.value === sale.paymentMethod)?.label;
  const itemTotal = sale.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="fixed bottom-4 inset-x-0 mx-auto w-fit z-40 bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-4 animate-slide-up">
      <div className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
        <Check size={18} className="text-green-400" />
      </div>
      <div>
        <p className="font-bold">{formatPrice(sale.total)}</p>
        <p className="text-xs text-gray-400">
          {paymentLabel ? t(paymentLabel) : sale.paymentMethod} · {t(itemTotal === 1 ? "items.one" : "items.other", { n: itemTotal })}
        </p>
        {offline && <p className="text-xs font-semibold text-amber-300 mt-0.5">{t("sale.savedOffline")}</p>}
      </div>
      <button
        onClick={onPrint}
        className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 text-xs font-semibold ml-2"
      >
        <Printer size={14} /> {t("sale.print")}
      </button>
      <button onClick={onDismiss} className="text-gray-500 hover:text-white">
        <X size={16} />
      </button>
    </div>
  );
}
