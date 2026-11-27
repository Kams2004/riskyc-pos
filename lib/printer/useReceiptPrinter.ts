"use client";

import { useCallback, useRef, useState } from "react";
import type { ReceiptData } from "@/components/Receipt";
import { isDesktop } from "@/lib/desktop";
import { useT } from "@/lib/i18n";
import type { PosSettings } from "@/lib/types";
import { usePrinterSettingsStore } from "./printerSettingsStore";
import { printReceiptOnThermal, ReceiptPrintOutcome } from "./printReceipt";

export type ReceiptJob = { phase: "printing"; data: ReceiptData } | { phase: "done"; data: ReceiptData; outcome: ReceiptPrintOutcome };

export interface ReceiptPrinterController {
  /** Prints the ticket the way this till is set up: thermal printer (with the outcome shown), or the print window. */
  print: (data: ReceiptData) => void;
  /** The ticket shown in the banner again, on the thermal printer. */
  retry: () => void;
  /** The ticket shown in the banner through the system print window (the old way), e.g. when the printer is out. */
  printWithWindowInstead: () => void;
  dismiss: () => void;
  job: ReceiptJob | null;
  /** For <PrintArea>: what window.print() shows. */
  printData: ReceiptData | null;
  settings: PosSettings | null;
}

/**
 * The one way every screen prints a receipt (sale success, auto-print, reprint, calculator, test ticket). Render
 * <ReceiptPrinter printer={…} /> (components/ReceiptPrinter.tsx) once on the page for the print area and the
 * outcome banner. Tickets asked for while one is printing wait their turn — none is dropped.
 */
export function useReceiptPrinter(settings: PosSettings | null): ReceiptPrinterController {
  const { t, locale } = useT();
  const [printData, setPrintData] = useState<ReceiptData | null>(null);
  const [job, setJob] = useState<ReceiptJob | null>(null);
  const queue = useRef<{ data: ReceiptData; settings: PosSettings }[]>([]);
  const running = useRef(false);

  const printWithWindow = useCallback((data: ReceiptData) => {
    setPrintData(data);
    setTimeout(() => window.print(), 50);
  }, []);

  const enqueueThermal = useCallback(
    async (data: ReceiptData, posSettings: PosSettings) => {
      queue.current.push({ data, settings: posSettings });
      if (running.current) return;
      running.current = true;
      try {
        for (let next = queue.current.shift(); next; next = queue.current.shift()) {
          setJob({ phase: "printing", data: next.data });
          let outcome: ReceiptPrintOutcome;
          try {
            outcome = await printReceiptOnThermal(next.data, next.settings, t, locale);
          } catch (e) {
            outcome = { result: "failed", failure: "interrupted", detail: e instanceof Error ? e.message : String(e) };
          }
          setJob({ phase: "done", data: next.data, outcome });
        }
      } finally {
        running.current = false;
      }
    },
    [t, locale]
  );

  const print = useCallback(
    (data: ReceiptData) => {
      const { mode, target } = usePrinterSettingsStore.getState();
      if (!isDesktop() || mode !== "thermal" || !settings) printWithWindow(data);
      else if (!target) setJob({ phase: "done", data, outcome: { result: "failed", failure: "notConfigured" } });
      else void enqueueThermal(data, settings);
    },
    [settings, enqueueThermal, printWithWindow]
  );

  const retry = useCallback(() => {
    if (job?.phase === "done" && settings) void enqueueThermal(job.data, settings);
  }, [job, settings, enqueueThermal]);

  const printWithWindowInstead = useCallback(() => {
    if (job) printWithWindow(job.data);
    setJob(null);
  }, [job, printWithWindow]);

  const dismiss = useCallback(() => setJob(null), []);

  return { print, retry, printWithWindowInstead, dismiss, job, printData, settings };
}
