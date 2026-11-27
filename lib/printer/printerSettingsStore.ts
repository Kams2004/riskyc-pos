import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PrinterTarget } from "./desktopTransport";
import type { PrinterCapabilities } from "./printJob";
import type { ReceiptPrintOutcome } from "./printReceipt";

/**
 * This till's receipt printer — like the other device preferences (lib/posPreferencesStore.ts) it stays on this
 * computer and is never sent to the server: each register has its own printer. Paper width stays shop-wide
 * (PosSettings).
 */
export type PrintMode = "thermal" | "system";

export interface LastPrintResult {
  result: ReceiptPrintOutcome["result"];
  failure?: string;
  at: string;
}

interface PrinterSettingsStore {
  /** thermal: straight to the receipt printer, with confirmation. system: the print window (window.print). */
  mode: PrintMode;
  target: PrinterTarget | null;
  /** As shown in the printer list when it was picked ("Network printer", "POS-58", "MTP-II"). */
  targetName: string | null;
  /** Send é, à, ç… (Windows-1252). Off: plain letters, for printers that print garbage instead. */
  accents: boolean;
  /** What the printer was seen to support last time (status, confirmation) — saves waiting for silence. */
  capabilities: Partial<PrinterCapabilities> | null;
  lastResult: LastPrintResult | null;
  setMode: (mode: PrintMode) => void;
  chooseTarget: (target: PrinterTarget, name: string) => void;
  /** Same printer, settings learnt (e.g. the serial speed it answered at). */
  updateTarget: (target: PrinterTarget) => void;
  setAccents: (v: boolean) => void;
  recordOutcome: (outcome: ReceiptPrintOutcome) => void;
  setCapabilities: (caps: Partial<PrinterCapabilities> | null) => void;
}

/**
 * What a print taught about the printer. Only what was really tried counts: a ticket refused because the cover was
 * open says nothing about whether the printer confirms tickets.
 */
export function learnFrom(
  known: Partial<PrinterCapabilities> | null,
  outcome: ReceiptPrintOutcome
): Partial<PrinterCapabilities> | null {
  const caps = outcome.capabilities;
  if (!caps) return known;
  const next: Partial<PrinterCapabilities> = { ...known };
  if (caps.realtimeStatus) next.realtimeStatus = true;
  const ticketWentOut = outcome.result !== "failed" || outcome.failure === "paperOutDuringPrint";
  if (ticketWentOut) {
    next.confirm = caps.confirm;
    if (!caps.realtimeStatus) next.realtimeStatus = false;
  }
  return next;
}

/**
 * What to tell printWithConfirmation. Status questions are only skipped for a printer seen to answer nothing at all
 * (typical of one-way Bluetooth / serial links): one that confirms tickets keeps being asked for its status.
 */
export function knownForNextPrint(known: Partial<PrinterCapabilities> | null): Partial<PrinterCapabilities> {
  if (!known) return {};
  return {
    confirm: known.confirm,
    realtimeStatus: known.realtimeStatus === false && known.confirm === false ? false : undefined,
  };
}

export const usePrinterSettingsStore = create<PrinterSettingsStore>()(
  persist(
    (set) => ({
      mode: "system",
      target: null,
      targetName: null,
      accents: true,
      capabilities: null,
      lastResult: null,
      setMode: (mode) => set({ mode }),
      chooseTarget: (target, name) => set({ target, targetName: name, capabilities: null, lastResult: null, mode: "thermal" }),
      updateTarget: (target) => set({ target }),
      setAccents: (accents) => set({ accents }),
      recordOutcome: (outcome) =>
        set((s) => ({
          lastResult: {
            result: outcome.result,
            failure: outcome.result === "failed" ? outcome.failure : undefined,
            at: new Date().toISOString(),
          },
          capabilities: learnFrom(s.capabilities, outcome),
        })),
      setCapabilities: (capabilities) => set({ capabilities }),
    }),
    { name: "riskyc-pos-printer-v1" }
  )
);
