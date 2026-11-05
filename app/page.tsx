"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import { firstAllowedPath } from "@/lib/posNav";

export default function RootPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const hasPermission = usePosAuthStore((s) => s.hasPermission);
  const logout = usePosAuthStore((s) => s.logout);
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
        <h1 className="text-lg font-bold text-gray-900">No POS screen for this account yet</h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          Your role can sign in to the point of sale but doesn&apos;t include any of its screens. Ask an admin to tick, for
          example, <span className="font-semibold text-gray-900">POS · Sale screen</span> on your role in Utilisateurs.
          This page updates on its own once they do.
        </p>
        <button
          onClick={() => {
            logout();
            router.replace("/login");
          }}
          className="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
