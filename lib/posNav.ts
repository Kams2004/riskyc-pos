import type { TKey } from "./i18n";
import { ShoppingCart, Receipt, ClipboardList, Package, AlertTriangle, Settings as SettingsIcon } from "lucide-react";

/**
 * The POS sidebar. Every screen has its own permission, ticked per role in the admin panel's Users & Roles, so a
 * cashier only sees (and can only open) the screens their role allows. VIEW_POS alone just lets someone sign in.
 */
export const POS_NAV_ITEMS = [
  { href: "/pos", labelKey: "nav.sale" as TKey, icon: ShoppingCart, permission: "POS_SELL" },
  { href: "/sales", labelKey: "nav.salesHistory" as TKey, icon: Receipt, permission: "POS_VIEW_SALES" },
  { href: "/orders", labelKey: "nav.orders" as TKey, icon: ClipboardList, permission: "VIEW_ORDERS" },
  { href: "/products", labelKey: "nav.products" as TKey, icon: Package, permission: "VIEW_PRODUCTS" },
  { href: "/reconciliation", labelKey: "nav.reconciliation" as TKey, icon: AlertTriangle, permission: "POS_RECONCILE" },
  { href: "/settings", labelKey: "nav.settings" as TKey, icon: SettingsIcon, permission: "MANAGE_POS" },
] as const;

export function allowedNavItems(hasPermission: (p: string) => boolean) {
  return POS_NAV_ITEMS.filter((item) => hasPermission(item.permission));
}

/** Where to send a signed-in cashier: the first screen their role allows, or null if it allows none. */
export function firstAllowedPath(hasPermission: (p: string) => boolean): string | null {
  return allowedNavItems(hasPermission)[0]?.href ?? null;
}

/** The sidebar entry a path belongs to (sub-pages like /products/new count as /products). */
export function navItemFor(pathname: string) {
  return POS_NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(item.href + "/"));
}
