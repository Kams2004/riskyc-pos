"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ExternalLink, ShieldCheck, Users as UsersIcon } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import { ADMIN_URL } from "@/lib/apiClient";
import PosShell from "@/components/PosShell";

export default function UsersSettingsPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canManage = usePosAuthStore((s) => s.hasPermission("MANAGE_POS"));

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canManage) router.replace("/pos");
  }, [hasHydrated, session, canManage, router]);

  return (
    <PosShell title="Utilisateurs & Accès">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-8">
          <Link href="/settings" className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-600 mb-4">
            <ChevronLeft size={14} /> Back to Settings
          </Link>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center flex-shrink-0">
                <UsersIcon size={20} />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Cashiers are admin accounts</p>
                <p className="text-xs text-gray-400">There's no separate login system here</p>
              </div>
            </div>

            <p className="text-sm text-gray-600 leading-relaxed">
              A cashier signs in with the same account system as the main admin panel — a cashier is just an admin
              user assigned the <span className="font-semibold text-gray-900">Cashier</span> role (or any custom role
              with Point of Sale permissions). Create or edit cashier accounts, and decide who can void sales or
              change these settings, from <span className="font-semibold">Users &amp; Roles</span> in the main admin.
            </p>

            <div className="flex items-start gap-2.5 bg-gray-50 rounded-xl p-3.5">
              <ShieldCheck size={16} className="text-brand-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-gray-500 leading-relaxed">
                <span className="font-semibold text-gray-700">View Point of Sale</span> lets someone ring up sales,{" "}
                <span className="font-semibold text-gray-700">Manage Point of Sale</span> adds access to these
                settings pages, and <span className="font-semibold text-gray-700">Void Point of Sale Sales</span>{" "}
                lets them reverse a completed sale.
              </p>
            </div>

            <a
              href={`${ADMIN_URL}/admin/users`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 font-semibold text-sm rounded-xl py-3 bg-brand-500 hover:bg-brand-600 text-white transition-colors"
            >
              <ExternalLink size={15} /> Open Users &amp; Roles
            </a>
          </div>
        </div>
      </div>
    </PosShell>
  );
}
