import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Per-device cashier preferences — unlike PosSettings (the shop-wide ticket
 * config on the backend), these are local to this till/browser and never
 * sent to the server, so each register can be tuned independently.
 */
interface PosPreferencesStore {
  /** Require a second confirm tap on the payment button before actually charging. */
  confirmBeforeCharge: boolean;
  /** Print the ticket automatically right after a sale completes, instead of waiting for a tap on the success toast's Print button. */
  autoPrintAfterSale: boolean;
  setConfirmBeforeCharge: (v: boolean) => void;
  setAutoPrintAfterSale: (v: boolean) => void;
}

export const usePosPreferencesStore = create<PosPreferencesStore>()(
  persist(
    (set) => ({
      confirmBeforeCharge: false,
      autoPrintAfterSale: false,
      setConfirmBeforeCharge: (v) => set({ confirmBeforeCharge: v }),
      setAutoPrintAfterSale: (v) => set({ autoPrintAfterSale: v }),
    }),
    { name: "riskyc-pos-preferences-v1" }
  )
);
