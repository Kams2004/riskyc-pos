"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2, Check, Printer as PrinterIcon } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { usePosPreferencesStore } from "@/lib/posPreferencesStore";
import { getSettings, updateSettings } from "@/lib/api/pos";
import { PosSettings, ReceiptPaperWidth } from "@/lib/types";
import PosShell from "@/components/PosShell";
import ToggleSwitch from "@/components/ToggleSwitch";
import PrintArea from "@/components/PrintArea";
import { ReceiptData } from "@/components/Receipt";

const PAPER_WIDTHS: { value: ReceiptPaperWidth; label: string }[] = [
  { value: "MM58", label: "58mm roll" },
  { value: "MM80", label: "80mm roll" },
  { value: "A4", label: "A4 printer" },
];

export default function PrinterSettingsPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canManage = usePosAuthStore((s) => s.hasPermission("MANAGE_POS"));
  const autoPrintAfterSale = usePosPreferencesStore((s) => s.autoPrintAfterSale);
  const setAutoPrintAfterSale = usePosPreferencesStore((s) => s.setAutoPrintAfterSale);

  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [printData, setPrintData] = useState<ReceiptData | null>(null);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canManage) {
      router.replace("/pos");
      return;
    }
    getSettings(session.token)
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load settings."))
      .finally(() => setLoading(false));
  }, [hasHydrated, session, canManage, router]);

  const handleSave = async () => {
    if (!session || !settings) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateSettings(session.token, settings);
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save settings.");
    } finally {
      setSaving(false);
    }
  };

  const printTestTicket = () => {
    setPrintData({
      saleRef: "TEST0001",
      cashierName: session?.firstName ?? "Test",
      items: [{ productName: "Test item", selectedColor: "", selectedSize: "", quantity: 1, unitPrice: 1000 }],
      total: 1000,
      paymentMethod: "CASH",
      soldAt: new Date().toISOString(),
    });
    setTimeout(() => window.print(), 50);
  };

  return (
    <>
      <PosShell title="Imprimante">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-xl mx-auto p-4 sm:p-6">
            <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-600 mb-4">
              <ChevronLeft size={14} /> Back to Settings
            </Link>

            {loading || !settings ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-xs text-blue-700 leading-relaxed">
                  Tickets print through your browser's own print dialog, the same way any webpage prints — pick your
                  receipt printer there the first time, and your browser will remember it. There's no separate
                  "connect a printer" step here.
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 mb-1.5">Paper width</label>
                    <div className="flex gap-2">
                      {PAPER_WIDTHS.map((p) => (
                        <button
                          key={p.value}
                          onClick={() => setSettings({ ...settings, paperWidth: p.value })}
                          className={clsx(
                            "flex-1 px-3 py-2.5 rounded-xl border-2 text-xs font-semibold",
                            settings.paperWidth === p.value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-200 text-gray-600"
                          )}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={printTestTicket}
                    className="w-full flex items-center justify-center gap-2 font-semibold text-sm rounded-xl py-2.5 border-2 border-gray-200 text-gray-600 hover:border-brand-300 hover:text-brand-600 transition-colors"
                  >
                    <PrinterIcon size={15} /> Print a test ticket
                  </button>

                  {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3.5 py-2.5">{error}</div>}

                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={clsx(
                      "w-full flex items-center justify-center gap-2 font-semibold text-sm rounded-xl py-3 transition-colors",
                      saved ? "bg-green-500 text-white" : "bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-60"
                    )}
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null}
                    {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
                  </button>
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Print options (this device only)</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Auto-print after each sale</p>
                      <p className="text-[11px] text-gray-400">Skips the Print tap on the success toast</p>
                    </div>
                    <ToggleSwitch checked={autoPrintAfterSale} onChange={setAutoPrintAfterSale} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </PosShell>

      <PrintArea settings={settings} data={printData} />
    </>
  );
}
