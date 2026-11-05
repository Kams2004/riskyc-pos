import { create } from "zustand";
import { API_BASE_URL } from "./apiClient";
import { desktop, isDesktop } from "./desktop";
import { useTillStore } from "./tillStore";
import { PosPaymentMethod, PosSale, Product } from "./types";

/**
 * Sales rung up on the desktop app while the server couldn't be reached. They live in the till's encrypted local
 * database (never localStorage), are uploaded through the till's own device endpoint — so they sync even after the
 * cashier who made them has logged out — and are recorded server-side exactly like a live sale (same pricing, stock
 * and reconciliation rules). Re-uploading is harmless: the server recognises each sale by its clientSaleId.
 */
export interface QueuedSaleItem {
  productId: string;
  productName: string;
  thumbnailUrl: string | null;
  quantity: number;
  selectedColor: string;
  selectedSize: string;
  /** Effective unit price after bulk pricing — what the ticket printed. */
  unitPrice: number;
}

export interface QueuedSale {
  clientSaleId: string;
  cashierId: string;
  cashierName: string;
  items: QueuedSaleItem[];
  paymentMethod: PosPaymentMethod;
  soldAt: string;
  total: number;
  discount: number;
  /**
   * PENDING = waiting to upload (retried automatically; `error` then says why the last try didn't go through).
   * REJECTED = the server refused it as sent — kept aside with the reason in `error` until retried or discarded.
   */
  status: "PENDING" | "REJECTED";
  error?: string;
}

interface DeviceSaleResult {
  clientSaleId: string;
  /** RECORDED/DUPLICATE: the server has it. REJECTED: refused as sent. ERROR (or anything unknown): try again later. */
  status: string;
  saleId: string | null;
  error: string | null;
}

interface OfflineSalesState {
  loaded: boolean;
  sales: QueuedSale[];
  syncing: boolean;
  lastSyncError: string | null;
  /** Bumped whenever an upload moved sales onto the server, so screens can reload their server data. */
  syncedVersion: number;
  load: () => Promise<void>;
  enqueue: (sale: QueuedSale) => Promise<void>;
  discard: (clientSaleId: string) => Promise<void>;
  /** Puts a refused sale back in the queue and uploads it again (e.g. after an admin fixed the cashier's shop). */
  retry: (clientSaleId: string) => Promise<void>;
  syncNow: () => Promise<void>;
}

const BATCH_SIZE = 200; // the server's DeviceSaleBatchRequest limit

let writeChain: Promise<unknown> = Promise.resolve();
/**
 * Writes are chained so two quick changes can never land in the store out of order. The returned promise rejects if
 * this write failed (the chain itself carries on), so a caller can tell a sale was NOT saved.
 */
function persist(sales: QueuedSale[]): Promise<void> {
  const write = writeChain.then(() => desktop.salesQueueSet(sales));
  writeChain = write.catch(() => {});
  return write;
}

/** The till's own database couldn't take the sale — the cashier must know it isn't recorded anywhere. */
export class OfflineSaveError extends Error {
  constructor() {
    super("The sale couldn't be saved on this till, so it is NOT recorded. Keep the basket and try again, or write the sale down.");
    this.name = "OfflineSaveError";
  }
}

