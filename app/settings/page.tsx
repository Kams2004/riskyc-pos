"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Receipt, Store, Printer, CreditCard, SlidersHorizontal, Users, ChevronRight } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import PosShell from "@/components/PosShell";

const TILES = [
  { href: "/settings/ticket", icon: Receipt, title: "Ticket de caisse", subtitle: "Customize what's printed on the receipt", accent: "bg-brand-50 text-brand-600" },
  { href: "/settings/store", icon: Store, title: "Informations du magasin", subtitle: "Name, address, phone, logo", accent: "bg-purple-50 text-purple-600" },
  { href: "/settings/printer", icon: Printer, title: "Imprimante", subtitle: "Paper size, test print, auto-print", accent: "bg-blue-50 text-blue-600" },
  { href: "/settings/payment-methods", icon: CreditCard, title: "Moyens de paiement", subtitle: "Cash, Orange Money, Mobile Money", accent: "bg-green-50 text-green-600" },
  { href: "/settings/preferences", icon: SlidersHorizontal, title: "Préférences générales", subtitle: "Sale flow behavior on this till", accent: "bg-amber-50 text-amber-600" },
  { href: "/settings/users", icon: Users, title: "Utilisateurs & Accès", subtitle: "Who can use this register", accent: "bg-rose-50 text-rose-600" },
];

export default function SettingsHubPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canManage = usePosAuthStore((s) => s.hasPermission("MANAGE_POS"));

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canManage) router.replace("/pos");
  }, [hasHydrated, session, canManage, router]);

  return (
    <PosShell title="Settings">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-4 sm:p-6">
          <p className="text-sm text-gray-400 mb-5">Configure this point of sale to fit your needs.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TILES.map((tile) => {
              const Icon = tile.icon;
              return (
                <Link
                  key={tile.href}
                  href={tile.href}
                  className="flex items-center gap-4 bg-white border border-gray-100 rounded-2xl p-4 hover:border-brand-200 hover:shadow-sm transition-all"
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${tile.accent}`}>
                    <Icon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{tile.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-snug">{tile.subtitle}</p>
                  </div>
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </PosShell>
  );
}
