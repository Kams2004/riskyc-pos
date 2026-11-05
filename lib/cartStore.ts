import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { CartLine, Product } from "./types";

/**
 * The sale being rung up. It lives outside the Sale screen so a cashier can check Sales History or a product
 * and come back to the same basket. Kept in sessionStorage: it survives a page reload but not closing the app,
 * so a forgotten basket doesn't reappear the next morning. Tagged with the cashier who built it — another
 * cashier logging in on the same till starts empty rather than inheriting someone else's sale.
 */
interface PosCartStore {
  ownerId: string | null;
  lines: CartLine[];
  setLines: (ownerId: string, update: CartLine[] | ((prev: CartLine[]) => CartLine[])) => void;
  /** Swap in the latest product data (price, stock, photos) and drop lines whose product is gone from the catalog. */
  refreshProducts: (products: Product[]) => void;
  clear: () => void;
}

export const usePosCartStore = create<PosCartStore>()(
  persist(
    (set, get) => ({
      ownerId: null,
      lines: [],
      setLines: (ownerId, update) => {
        const prev = get().ownerId === ownerId ? get().lines : [];
        set({ ownerId, lines: typeof update === "function" ? update(prev) : update });
      },
      refreshProducts: (products) => {
        const byId = new Map(products.map((p) => [p.id, p]));
        const lines = get().lines.flatMap((l) => {
          const fresh = byId.get(l.product.id);
          return fresh ? [{ ...l, product: fresh }] : [];
        });
        set({ lines });
      },
      clear: () => set({ ownerId: null, lines: [] }),
    }),
    { name: "riskyc-pos-cart-v1", storage: createJSONStorage(() => sessionStorage) }
  )
);
