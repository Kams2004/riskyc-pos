import { ShoppingCart, Receipt, ClipboardList, Package, AlertTriangle, Settings as SettingsIcon } from "lucide-react";

/**
 * The POS sidebar. Every screen has its own permission, ticked per role in the admin panel's Users & Roles, so a
 * cashier only sees (and can only open) the screens their role allows. VIEW_POS alone just lets someone sign in.
 */
export const POS_NAV_ITEMS = [
  { href: "/pos", label: "Sale", icon: ShoppingCart, permission: "POS_SELL" },
  { href: "/sales", label: "Sales History", icon: Receipt, permission: "POS_VIEW_SALES" },
  { href: "/orders", label: "Orders", icon: ClipboardList, permission: "VIEW_ORDERS" },
  { href: "/products", label: "Products", icon: Package, permission: "VIEW_PRODUCTS" },
  { href: "/reconciliation", label: "Reconciliation", icon: AlertTriangle, permission: "POS_RECONCILE" },
  { href: "/settings", label: "Register Settings", icon: SettingsIcon, permission: "MANAGE_POS" },
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
