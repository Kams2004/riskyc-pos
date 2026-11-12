import { create } from "zustand";
import { API_BASE_URL, fetchWithTimeout } from "./apiClient";
import { desktop, isDesktop } from "./desktop";
import { useTillStore } from "./tillStore";
import { t } from "./i18n";
import { PosPaymentMethod, PosSale, Product } from "./types";

/**
 * Sales rung up on the desktop app while the server couldn't be reached. They live in the till's encrypted local
 * database (never localStorage), are uploaded through the till's own device endpoint — so they sync even after the
 * cashier who made them has logged out — and are recorded server-side exactly like a live sale (same pricing, stock
 * and reconciliation rules). Re-uploading is harmless: the server recognises each sale by its clientSaleId.
 */
export interface QueuedSaleItem {
  /** Null for a calculator amount line ("Articles divers"): unitPrice is the amount, nothing is stock-counted. */
  productId: string | null;
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
  /** When the last upload finished and how many sales it put on the server — drives the brief "synced" confirmation. */
  lastSyncAt: number | null;
  lastSyncedCount: number;
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
    super(t("offline.saveFailed"));
    this.name = "OfflineSaveError";
  }
}

export const useOfflineSalesStore = create<OfflineSalesState>()((set, get) => ({
  loaded: false,
  sales: [],
  syncing: false,
  lastSyncError: null,
  lastSyncAt: null,
  lastSyncedCount: 0,
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
    let recorded = 0;
    try {
      await get().load();
      const pending = get().sales.filter((s) => s.status === "PENDING");
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        const res = await fetchWithTimeout(`${API_BASE_URL}/api/pos/device/sales/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Device-Token": device.deviceToken },
          body: JSON.stringify({
            sales: batch.map((s) => ({
              clientSaleId: s.clientSaleId,
              cashierId: s.cashierId,
              items: s.items.map((it) =>
                it.productId
                  ? { productId: it.productId, quantity: it.quantity, selectedColor: it.selectedColor, selectedSize: it.selectedSize }
                  : { amount: it.unitPrice, quantity: it.quantity, label: it.productName }
              ),
              paymentMethod: s.paymentMethod,
              soldAt: s.soldAt,
            })),
          }),
        }, 30_000);
        if (!res.ok) {
          // A whole-batch failure (server error, revoked till) — nothing was decided, everything stays queued.
          const body = await res.json().catch(() => null);
          set({
            lastSyncError:
              res.status === 401
                ? t("offline.tillUnlinked")
                : t("offline.uploadRefused", { status: res.status, detail: body?.message ? `: ${body.message}` : "" }),
          });
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
            if (r.status === "REJECTED") return { ...s, status: "REJECTED" as const, error: r.error ?? t("offline.refused") };
            // ERROR or anything unknown: a temporary problem on the server — stays pending and is retried.
            return { ...s, status: "PENDING" as const, error: r.error ?? t("offline.temporaryProblem") };
          });
        const movedToServer = results.some((r) => onServer(r));
        recorded += results.filter((r) => onServer(r)).length;
        set((state) => ({ sales, syncedVersion: movedToServer ? state.syncedVersion + 1 : state.syncedVersion }));
        if (results.some((r) => !onServer(r) && r.status !== "REJECTED")) {
          set({ lastSyncError: t("offline.someRetried") });
        }
        // If this write fails, the next start re-uploads the same sales; the server answers DUPLICATE for those.
        await persist(sales).catch(() => {});
      }
    } catch {
      set({
        lastSyncError: useTillStore.getState().online
          ? t("offline.noAnswer")
          : t("offline.tillOffline"),
      });
    } finally {
      set({ syncing: false, lastSyncAt: Date.now(), lastSyncedCount: recorded });
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
      if (!it.productId) continue; // calculator amount lines take no stock
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
