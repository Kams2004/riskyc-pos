"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2, Check } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { getSettings, updateSettings } from "@/lib/api/pos";
import { PosSettings } from "@/lib/types";
import PosShell from "@/components/PosShell";
import ToggleSwitch from "@/components/ToggleSwitch";
import Receipt from "@/components/Receipt";

const SAMPLE_RECEIPT = {
  saleRef: "A1B2C3D4",
  cashierName: "Jane Doe",
  items: [
    { productName: "Blousson Ermess", selectedColor: "Black", selectedSize: "M", quantity: 1, unitPrice: 35000 },
    { productName: "FC Barcelon Jessey", selectedColor: "", selectedSize: "", quantity: 2, unitPrice: 3500 },
  ],
  total: 42000,
  paymentMethod: "CASH" as const,
  soldAt: new Date().toISOString(),
};

export default function TicketSettingsPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canManage = usePosAuthStore((s) => s.hasPermission("MANAGE_POS"));

  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <PosShell title="Ticket de caisse">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 sm:p-6">
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-600 mb-4">
            <ChevronLeft size={14} /> Back to Settings
          </Link>

          {loading || !settings ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Content */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-1">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Ticket content</p>

                <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Show store logo</p>
                    <p className="text-[11px] text-gray-400">Shown at the top if one is uploaded in Store Information</p>
                  </div>
                  <span className="text-[11px] text-gray-300">{settings.logoUrl ? "Uploaded" : "None set"}</span>
                </div>
                <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                  <p className="text-sm font-semibold text-gray-900">Show sale number</p>
                  <ToggleSwitch checked={settings.showSaleId} onChange={(v) => setSettings({ ...settings, showSaleId: v })} />
                </div>
                <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                  <p className="text-sm font-semibold text-gray-900">Show cashier name</p>
                  <ToggleSwitch checked={settings.showCashierName} onChange={(v) => setSettings({ ...settings, showCashierName: v })} />
                </div>

                <div className="pt-3">
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Footer message</label>
                  <textarea
                    value={settings.footerMessage ?? ""}
                    onChange={(e) => setSettings({ ...settings, footerMessage: e.target.value || null })}
                    rows={2}
                    maxLength={120}
                    className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 resize-none"
                    placeholder="Thank you for your visit!"
                  />
                  <p className="text-[11px] text-gray-300 text-right mt-1">{(settings.footerMessage ?? "").length}/120</p>
                </div>

                {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3.5 py-2.5 mt-2">{error}</div>}

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className={clsx(
                    "w-full flex items-center justify-center gap-2 font-semibold text-sm rounded-xl py-3 transition-colors mt-3",
                    saved ? "bg-green-500 text-white" : "bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-60"
                  )}
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null}
                  {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
                </button>
              </div>

              {/* Live preview */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Live preview</p>
                <div className="bg-gray-100 rounded-2xl p-6 flex justify-center sticky top-4">
                  <div className="shadow-xl">
                    <Receipt settings={settings} data={SAMPLE_RECEIPT} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PosShell>
  );
}
