import { apiFetch, API_BASE_URL } from "@/lib/apiClient";
import { PosCatalog, PosPaymentMethod, PosSale, PosSettings } from "@/lib/types";

export function getCatalog(token: string) {
  return apiFetch<PosCatalog>("/api/pos/catalog", { token });
}

export function listSales(token: string) {
  return apiFetch<PosSale[]>("/api/pos/sales", { token });
}

export function listFlaggedSales(token: string) {
  return apiFetch<PosSale[]>("/api/pos/sales/flagged", { token });
}

export interface CreateSaleInput {
  clientSaleId: string;
  items: { productId: string; quantity: number; selectedColor: string; selectedSize: string }[];
  paymentMethod: PosPaymentMethod;
  soldAt: string;
}

export function createSale(token: string, data: CreateSaleInput) {
  return apiFetch<PosSale>("/api/pos/sales", { method: "POST", token, body: JSON.stringify(data) });
}

export function voidSale(token: string, saleId: string) {
  return apiFetch<PosSale>(`/api/pos/sales/${saleId}/void`, { method: "POST", token });
}

export function getSettings(token: string) {
  return apiFetch<PosSettings>("/api/pos/settings", { token });
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
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Couldn't upload logo");
  return res.json();
}
