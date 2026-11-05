import { create } from "zustand";
import { API_BASE_URL } from "./apiClient";
import { desktop, isDesktop } from "./desktop";
import { MediaItem, Product } from "./types";

/**
 * Product photos kept on the till so the catalog still has pictures offline. A catalog's image links are presigned
 * and expire, so photos are fetched by media id through the API's own /api/media/{id}/content (same origin rules as
 * every other API call — no storage-bucket CORS needed), shrunk to a thumbnail-sized JPEG and stored in the till's
 * local database. Up to PHOTOS_PER_PRODUCT photos per product are kept; photos of deleted products are pruned.
 */
const PHOTOS_PER_PRODUCT = 3;
const MAX_SIDE = 480;
const INDEX_KEY = "photoIndex";

interface PhotoCacheState {
  photos: Record<string, string>;
  set: (mediaId: string, dataUrl: string) => void;
  drop: (mediaIds: string[]) => void;
}

export const usePhotoCache = create<PhotoCacheState>()((set) => ({
  photos: {},
  set: (mediaId, dataUrl) => set((s) => ({ photos: { ...s.photos, [mediaId]: dataUrl } })),
  drop: (mediaIds) =>
    set((s) => {
      const photos = { ...s.photos };
      mediaIds.forEach((id) => delete photos[id]);
      return { photos };
    }),
}));

/** The cached copy when the till has one, otherwise the live link. */
export function usePhotoSrc(media: MediaItem | undefined | null): string | undefined {
  const cached = usePhotoCache((s) => (media ? s.photos[media.id] : undefined));
  return media ? cached ?? media.presignedUrl : undefined;
}

function wantedMediaIds(products: Product[]): string[] {
  return products.flatMap((p) => p.media.filter((m) => m.type === "IMAGE").slice(0, PHOTOS_PER_PRODUCT).map((m) => m.id));
}

async function shrink(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.8);
}

let running: Promise<void> | null = null;

/**
 * Loads already-saved photos into memory, downloads the missing ones, and forgets photos no longer in the catalog.
 * Safe to call after every catalog sync: only new photos are downloaded, and concurrent calls share one run.
 */
export function syncPhotoCache(products: Product[]): Promise<void> {
  if (!isDesktop()) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    const wanted = wantedMediaIds(products);
    const wantedSet = new Set(wanted);
    const saved = (await desktop.cacheGet<string[]>(INDEX_KEY).catch(() => null)) ?? [];
    const savedSet = new Set(saved);
    const store = usePhotoCache.getState();

    // Forget photos of products/photos that are gone.
    const stale = saved.filter((id) => !wantedSet.has(id));
    for (const id of stale) await desktop.photoDelete(id).catch(() => {});
    if (stale.length) store.drop(stale);

    const kept: string[] = saved.filter((id) => wantedSet.has(id));
    for (const id of wanted) {
      if (usePhotoCache.getState().photos[id]) continue;
      if (savedSet.has(id)) {
        const dataUrl = await desktop.photoGet(id).catch(() => null);
        if (dataUrl) {
          store.set(id, dataUrl);
          continue;
        }
      }
      try {
        const res = await fetch(`${API_BASE_URL}/api/media/${id}/content`);
        if (!res.ok) continue;
        const dataUrl = await shrink(await res.blob());
        await desktop.photoSet(id, dataUrl);
        store.set(id, dataUrl);
        if (!kept.includes(id)) kept.push(id);
      } catch {
        // Offline or not an image the webview can decode — the live link is used meanwhile.
      }
    }
    await desktop.cacheSet(INDEX_KEY, kept).catch(() => {});
  })().finally(() => {
    running = null;
  });
  return running;
}
