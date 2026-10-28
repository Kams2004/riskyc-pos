"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Check, Upload } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { getSettings, updateSettings, uploadLogo } from "@/lib/api/pos";
import { PosSettings, ReceiptPaperWidth } from "@/lib/types";
import Receipt from "@/components/Receipt";

const PAPER_WIDTHS: { value: ReceiptPaperWidth; label: string }[] = [
  { value: "MM58", label: "58mm roll" },
  { value: "MM80", label: "80mm roll" },
  { value: "A4", label: "A4 printer" },
];

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

export default function SettingsPage() {
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
    if (!hasHydrated) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    if (!canManage) {
      router.replace("/pos");
      return;
    }
    getSettings(session.token)
      .then(setSettings)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load settings."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, session]);

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

  const handleLogoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !session) return;
    try {
      const updated = await uploadLogo(session.token, file);
      setSettings(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload logo.");
    }
  };

  if (!session || !canManage) return null;

  if (loading || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center gap-3">
        <button onClick={() => router.push("/pos")} className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center">
          <ChevronLeft size={18} />
        </button>
        <h1 className="font-bold text-gray-900">Ticket settings</h1>
      </header>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 h-fit">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Store name</label>
            <input
              value={settings.storeName}
              onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Address</label>
            <input
              value={settings.storeAddress ?? ""}
              onChange={(e) => setSettings({ ...settings, storeAddress: e.target.value || null })}
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Phone</label>
            <input
              value={settings.storePhone ?? ""}
              onChange={(e) => setSettings({ ...settings, storePhone: e.target.value || null })}
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Footer message</label>
            <textarea
              value={settings.footerMessage ?? ""}
              onChange={(e) => setSettings({ ...settings, footerMessage: e.target.value || null })}
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 resize-none"
              placeholder="Thank you for shopping with us!"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Logo</label>
            <div className="flex items-center gap-3">
              {settings.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={settings.logoUrl} alt="" className="w-12 h-12 object-contain border border-gray-100 rounded-lg" />
              )}
              <label className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-xl px-3 py-2 cursor-pointer">
                <Upload size={13} /> {settings.logoUrl ? "Replace" : "Upload"}
                <input type="file" accept="image/*" className="hidden" onChange={handleLogoPick} />
              </label>
            </div>
          </div>

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

          <div className="space-y-2.5 pt-1">
            <label className="flex items-center justify-between text-sm font-medium text-gray-700">
              Show sale number
              <input
                type="checkbox"
                checked={settings.showSaleId}
                onChange={(e) => setSettings({ ...settings, showSaleId: e.target.checked })}
                className="w-4 h-4 accent-brand-500"
              />
            </label>
            <label className="flex items-center justify-between text-sm font-medium text-gray-700">
              Show cashier name
              <input
                type="checkbox"
                checked={settings.showCashierName}
                onChange={(e) => setSettings({ ...settings, showCashierName: e.target.checked })}
                className="w-4 h-4 accent-brand-500"
              />
            </label>
          </div>

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

        {/* Live preview */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Live preview</p>
          <div className="bg-gray-200 rounded-2xl p-6 flex justify-center">
            <div className="shadow-xl">
              <Receipt settings={settings} data={SAMPLE_RECEIPT} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
