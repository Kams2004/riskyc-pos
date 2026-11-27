/**
 * Printing a receipt on this till's thermal printer, whatever the link: two-way links (network, Bluetooth / serial,
 * Linux USB) go through printWithConfirmation; printers installed in the OS go through the print queue, whose job is
 * watched until it leaves the queue cleanly or gets stuck on an error. Used by every print button via
 * useReceiptPrinter (lib/printer/useReceiptPrinter.ts).
 */
import type { ReceiptData } from "../../components/Receipt";
import type { TKey, TVars } from "../i18n";
import type { PosSettings } from "../types";
import {
  cancelSystemJob,
  LinkTarget,
  openLink,
  printSystem,
  PrinterTarget,
  QueueProblems,
  systemJobStatus,
  systemPrinterStatus,
} from "./desktopTransport";
import { blockingProblem, columnsFor, encodeReceipt, PrinterProblem } from "./escpos";
import { checkPrinter, PrinterCapabilities, PrinterConnection, printWithConfirmation, PrintFailure } from "./printJob";
import { knownForNextPrint, usePrinterSettingsStore } from "./printerSettingsStore";
import { buildReceiptDocument } from "./receiptDocument";

/**
 * printJob's failures, plus: the job sat in the print queue (printer off / unplugged) and was cancelled; or thermal
 * printing is on but no printer was chosen yet.
 */
export type ReceiptFailure = PrintFailure | "stuckInQueue" | "notConfigured";

export type ReceiptPrintOutcome =
  | { result: "printed"; paperNearEnd: boolean; capabilities?: PrinterCapabilities }
  /** Delivered to the printer (or out of the print queue without error), but nothing confirms it came out. */
  | { result: "sent"; capabilities?: PrinterCapabilities }
  | { result: "failed"; failure: ReceiptFailure; detail?: string; capabilities?: PrinterCapabilities };

/** How long a queued job may take to leave the print queue before it's considered stuck (and cancelled). */
const QUEUE_TIMEOUT_MS = 25_000;
const QUEUE_POLL_MS = 600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "");
}

/** The print queue's flags → the first thing to fix, in the same words as a two-way printer's problems. */
export function queueFailure(p: QueueProblems): PrinterProblem | null {
  if (p.coverOpen) return "coverOpen";
  if (p.paperOut) return "paperOut";
  if (p.error || p.needsAttention) return "error";
  if (p.offline || p.paused) return "offline";
  return null;
}

/** One-way, through the OS print queue: "sent" once the job left the queue with no error — never "printed". */
export async function printThroughQueue(name: string, ticket: Uint8Array): Promise<ReceiptPrintOutcome> {
  let job: string;
  try {
    job = await printSystem(name, ticket);
  } catch (e) {
    return { result: "failed", failure: "unreachable", detail: message(e) };
  }
  const deadline = Date.now() + QUEUE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(QUEUE_POLL_MS);
    let status;
    try {
      status = await systemJobStatus(name, job);
    } catch {
      continue;
    }
    if (status.state === "done") return { result: "sent" };
    if (status.state === "deleted") return { result: "failed", failure: "interrupted", detail: status.problems.message ?? undefined };
    const problem = queueFailure(status.problems);
    if (problem) {
      // Cancelled, so it can't come out later by surprise after the cashier printed it again.
      await cancelSystemJob(name, job).catch(() => undefined);
      return { result: "failed", failure: problem, detail: status.problems.message ?? undefined };
    }
  }
  await cancelSystemJob(name, job).catch(() => undefined);
  return { result: "failed", failure: "stuckInQueue" };
}

/** Sends ready-made ticket bytes to `target`; also reports the serial speed the printer answered at, if any. */
export async function sendTicket(
  target: PrinterTarget,
  ticket: Uint8Array,
  known: Partial<PrinterCapabilities> = {}
): Promise<{ outcome: ReceiptPrintOutcome; confirmedBaud: number | null }> {
  if (target.kind === "system") return { outcome: await printThroughQueue(target.name, ticket), confirmedBaud: null };
  let confirmedBaud: number | null = null;
  const open = async () => {
    const link = await openLink(target);
    confirmedBaud = link.confirmedBaud;
    return link;
  };
  const outcome = await printOverLink(open, ticket, known);
  return { outcome, confirmedBaud };
}

