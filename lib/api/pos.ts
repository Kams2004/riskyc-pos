import { apiFetch } from "@/lib/apiClient";
import { PosCatalog, PosPaymentMethod, PosSale } from "@/lib/types";

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
