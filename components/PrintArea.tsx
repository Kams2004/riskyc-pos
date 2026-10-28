import Receipt, { ReceiptData } from "./Receipt";
import { PosSettings } from "@/lib/types";

/**
 * Mounted once per page that can print a ticket. Invisible on screen,
 * the ONLY thing visible when window.print() fires — print.css (globals.css)
 * hides everything else via @media print. Call triggerPrint() (see
 * usePrintReceipt) right after setting the data this renders.
 */
export default function PrintArea({ settings, data }: { settings: PosSettings | null; data: ReceiptData | null }) {
  if (!settings || !data) return null;
  return (
    <div id="print-area" className="hidden print:block fixed inset-0 bg-white z-[9999]">
      <Receipt settings={settings} data={data} />
    </div>
  );
}
