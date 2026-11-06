"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import { firstAllowedPath } from "@/lib/posNav";
import { useT } from "@/lib/i18n";

export default function RootPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const hasPermission = usePosAuthStore((s) => s.hasPermission);
  const logout = usePosAuthStore((s) => s.logout);
  const { t } = useT();
  const target = session ? firstAllowedPath(hasPermission) : "/login";

  useEffect(() => {
    if (hasHydrated && target) router.replace(target);
  }, [hasHydrated, target, router]);

  if (!hasHydrated || target) return null;

  // Signed in, but the role allows no POS screen at all.
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="max-w-md bg-white rounded-3xl shadow-xl border border-gray-200 p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
          <ShieldOff size={22} />
        </div>
        <h1 className="text-lg font-bold text-gray-900">{t("root.noScreenTitle")}</h1>
        <p className="text-sm text-gray-600 leading-relaxed">{t("root.noScreenBody")}</p>
        <button
          onClick={() => {
            logout();
            router.replace("/login");
          }}
          className="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold"
        >
          {t("root.signOut")}
        </button>
      </div>
    </div>
  );
}
