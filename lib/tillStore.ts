import { create } from "zustand";
import { TillDevice } from "./desktop";

/** Live status of this till (desktop app only) — set by DesktopGate, read by login and the shell. */
interface TillState {
  device: TillDevice | null;
  /** Server reachable at the last check-in. */
  online: boolean;
  lastCatalogSyncAt: number | null;
  setDevice: (device: TillDevice | null) => void;
  setOnline: (online: boolean) => void;
  setCatalogSynced: () => void;
}

export const useTillStore = create<TillState>()((set) => ({
  device: null,
  online: true,
  lastCatalogSyncAt: null,
  setDevice: (device) => set({ device }),
  setOnline: (online) => set({ online }),
  setCatalogSynced: () => set({ lastCatalogSyncAt: Date.now() }),
}));
