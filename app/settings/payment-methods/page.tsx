"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2, Check, Banknote, Smartphone } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { getSettings, updateSettings } from "@/lib/api/pos";
import { PosSettings } from "@/lib/types";
import PosShell from "@/components/PosShell";
import ToggleSwitch from "@/components/ToggleSwitch";

const METHODS: {
  key: "cashEnabled" | "orangeMoneyEnabled" | "mobileMoneyEnabled";
  icon: typeof Banknote;
  title: string;
  subtitle: string;
  accent: string;
}[] = [
  { key: "cashEnabled", icon: Banknote, title: "Cash", subtitle: "Paid in physical currency", accent: "bg-green-50 text-green-600" },
  { key: "orangeMoneyEnabled", icon: Smartphone, title: "Orange Money", subtitle: "Mobile payment via Orange", accent: "bg-orange-50 text-orange-600" },
  { key: "mobileMoneyEnabled", icon: Smartphone, title: "Mobile Money", subtitle: "Mobile payment via MTN", accent: "bg-amber-50 text-amber-600" },
];

export default function PaymentMethodsSettingsPage() {
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

  const enabledCount = settings ? METHODS.filter((m) => settings[m.key]).length : 0;

  return (
    <PosShell title="Moyens de paiement">
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
            <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-1">
              <p className="text-xs text-gray-400 mb-3">Choose which payment buttons show up on the sale screen.</p>
              {METHODS.map((m, i) => {
                const Icon = m.icon;
                const isOnlyOneLeft = enabledCount === 1 && settings[m.key];
                return (
                  <div key={m.key} className={clsx("flex items-center gap-3 py-3", i < METHODS.length - 1 && "border-b border-gray-50")}>
                    <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", m.accent)}>
                      <Icon size={17} />
                    </div>
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
              <p className="text-[11px] text-gray-300 pt-2">At least one payment method must stay on.</p>

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
          )}
        </div>
      </div>
    </PosShell>
  );
}
