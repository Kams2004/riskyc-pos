"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Upload, Trash2, Printer as PrinterIcon, Banknote } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { usePosPreferencesStore } from "@/lib/posPreferencesStore";
import { getSettings, updateSettings, uploadLogo, removeLogo } from "@/lib/api/pos";
import { PosSettings, ReceiptPaperWidth } from "@/lib/types";
import PosShell from "@/components/PosShell";
import ToggleSwitch from "@/components/ToggleSwitch";
import Receipt, { ReceiptData } from "@/components/Receipt";
import PrintArea from "@/components/PrintArea";
import TillsCard from "@/components/TillsCard";

const PAPER_WIDTHS: { value: ReceiptPaperWidth; label: string }[] = [
  { value: "MM58", label: "58mm roll" },
  { value: "MM80", label: "80mm roll" },
  { value: "A4", label: "A4 printer" },
];

const PAYMENT_METHODS: {
  key: "cashEnabled" | "orangeMoneyEnabled" | "mobileMoneyEnabled";
  icon: typeof Banknote;
  logo?: string;
  title: string;
  subtitle: string;
  accent: string;
}[] = [
  { key: "cashEnabled", icon: Banknote, title: "Cash", subtitle: "Paid in physical currency", accent: "bg-green-50 text-green-600" },
  { key: "orangeMoneyEnabled", icon: Banknote, logo: "/orange-money.png", title: "Orange Money", subtitle: "Mobile payment via Orange", accent: "" },
  { key: "mobileMoneyEnabled", icon: Banknote, logo: "/mtn-momo.png", title: "MTN MoMo", subtitle: "Mobile payment via MTN", accent: "" },
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

function SectionCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("bg-white rounded-2xl border border-gray-200 shadow-sm p-5 sm:p-6", className)}>
      <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-4">{title}</p>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canManage = usePosAuthStore((s) => s.hasPermission("MANAGE_POS"));
  const autoPrintAfterSale = usePosPreferencesStore((s) => s.autoPrintAfterSale);
  const setAutoPrintAfterSale = usePosPreferencesStore((s) => s.setAutoPrintAfterSale);
  const confirmBeforeCharge = usePosPreferencesStore((s) => s.confirmBeforeCharge);
  const setConfirmBeforeCharge = usePosPreferencesStore((s) => s.setConfirmBeforeCharge);

  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [printData, setPrintData] = useState<ReceiptData | null>(null);
  const [removingLogo, setRemovingLogo] = useState(false);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canManage) {
      router.replace("/");
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

  const handleLogoRemove = async () => {
    if (!session) return;
    setRemovingLogo(true);
    try {
      const updated = await removeLogo(session.token);
      setSettings(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove logo.");
    } finally {
      setRemovingLogo(false);
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

  const enabledCount = settings ? PAYMENT_METHODS.filter((m) => settings[m.key]).length : 0;

  return (
    <>
      <PosShell title="Settings">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
            <p className="text-sm text-gray-400 -mt-1">Configure this point of sale to fit your needs.</p>

            {loading || !settings ? (
              <div className="flex items-center justify-center py-20 text-gray-400">
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : (
              <>
                {/* Ticket & Printer, with live preview */}
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                    <SectionCard title="Ticket de caisse">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">Show store logo</p>
                            <p className="text-[11px] text-gray-400">
                              {settings.logoUrl ? "Hide it on the ticket without deleting it" : "Upload one below, under Store Information"}
                            </p>
                          </div>
                          <ToggleSwitch
                            checked={settings.showLogo}
                            disabled={!settings.logoUrl}
                            onChange={(v) => setSettings({ ...settings, showLogo: v })}
                          />
                        </div>
                        <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
                          <p className="text-sm font-semibold text-gray-900">Show sale number</p>
                          <ToggleSwitch checked={settings.showSaleId} onChange={(v) => setSettings({ ...settings, showSaleId: v })} />
                        </div>
                        <div className="flex items-center justify-between py-2.5 border-b border-gray-100">
                          <p className="text-sm font-semibold text-gray-900">Show cashier name</p>
                          <ToggleSwitch checked={settings.showCashierName} onChange={(v) => setSettings({ ...settings, showCashierName: v })} />
                        </div>

                        <div className="pt-3">
                          <label className="block text-xs font-semibold text-gray-900 mb-1.5">Footer message</label>
                          <textarea
                            value={settings.footerMessage ?? ""}
                            onChange={(e) => setSettings({ ...settings, footerMessage: e.target.value || null })}
                            rows={3}
                            maxLength={120}
                            className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 resize-none"
                            placeholder="Thank you for your visit!"
                          />
                          <p className="text-[11px] text-gray-300 text-right mt-1">{(settings.footerMessage ?? "").length}/120</p>
                        </div>
                      </div>
                    </SectionCard>

                    <SectionCard title="Imprimante">
                      <div className="space-y-4">
                        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3.5 text-xs text-blue-700 leading-relaxed">
                          Tickets print through your browser's own print dialog, the same way any webpage prints —
                          pick your receipt printer there the first time, and your browser will remember it.
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-gray-900 mb-1.5">Paper width</label>
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

                        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">Auto-print after each sale</p>
                            <p className="text-[11px] text-gray-400">Skips the Print tap on the success toast (this device only)</p>
                          </div>
                          <ToggleSwitch checked={autoPrintAfterSale} onChange={setAutoPrintAfterSale} />
                        </div>
                      </div>
                    </SectionCard>
                  </div>

                  {/* Live preview */}
                  <div>
                    <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">Live preview</p>
                    <div className="bg-gray-200 rounded-2xl p-8 flex justify-center sticky top-4 overflow-hidden">
                      {/* An A4 page is ~794px wide; shrink it to fit the preview column instead of overflowing. */}
                      <div className="shadow-xl" style={settings.paperWidth === "A4" ? { zoom: 0.42 } : undefined}>
                        <Receipt settings={settings} data={SAMPLE_RECEIPT} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Store, Payment, Preferences, Users */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                  <SectionCard title="Informations du magasin">
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-gray-900 mb-1.5">Store name</label>
                          <input
                            value={settings.storeName}
                            onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
                            className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-900 mb-1.5">Phone</label>
                          <input
                            value={settings.storePhone ?? ""}
                            onChange={(e) => setSettings({ ...settings, storePhone: e.target.value || null })}
                            className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-900 mb-1.5">Address</label>
                        <input
                          value={settings.storeAddress ?? ""}
                          onChange={(e) => setSettings({ ...settings, storeAddress: e.target.value || null })}
                          className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-900 mb-1.5">Logo</label>
                        <div className="flex items-center gap-3">
                          {settings.logoUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={settings.logoUrl} alt="" className="w-12 h-12 object-contain border border-gray-200 rounded-lg" />
                          )}
                          <label className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-xl px-3 py-2 cursor-pointer">
                            <Upload size={13} /> {settings.logoUrl ? "Replace" : "Upload"}
                            <input type="file" accept="image/*" className="hidden" onChange={handleLogoPick} />
                          </label>
                          {settings.logoUrl && (
                            <button
                              type="button"
                              onClick={handleLogoRemove}
                              disabled={removingLogo}
                              className="flex items-center gap-1.5 text-xs font-semibold text-red-500 bg-red-50 hover:bg-red-100 rounded-xl px-3 py-2 disabled:opacity-60"
                            >
                              {removingLogo ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Remove
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard title="Moyens de paiement">
                    <p className="text-xs text-gray-400 mb-3 -mt-1">Choose which payment buttons show up on the sale screen.</p>
                    <div className="space-y-1">
                      {PAYMENT_METHODS.map((m, i) => {
                        const Icon = m.icon;
                        const isOnlyOneLeft = enabledCount === 1 && settings[m.key];
                        return (
                          <div key={m.key} className={clsx("flex items-center gap-3 py-3", i < PAYMENT_METHODS.length - 1 && "border-b border-gray-100")}>
                            {m.logo ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.logo} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                            ) : (
                              <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", m.accent)}>
                                <Icon size={17} />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900">{m.title}</p>
                              <p className="text-[11px] text-gray-400">{m.subtitle}</p>
                            </div>
                            <ToggleSwitch
                              checked={settings[m.key]}
                              disabled={isOnlyOneLeft}
                              onChange={(v) => setSettings({ ...settings, [m.key]: v })}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-gray-300 pt-2">At least one payment method must stay on.</p>
                  </SectionCard>

                  <SectionCard title="Préférences générales — this device only">
                    <div className="flex items-center justify-between">
                      <div className="pr-4">
                        <p className="text-sm font-semibold text-gray-900">Confirm before finalizing a sale</p>
                        <p className="text-[11px] text-gray-400">
                          Require a second tap on Cash / Orange Money / Mobile Money before the sale is actually charged.
                        </p>
                      </div>
                      <ToggleSwitch checked={confirmBeforeCharge} onChange={setConfirmBeforeCharge} />
                    </div>
                    <p className="text-[11px] text-gray-300 mt-4">
                      Saved to this browser only, not to the shared ticket settings — each register can be tuned on its own.
                    </p>
                  </SectionCard>

                </div>

                <TillsCard />

                {/* Save bar — covers Ticket, Printer, Store & Payment Methods (Preferences/Users save on their own) */}
                <div className="sticky bottom-0 bg-gray-100/95 backdrop-blur-sm -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 border-t border-gray-200">
                  {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3.5 py-2.5 mb-3">{error}</div>}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className={clsx(
                      "w-full sm:w-auto sm:min-w-[260px] flex items-center justify-center gap-2 font-semibold text-sm rounded-xl py-3 px-8 transition-colors",
                      saved ? "bg-green-500 text-white" : "bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-60"
                    )}
                  >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null}
                    {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </PosShell>

      <PrintArea settings={settings} data={printData} />
    </>
  );
}
