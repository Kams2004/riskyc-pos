import { apiFetch, API_BASE_URL, handleUnauthorized } from "@/lib/apiClient";
import { Category, MediaItem, Product, ProductColor } from "@/lib/types";

/** Mirrors the main admin's lib/api/products.ts — same backend endpoints, same per-section permissions. */

export function listCategories() {
  return apiFetch<Category[]>("/api/categories");
}

/** Includes hidden products; scoped server-side to the cashier's own shop. */
export function listAdminProducts(token: string) {
  return apiFetch<Product[]>("/api/products/admin", { token });
}

export function getProduct(id: string, token: string) {
  return apiFetch<Product>(`/api/products/${id}`, { token });
}

export interface ProductInput {
  name: string;
  description?: string;
  price: number;
  originalPrice?: number;
  categorySlug: string;
  subcategorySlug?: string;
  sizes: string[];
  tags: string[];
  badge?: string;
  hidden?: boolean;
  colors: { name: string; hex: string }[];
  bulkPrices?: { quantity: number; price: number }[];
}

export function createProduct(data: ProductInput, token: string) {
  return apiFetch<Product>("/api/products", { method: "POST", token, body: JSON.stringify(data) });
}

export function deleteProduct(id: string, token: string) {
  return apiFetch<void>(`/api/products/${id}`, { method: "DELETE", token });
}

export function setProductVisibility(id: string, hidden: boolean, token: string) {
  return apiFetch<Product>(`/api/products/${id}/visibility`, { method: "PATCH", token, body: JSON.stringify({ hidden }) });
}

export async function uploadProductMedia(productId: string, file: File, token: string): Promise<MediaItem> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE_URL}/api/products/${productId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    await handleUnauthorized(res.status, true);
    throw new Error(body.message || "Couldn't upload the image");
  }
  return res.json();
}

export function deleteMedia(mediaId: string, token: string) {
  return apiFetch<void>(`/api/media/${mediaId}`, { method: "DELETE", token });
}

export function updateProductInfo(
  id: string,
  data: { name: string; description?: string; categorySlug: string; subcategorySlug?: string },
  token: string
) {
  return apiFetch<Product>(`/api/products/${id}/info`, { method: "PATCH", token, body: JSON.stringify(data) });
}

export function updateProductPricing(
  id: string,
  data: { price: number; originalPrice?: number; bulkPrices?: { quantity: number; price: number }[] },
  token: string
) {
  return apiFetch<Product>(`/api/products/${id}/pricing`, { method: "PATCH", token, body: JSON.stringify(data) });
}

export function updateProductColors(id: string, colors: Pick<ProductColor, "id" | "name" | "hex">[], token: string) {
  return apiFetch<Product>(`/api/products/${id}/colors`, { method: "PATCH", token, body: JSON.stringify({ colors }) });
}

/** colorName/size are "" for a product without colors/sizes, matching ProductVariant's convention. */
/** One (color, size) stock row. `untracked: true` makes it unlimited (quantity ignored); a server without that field just ignores it. */
export interface StockEntry {
  colorName: string;
  size: string;
  quantity: number;
  untracked?: boolean;
}

export function updateProductStock(id: string, variants: StockEntry[], token: string) {
  return apiFetch<Product>(`/api/products/${id}/stock`, { method: "PATCH", token, body: JSON.stringify({ variants }) });
}

export function updateProductDisplay(id: string, data: { badge?: string; sizes: string[] }, token: string) {
  return apiFetch<Product>(`/api/products/${id}/display`, { method: "PATCH", token, body: JSON.stringify(data) });
}
