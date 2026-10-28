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
