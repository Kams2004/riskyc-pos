"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2, Check, Upload } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { getSettings, updateSettings, uploadLogo } from "@/lib/api/pos";
import { PosSettings } from "@/lib/types";
import PosShell from "@/components/PosShell";

export default function StoreInfoSettingsPage() {
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

  return (
    <PosShell title="Store Information">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-8">
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-600 mb-4">
            <ChevronLeft size={14} /> Back to Settings
          </Link>

          {loading || !settings ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Store name</label>
                <input
                  value={settings.storeName}
                  onChange={(e) => setSettings({ ...settings, storeName: e.target.value })}
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
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Address</label>
                <input
                  value={settings.storeAddress ?? ""}
                  onChange={(e) => setSettings({ ...settings, storeAddress: e.target.value || null })}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
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
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Default footer message</label>
                <textarea
                  value={settings.footerMessage ?? ""}
                  onChange={(e) => setSettings({ ...settings, footerMessage: e.target.value || null })}
                  rows={2}
                  maxLength={120}
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 resize-none"
                  placeholder="Thank you for your visit! See you soon at Riskyc Fashion."
                />
                <p className="text-[11px] text-gray-300 text-right mt-1">{(settings.footerMessage ?? "").length}/120</p>
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
          )}
        </div>
      </div>
    </PosShell>
  );
}
