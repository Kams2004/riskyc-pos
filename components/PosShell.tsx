"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ShoppingCart,
  Receipt,
  AlertTriangle,
  Settings as SettingsIcon,
  LogOut,
  Wifi,
  WifiOff,
  ChevronDown,
  Loader2,
  Package,
  ClipboardList,
} from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { canReachApi } from "@/lib/apiClient";

// Products/Orders appear as soon as an admin grants the cashier's role those permissions (see useSessionRefresh).
const NAV_ITEMS = [
  { href: "/pos", label: "Sale", icon: ShoppingCart },
  { href: "/sales", label: "Sales History", icon: Receipt },
  { href: "/orders", label: "Orders", icon: ClipboardList, permission: "VIEW_ORDERS" },
  { href: "/products", label: "Products", icon: Package, permission: "VIEW_PRODUCTS" },
  { href: "/reconciliation", label: "Reconciliation", icon: AlertTriangle },
  { href: "/settings", label: "Register Settings", icon: SettingsIcon, permission: "MANAGE_POS" },
];

function useSessionRefresh(active: boolean) {
  const refreshSession = usePosAuthStore((s) => s.refreshSession);
  useEffect(() => {
    if (!active) return;
    refreshSession();
    const interval = setInterval(refreshSession, 60000);
    window.addEventListener("focus", refreshSession);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refreshSession);
    };
  }, [active, refreshSession]);
}

/** Real network probe, polled periodically — not navigator.onLine alone (see apiClient.ts#canReachApi). */
function useConnectivity() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const check = () => canReachApi().then((ok) => !cancelled && setOnline(ok));
    check();
    const interval = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);
  return online;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-sm flex-shrink-0">
        <span className="text-white font-bold text-sm font-display">RF</span>
      </div>
      <div className="min-w-0 leading-tight hidden lg:block">
        <p className="font-display font-bold text-white text-[15px] truncate">Riskyc Fashion</p>
        <p className="text-[10px] font-semibold text-brand-400 tracking-wide uppercase">Point of Sale</p>
      </div>
    </div>
  );
}

/**
 * Shared sidebar shell for every post-login POS screen — centralizes the
 * hydration-safe session gate (see authStore.ts) here instead of duplicating
 * it in each page, so a new page can't reintroduce the hydration race bug.
 */
export default function PosShell({
  title,
  headerExtra,
  children,
}: {
  title: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const logout = usePosAuthStore((s) => s.logout);
  const hasPermission = usePosAuthStore((s) => s.hasPermission);
  const online = useConnectivity();
  useSessionRefresh(hasHydrated && !!session);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!session) router.replace("/login");
  }, [hasHydrated, session, router]);

  if (!hasHydrated || !session) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <Loader2 size={22} className="animate-spin text-brand-400" />
      </div>
    );
  }

  const visibleNav = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <div className="h-screen bg-gray-100 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-16 lg:w-60 bg-gray-900 flex flex-col flex-shrink-0">
        <div className="px-3.5 lg:px-5 py-5 border-b border-white/10">
          <Logo />
        </div>
        <nav className="flex-1 px-2 lg:px-3 py-4 space-y-1">
          {visibleNav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={clsx(
                  "flex items-center justify-center lg:justify-start gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors",
                  active ? "bg-brand-500 text-white shadow-sm" : "text-gray-400 hover:bg-white/5 hover:text-white"
                )}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-2 lg:px-3 py-4 border-t border-white/10">
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            title="Log out"
            className="w-full flex items-center justify-center lg:justify-start gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <LogOut size={16} className="flex-shrink-0" /> <span className="hidden lg:inline">Log out</span>
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-3.5 flex items-center gap-4 flex-shrink-0 shadow-sm">
          <h1 className="font-bold text-gray-900 text-lg flex-shrink-0">{title}</h1>
          {headerExtra && <div className="flex-1 min-w-0">{headerExtra}</div>}
          <div className="ml-auto flex items-center gap-3 flex-shrink-0">
            <span
              className={clsx(
                "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full",
                online ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"
              )}
            >
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              {online ? "Online" : "Offline"}
            </span>
            <div className="relative">
              <button
                onClick={() => setProfileOpen((v) => !v)}
                onBlur={() => setTimeout(() => setProfileOpen(false), 150)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl hover:bg-gray-50"
              >
                <div className="w-7 h-7 rounded-full bg-brand-100 text-brand-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {session.firstName[0]}
                  {session.lastName[0]}
                </div>
                <div className="text-left leading-tight hidden sm:block">
                  <p className="text-xs font-semibold text-gray-900">{session.firstName}</p>
                  <p className="text-[10px] text-gray-400">{session.roleName}</p>
                </div>
                <ChevronDown size={14} className="text-gray-400" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white border border-gray-100 rounded-xl shadow-lg py-1.5 z-30">
                  <div className="px-3.5 py-2 border-b border-gray-50">
                    <p className="text-xs font-semibold text-gray-900">
                      {session.firstName} {session.lastName}
                    </p>
                    <p className="text-[11px] text-gray-400">{session.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      router.replace("/login");
                    }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-red-500 hover:bg-red-50"
                  >
                    <LogOut size={13} /> Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* No overflow/scroll forced here — pages that need their own split
            scroll regions (e.g. the sale screen's catalog+cart columns) set
            their own, while simpler pages just scroll the whole thing. */}
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
    </div>
  );
}
