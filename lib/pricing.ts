import { BulkPriceTier } from "@/lib/types";

/**
 * Splits bulk-tier pricing for a product across several cart lines of that
 * same product (e.g. one line per size) as one shared, continuous
 * quantity, instead of pricing each line in isolation — 2 + 3 + 5 units of
 * the same product across three lines gets a 10-for-20,000 tier exactly as
 * if they'd been one line of 10, rather than each line individually
 * falling short of the tier and paying full price. Mirrors the backend's
 * PricingService.allocateGroupedLineTotals exactly (ported from the main
 * storefront's lib/pricing.ts), so a cashier's preview always matches what
 * the sale actually charges.
 *
 * Tiers apply greedily by largest-quantity first; any leftover is charged
 * at the regular unit price. The resulting tier "chunks" are walked in the
 * order `quantities` was given, splitting a chunk across a line boundary
 * when a line's quantity doesn't land evenly on one — so a single quantity
 * naturally reduces to plain flat pricing.
 */
export function allocateGroupedLineTotals(
  unitPrice: number,
  bulkPrices: BulkPriceTier[] | undefined,
  quantities: number[]
): number[] {
  const totalQuantity = quantities.reduce((s, q) => s + q, 0);
  if (totalQuantity <= 0) return quantities.map(() => 0);

  const tiers = (bulkPrices ?? [])
    .filter((t) => t.quantity > 0 && t.price > 0)
    .sort((a, b) => b.quantity - a.quantity);

  const chunks: { units: number; totalPrice: number }[] = [];
  let remaining = totalQuantity;
  for (const tier of tiers) {
    if (remaining >= tier.quantity) {
      const count = Math.floor(remaining / tier.quantity);
      for (let i = 0; i < count; i++) chunks.push({ units: tier.quantity, totalPrice: tier.price });
      remaining -= count * tier.quantity;
    }
  }
  if (remaining > 0) chunks.push({ units: remaining, totalPrice: unitPrice * remaining });

  const lineTotals: number[] = [];
  let chunkIndex = 0;
  let unitsUsedInChunk = 0;
  for (const quantity of quantities) {
    let lineTotal = 0;
    let remainingForLine = quantity;
    while (remainingForLine > 0) {
      const chunk = chunks[chunkIndex];
      const unitsLeftInChunk = chunk.units - unitsUsedInChunk;
      const take = Math.min(remainingForLine, unitsLeftInChunk);
      const perUnit = chunk.totalPrice / chunk.units;
      lineTotal += perUnit * take;
      unitsUsedInChunk += take;
      remainingForLine -= take;
      if (unitsUsedInChunk >= chunk.units) {
        chunkIndex++;
        unitsUsedInChunk = 0;
      }
    }
    lineTotals.push(Math.round(lineTotal));
  }
  return lineTotals;
}

/**
 * The bulk-price reduction of a past sale, for reprinting its ticket. A sale stores only the effective unit price
 * per line (line total ÷ quantity), not the regular price, so this re-prices the sale with the product's current
 * price and tiers — and trusts the result only if that reproduces every stored line total. If a price or tier has
 * changed since, the reduction can't be known and 0 is returned (no discount line) rather than a made-up figure.
 */
export function reconstructSaleDiscount(
  items: { productId: string | null; quantity: number; unitPrice: number }[],
  total: number,
  products: { id: string; price: number; bulkPrices?: BulkPriceTier[] }[]
): number {
  const byId = new Map(products.map((p) => [p.id, p]));
  const groups = new Map<string, { quantity: number; lineTotal: number }[]>();
  for (const item of items) {
    if (!item.productId || !byId.has(item.productId)) return 0;
    const list = groups.get(item.productId) ?? [];
    list.push({ quantity: item.quantity, lineTotal: item.unitPrice * item.quantity });
    groups.set(item.productId, list);
  }
  let regularTotal = 0;
  for (const [productId, lines] of groups) {
    const product = byId.get(productId)!;
    const repriced = allocateGroupedLineTotals(product.price, product.bulkPrices, lines.map((l) => l.quantity));
    // Stored unit prices are rounded to 2 decimals, so allow a franc of rounding per line.
    if (repriced.some((t, i) => Math.abs(t - lines[i].lineTotal) > 1)) return 0;
    regularTotal += lines.reduce((s, l) => s + product.price * l.quantity, 0);
  }
  return Math.max(0, Math.round(regularTotal - total));
}
