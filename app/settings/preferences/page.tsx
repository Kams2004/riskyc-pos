"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import { usePosPreferencesStore } from "@/lib/posPreferencesStore";
import PosShell from "@/components/PosShell";
import ToggleSwitch from "@/components/ToggleSwitch";

export default function PreferencesSettingsPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canManage = usePosAuthStore((s) => s.hasPermission("MANAGE_POS"));
  const confirmBeforeCharge = usePosPreferencesStore((s) => s.confirmBeforeCharge);
  const setConfirmBeforeCharge = usePosPreferencesStore((s) => s.setConfirmBeforeCharge);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canManage) router.replace("/pos");
  }, [hasHydrated, session, canManage, router]);

  return (
    <PosShell title="Préférences générales">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto p-4 sm:p-6">
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-600 mb-4">
            <ChevronLeft size={14} /> Back to Settings
          </Link>

          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Sale behavior — this device only</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">Confirm before finalizing a sale</p>
                <p className="text-[11px] text-gray-400 max-w-xs">
                  Require a second tap on Cash / Orange Money / Mobile Money before the sale is actually charged.
                </p>
              </div>
              <ToggleSwitch checked={confirmBeforeCharge} onChange={setConfirmBeforeCharge} />
            </div>
          </div>

          <p className="text-[11px] text-gray-300 mt-3">
            Saved to this browser only, not to the shared ticket settings — each register can be tuned on its own.
          </p>
        </div>
      </div>
    </PosShell>
  );
}
