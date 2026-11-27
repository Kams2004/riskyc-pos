"use client";

import { useEffect } from "react";
import { AlertTriangle, Check, Loader2, Printer, RotateCcw, X, XCircle } from "lucide-react";
import PrintArea from "./PrintArea";
import { TKey, useT } from "@/lib/i18n";
import type { ReceiptFailure, ReceiptPrintOutcome } from "@/lib/printer/printReceipt";
import { isPermissionProblem } from "@/lib/printer/printReceipt";
import type { ReceiptPrinterController } from "@/lib/printer/useReceiptPrinter";

const FAILURE_KEYS: Record<ReceiptFailure, TKey> = {
  paperOut: "print.fail.paperOut",
  coverOpen: "print.fail.coverOpen",
  offline: "print.fail.offline",
  error: "print.fail.error",
  unreachable: "print.fail.unreachable",
  interrupted: "print.fail.interrupted",
  paperOutDuringPrint: "print.fail.paperOutDuringPrint",
  stuckInQueue: "print.fail.stuckInQueue",
  notConfigured: "print.fail.notConfigured",
};

export function failureKey(failure: string): TKey {
  return FAILURE_KEYS[failure as ReceiptFailure] ?? "print.fail.unreachable";
}

/**
 * The print area for the system print window plus the thermal printer's outcome banner — mounted once per page that
 * prints receipts, fed by useReceiptPrinter. Says "Printed" only when the printer confirmed it.
 */
export default function ReceiptPrinter({ printer }: { printer: ReceiptPrinterController }) {
  return (
    <>
      <PrintArea settings={printer.settings} data={printer.printData} />
      <PrintOutcomeBanner printer={printer} />
    </>
  );
}

function PrintOutcomeBanner({ printer }: { printer: ReceiptPrinterController }) {
  const { t } = useT();
  const { job, dismiss, retry, printWithWindowInstead } = printer;
  const outcome: ReceiptPrintOutcome | null = job?.phase === "done" ? job.outcome : null;
  const autoClose = outcome?.result === "printed" && !outcome.paperNearEnd;

  // A confirmed ticket needs no attention: the green banner goes away by itself. Anything else stays until closed.
  useEffect(() => {
    if (!autoClose) return;
    const timer = setTimeout(dismiss, 3500);
    return () => clearTimeout(timer);
  }, [autoClose, dismiss, job]);

  if (!job) return null;

  const shell = "fixed top-4 inset-x-0 mx-auto w-fit max-w-[calc(100%-2rem)] z-50 rounded-2xl shadow-2xl px-5 py-3.5 flex items-start gap-3 print:hidden animate-slide-up";

  if (job.phase === "printing") {
    return (
      <div role="status" className={`${shell} bg-gray-900 text-white items-center`}>
        <Loader2 size={18} className="animate-spin text-gray-300" />
        <p className="text-sm font-semibold">{t("print.printing")}</p>
      </div>
    );
  }

  const o = job.outcome;
  if (o.result === "printed") {
    return (
      <div role="status" className={`${shell} bg-green-600 text-white items-center`}>
        <Check size={18} />
        <div>
          <p className="text-sm font-bold">{t("print.printed")}</p>
          {o.paperNearEnd && <p className="text-xs text-green-50">{t("print.paperLow")}</p>}
        </div>
        <button onClick={dismiss} aria-label={t("print.close")} className="ml-2 text-green-100 hover:text-white">
          <X size={16} />
        </button>
      </div>
    );
  }

  const canRetry = !(o.result === "failed" && o.failure === "notConfigured");
  const actions = (
    <div className="flex flex-wrap gap-2 mt-2.5">
      {canRetry && (
        <button
          onClick={retry}
          className="flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-gray-900 text-white hover:bg-gray-800"
        >
          <RotateCcw size={13} /> {o.result === "sent" ? t("print.printAgain") : t("print.tryAgain")}
        </button>
      )}
      <button
        onClick={printWithWindowInstead}
        className="flex items-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 bg-white border border-gray-300 text-gray-700 hover:border-gray-400"
      >
        <Printer size={13} /> {t("print.useWindow")}
      </button>
    </div>
  );

  if (o.result === "sent") {
    return (
      <div role="alert" className={`${shell} bg-amber-50 border border-amber-300 text-amber-900`}>
        <AlertTriangle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold">{t("print.sentTitle")}</p>
          <p className="text-xs">{t("print.sentHint")}</p>
          {actions}
        </div>
        <button onClick={dismiss} aria-label={t("print.close")} className="text-amber-500 hover:text-amber-800">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div role="alert" className={`${shell} bg-red-50 border border-red-300 text-red-900`}>
      <XCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-sm font-bold">{t("print.failedTitle", { reason: t(failureKey(o.failure)) })}</p>
        {isPermissionProblem(o.detail) && <p className="text-xs mt-0.5">{t("print.permissionHint")}</p>}
        {o.detail && <p className="text-[11px] text-red-400 mt-0.5 break-words">{o.detail}</p>}
        {actions}
      </div>
      <button onClick={dismiss} aria-label={t("print.close")} className="text-red-400 hover:text-red-700">
        <X size={16} />
      </button>
    </div>
  );
}
