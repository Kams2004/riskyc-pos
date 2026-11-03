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