export const useOfflineSalesStore = create<OfflineSalesState>()((set, get) => ({
  loaded: false,
  sales: [],
  syncing: false,
  lastSyncError: null,
  syncedVersion: 0,

  load: async () => {
    if (!isDesktop() || get().loaded) return;
    // A failed read throws instead of looking like an empty queue — writing then would overwrite unsynced sales.
    const saved = await desktop.salesQueueGet<QueuedSale[]>();
    // Anything enqueued before the saved copy finished loading is kept too.
    const current = get().sales;
    const merged = [...(saved ?? []).filter((s) => !current.some((c) => c.clientSaleId === s.clientSaleId)), ...current];
    set({ loaded: true, sales: merged });
  },

  enqueue: async (sale) => {
    try {
      await get().load();
      const sales = [...get().sales, sale];
      await persist(sales);
      // Shown (and counted) only once it's really on disk.
      set({ sales: [...get().sales.filter((s) => s.clientSaleId !== sale.clientSaleId), sale] });
    } catch {
      throw new OfflineSaveError();
    }
  },

  discard: async (clientSaleId) => {
    await get().load();
    const sales = get().sales.filter((s) => s.clientSaleId !== clientSaleId);
    await persist(sales);
    set({ sales });
  },

  retry: async (clientSaleId) => {
    await get().load();
    const sales = get().sales.map((s) => (s.clientSaleId === clientSaleId ? { ...s, status: "PENDING" as const, error: undefined } : s));
    await persist(sales);
    set({ sales });
    await get().syncNow();
  },

  syncNow: async () => {
    const device = useTillStore.getState().device;
    if (!isDesktop() || !device || get().syncing) return;
    // Claimed before any await, so two calls in quick succession can't both upload the same sales.
    set({ syncing: true, lastSyncError: null });
    try {
      await get().load();
      const pending = get().sales.filter((s) => s.status === "PENDING");
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        const res = await fetch(`${API_BASE_URL}/api/pos/device/sales/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Device-Token": device.deviceToken },
          body: JSON.stringify({
            sales: batch.map((s) => ({
              clientSaleId: s.clientSaleId,
              cashierId: s.cashierId,
              items: s.items.map((it) => ({
                productId: it.productId,
                quantity: it.quantity,
                selectedColor: it.selectedColor,
                selectedSize: it.selectedSize,
              })),
              paymentMethod: s.paymentMethod,
              soldAt: s.soldAt,
            })),
          }),
        });
        if (!res.ok) {
          // A whole-batch failure (server error, revoked till) — nothing was decided, everything stays queued.
          set({ lastSyncError: `The server answered ${res.status}; the sales stay saved on this till.` });
          return;
        }
        const results = (await res.json()) as DeviceSaleResult[];
        const byId = new Map(results.map((r) => [r.clientSaleId, r]));
        const onServer = (r?: DeviceSaleResult) => r?.status === "RECORDED" || r?.status === "DUPLICATE";
        const sales = get()
          .sales.filter((s) => !onServer(byId.get(s.clientSaleId)))
          .map((s) => {
            const r = byId.get(s.clientSaleId);
            if (!r) return s;
            if (r.status === "REJECTED") return { ...s, status: "REJECTED" as const, error: r.error ?? "Refused by the server." };
            // ERROR or anything unknown: a temporary problem on the server — stays pending and is retried.
            return { ...s, status: "PENDING" as const, error: r.error ?? "The server had a temporary problem." };
          });
        const movedToServer = results.some((r) => onServer(r));
        set((state) => ({ sales, syncedVersion: movedToServer ? state.syncedVersion + 1 : state.syncedVersion }));
        if (results.some((r) => !onServer(r) && r.status !== "REJECTED")) {
          set({ lastSyncError: "Some sales couldn't be recorded yet because of a server problem; they'll be retried." });
        }
        // If this write fails, the next start re-uploads the same sales; the server answers DUPLICATE for those.
        await persist(sales).catch(() => {});
      }
    } catch {
      // Still offline — try again on the next round.
    } finally {
      set({ syncing: false });
    }
  },
}));

/** Queued sales that still count as sales (rejected ones are set aside until someone deals with them). */
export function pendingSales(sales: QueuedSale[], recordedClientIds?: Set<string>) {
  return sales.filter((s) => s.status === "PENDING" && !recordedClientIds?.has(s.clientSaleId));
}

/** What a queued sale looks like to the screens that show sales — the success toast, receipts, history. */
export function queuedSaleAsPosSale(s: QueuedSale): PosSale {
  return {
    id: s.clientSaleId,
    clientSaleId: s.clientSaleId,
    cashierId: s.cashierId,
    cashierName: s.cashierName,
    enterpriseId: null,
    items: s.items.map((it, i) => ({
      id: `${s.clientSaleId}-${i}`,
      productId: it.productId,
      productName: it.productName,
      thumbnailUrl: it.thumbnailUrl,
      quantity: it.quantity,
      selectedColor: it.selectedColor,
      selectedSize: it.selectedSize,
      unitPrice: it.unitPrice,
    })),
    total: s.total,
    paymentMethod: s.paymentMethod,
    receiptUrl: null,
    soldAt: s.soldAt,
    syncedAt: "",
    stockReconciliationFlag: false,
    voided: false,
    voidedByName: null,
    voidedAt: null,
  };
}

/**
 * The catalog as the cashier should see it: stock already taken by sales still waiting to sync is subtracted, so the
 * till doesn't offer units it has already sold. Unlimited variants are left alone.
 */
export function withPendingStockTaken(products: Product[], queued: QueuedSale[]): Product[] {
  if (queued.length === 0) return products;
  const taken = new Map<string, number>();
  for (const sale of queued) {
    for (const it of sale.items) {
      const key = `${it.productId}::${it.selectedColor}::${it.selectedSize}`;
      taken.set(key, (taken.get(key) ?? 0) + it.quantity);
    }
  }
  return products.map((p) => {
    if (!p.variants?.some((v) => taken.has(`${p.id}::${v.colorName}::${v.size}`))) return p;
    return {
      ...p,
      variants: p.variants.map((v) => {
        const n = taken.get(`${p.id}::${v.colorName}::${v.size}`);
        return n && !v.untracked ? { ...v, quantity: v.quantity - n } : v;
      }),
    };
  });
}

/**
 * A till sale's "Sale #" on tickets and in Sales History: the first 8 characters of the id the till gave it
 * (clientSaleId), which is the same before and after an offline sale syncs. Falls back to the server id.
 */
export function saleRefOf(sale: { clientSaleId?: string | null; id?: string }): string {
  return (sale.clientSaleId || sale.id || "").slice(0, 8).toUpperCase();
}