/** printWithConfirmation, but a link that drops while waiting for the confirmation is "interrupted", not a crash. */
export async function printOverLink(
  open: () => Promise<PrinterConnection>,
  ticket: Uint8Array,
  known: Partial<PrinterCapabilities> = {},
  timeouts: { statusTimeoutMs?: number; confirmTimeoutMs?: number } = {}
): Promise<ReceiptPrintOutcome> {
  try {
    return await printWithConfirmation(open, ticket, { known, ...timeouts });
  } catch (e) {
    return { result: "failed", failure: "interrupted", detail: message(e) };
  }
}

/**
 * Builds the receipt, prints it on this till's chosen printer, remembers the result and what was learnt about the
 * printer. The caller makes sure a printer is chosen (see useReceiptPrinter).
 */
export async function printReceiptOnThermal(
  data: ReceiptData,
  settings: PosSettings,
  t: (key: TKey, vars?: TVars) => string,
  locale: string
): Promise<ReceiptPrintOutcome> {
  const store = usePrinterSettingsStore.getState();
  const target = store.target;
  if (!target) return { result: "failed", failure: "notConfigured" };
  const ticket = encodeReceipt(buildReceiptDocument(data, settings, t, locale), {
    columns: columnsFor(settings.paperWidth),
    accents: store.accents,
    // A print queue is one-way: nobody would read the confirmation, so it isn't asked.
    confirm: target.kind !== "system",
  });
  const { outcome, confirmedBaud } = await sendTicket(target, ticket, knownForNextPrint(store.capabilities));
  const now = usePrinterSettingsStore.getState();
  // Only if the cashier didn't switch printer meanwhile.
  if (now.target === target) {
    now.recordOutcome(outcome);
    if (confirmedBaud && target.kind === "serial" && target.baud !== confirmedBaud) now.updateTarget({ ...target, baud: confirmedBaud });
  }
  return outcome;
}

// ── "Check" ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type CheckResult =
  | { state: "ready"; paperNearEnd: boolean }
  | { state: "problem"; problem: PrinterProblem; detail?: string }
  /** Reached, but it doesn't answer status questions: it may still print, without confirmation. */
  | { state: "noStatus" }
  /** A print queue with no problem reported. */
  | { state: "queueReady" }
  | { state: "unreachable"; detail: string };

export async function checkTarget(target: PrinterTarget): Promise<{ result: CheckResult; confirmedBaud: number | null }> {
  if (target.kind === "system") {
    try {
      const problems = await systemPrinterStatus(target.name);
      const problem = queueFailure(problems);
      return { result: problem ? { state: "problem", problem, detail: problems.message ?? undefined } : { state: "queueReady" }, confirmedBaud: null };
    } catch (e) {
      return { result: { state: "unreachable", detail: message(e) }, confirmedBaud: null };
    }
  }
  let confirmedBaud: number | null = null;
  const open = async () => {
    const link = await openLink(target as LinkTarget);
    confirmedBaud = link.confirmedBaud;
    return link;
  };
  const checked = await checkPrinter(open);
  if (!checked.reachable) return { result: { state: "unreachable", detail: checked.detail }, confirmedBaud };
  if (!checked.status) return { result: { state: "noStatus" }, confirmedBaud };
  const problem = blockingProblem(checked.status);
  return {
    result: problem ? { state: "problem", problem } : { state: "ready", paperNearEnd: checked.status.paperNearEnd },
    confirmedBaud,
  };
}

/** Linux: the port exists but this user may not open it. */
export function isPermissionProblem(detail: string | undefined): boolean {
  return !!detail && /permission denied|access is denied|EACCES/i.test(detail);
}
