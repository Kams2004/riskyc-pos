import { Product, ProductVariant } from "./types";

export function variantKey(colorName: string, size: string): string {
  return `${colorName || ""}::${size || ""}`;
}

export function findVariant(product: Pick<Product, "variants">, selectedColor: string, selectedSize: string): ProductVariant | undefined {
  return product.variants.find((v) => v.colorName === (selectedColor || "") && v.size === (selectedSize || ""));
}

/** Infinity for an untracked migration sentinel or a combo with no variant row yet — same convention as the storefront's lib/stock.ts. */
export function availableQuantity(product: Pick<Product, "variants">, selectedColor: string, selectedSize: string): number {
  const variant = findVariant(product, selectedColor, selectedSize);
  if (!variant || variant.untracked) return Infinity;
  return Math.max(0, variant.quantity);
}

export function isProductSoldOut(product: Pick<Product, "variants">): boolean {
  const tracked = product.variants.filter((v) => !v.untracked);
  if (tracked.length === 0) return false;
  return tracked.every((v) => v.quantity <= 0);
}

/** For the small stock dot on a catalog card — "high" when untracked (nothing to warn about) or there's no tight limit in sight. */
export function stockLevel(product: Pick<Product, "variants">): "out" | "low" | "high" {
  const tracked = product.variants.filter((v) => !v.untracked);
  if (tracked.length === 0) return "high";
  const total = tracked.reduce((s, v) => s + Math.max(0, v.quantity), 0);
  if (total <= 0) return "out";
  if (total <= 5) return "low";
  return "high";
}
