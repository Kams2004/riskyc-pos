import { apiFetch, ApiError, API_BASE_URL } from "@/lib/apiClient";
import { desktop, isDesktop } from "@/lib/desktop";
import { useTillStore } from "@/lib/tillStore";
import { t } from "@/lib/i18n";
import { OnlineOrder, PosCatalog, PosPaymentMethod, PosReconciliationLine, PosSale, PosSettings } from "@/lib/types";

/**
 * Desktop app: every successful load refreshes the till's encrypted offline copy, and when the server can't be
 * reached (or the cashier signed in offline, with no server token) the offline copy is used instead. Already known
 * to be offline, the copy is returned at once rather than after the request times out.
 */
export async function withOfflineCopy<T>(cacheKey: string, token: string, load: () => Promise<T>): Promise<T> {
  if (!isDesktop()) return load();
  if (!useTillStore.getState().online || !token) {
    const cached = await desktop.cacheGet<T>(cacheKey).catch(() => null);
    if (cached) return cached;
  }
  try {
    const fresh = await load();
    desktop.cacheSet(cacheKey, fresh).catch(() => {});
    return fresh;
  } catch (e) {
    if (!(e instanceof ApiError) || !token) {
      const cached = await desktop.cacheGet<T>(cacheKey).catch(() => null);
      if (cached) return cached;
    }
    throw e;
  }
}

export function getCatalog(token: string) {
  return withOfflineCopy("catalog", token, () => apiFetch<PosCatalog>("/api/pos/catalog", { token }));
}

export function listSales(token: string) {
  return withOfflineCopy("sales", token, () => apiFetch<PosSale[]>("/api/pos/sales", { token }));
}

/** Online orders that reached PACKAGED — counted as completed sales alongside till sales. */
export function listOnlineSales(token: string) {
  return withOfflineCopy("onlineSales", token, () => apiFetch<OnlineOrder[]>("/api/pos/online-sales", { token }));
}

/** Every online order for this shop, any status — needs VIEW_ORDERS. */
export function listOrders(token: string) {
  return withOfflineCopy("orders", token, () => apiFetch<OnlineOrder[]>("/api/orders", { token }));
}

export function listFlaggedSales(token: string) {
  return apiFetch<PosSale[]>("/api/pos/sales/flagged", { token });
}

export function listReconciliation(token: string) {
  return withOfflineCopy("reconciliation", token, () => apiFetch<PosReconciliationLine[]>("/api/pos/reconciliation", { token }));
}

export function resolveReconciliation(token: string, itemId: string) {
  return apiFetch<PosReconciliationLine>(`/api/pos/reconciliation/${itemId}/resolve`, { method: "POST", token });
}

export type SaleLineInput =
  | { productId: string; quantity: number; selectedColor: string; selectedSize: string }
  | { amount: number; quantity: number; label?: string };

export interface CreateSaleInput {
  clientSaleId: string;
  /** A product line, or a calculator amount line ("Articles divers": no product, no stock — see app/calculator). */
  items: SaleLineInput[];
  paymentMethod: PosPaymentMethod;
  soldAt: string;
}

export function createSale(token: string, data: CreateSaleInput) {
  // 15s, then the sale is kept on the till; if it did reach the server after all, the later upload is a no-op
  // (same clientSaleId).
  return apiFetch<PosSale>("/api/pos/sales", { method: "POST", token, body: JSON.stringify(data), timeoutMs: 15_000 });
}

export function voidSale(token: string, saleId: string) {
  return apiFetch<PosSale>(`/api/pos/sales/${saleId}/void`, { method: "POST", token });
}

export function getSettings(token: string) {
  return withOfflineCopy("settings", token, () => apiFetch<PosSettings>("/api/pos/settings", { token }));
}

export function updateSettings(token: string, data: Omit<PosSettings, "logoUrl">) {
  return apiFetch<PosSettings>("/api/pos/settings", { method: "PATCH", token, body: JSON.stringify(data) });
}

export async function uploadLogo(token: string, file: File): Promise<PosSettings> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/pos/settings/logo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || t("settings.logoUploadFailed"));
  return res.json();
}

export function removeLogo(token: string) {
  return apiFetch<PosSettings>("/api/pos/settings/logo", { method: "DELETE", token });
}

// ── Tills (desktop app devices) ──

export interface PosDevice {
  id: string;
  name: string;
  platform: string | null;
  appVersion: string | null;
  enrolledAt: string;
  enrolledByName: string | null;
  lastSeenAt: string | null;
  online: boolean;
  pendingSales: number;
  revokedAt: string | null;
}

export function listDevices(token: string) {
  return apiFetch<PosDevice[]>("/api/pos/devices", { token });
}

export function createEnrollmentCode(token: string) {
  return apiFetch<{ code: string; expiresAt: string }>("/api/pos/devices/enrollment-codes", { method: "POST", token });
}

export function revokeDevice(token: string, id: string) {
  return apiFetch<PosDevice>(`/api/pos/devices/${id}/revoke`, { method: "POST", token });
}
