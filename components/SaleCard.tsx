import { AlertTriangle, Undo2, Loader2, Printer } from "lucide-react";
import clsx from "clsx";
import { PosSale } from "@/lib/types";

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

/** One sale row, shared between the full history list and the reconciliation list. */
export default function SaleCard({
  sale,
  canVoid,
  voiding,
  onPrint,
  onVoid,
}: {
  sale: PosSale;
  canVoid: boolean;
  voiding: boolean;
  onPrint: (sale: PosSale) => void;
  onVoid: (sale: PosSale) => void;
}) {
  return (
    <div className={clsx("bg-white rounded-2xl border p-4", sale.voided ? "border-gray-100 opacity-60" : "border-gray-100")}>
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
              onClick={() => onPrint(sale)}
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
              onClick={() => onVoid(sale)}
              disabled={voiding}
              className="flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:bg-red-50 px-2.5 py-1.5 rounded-lg disabled:opacity-50"
            >
              {voiding ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
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
  );
}
