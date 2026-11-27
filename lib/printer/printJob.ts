/**
 * Sends a ticket to a thermal printer and finds out whether it really printed. Transport-agnostic: the desktop app
 * (network, Bluetooth/serial, USB through the system spooler) and the phone app (network, Bluetooth, USB) each give
 * it a PrinterConnection. Shared file — riskyc-pos-mobile/src/lib/printer/printJob.ts is a copy.
 *
 * How it knows:
 *  1. Before printing it asks the printer's real-time status (DLE EOT). Cover open, no paper or offline → it doesn't
 *     print and says why.
 *  2. The ticket ends with GS r 1, which the printer only answers after processing everything before it. That answer
 *     arriving = the ticket went through ("printed").
 *  3. A printer that never answers anything (one-way link, or a model without status support) still gets the ticket;
 *     the result is then "sent" — delivered to the printer, but the printer can't confirm it.
 */
import { blockingProblem, CMD, isRealtimeStatusByte, parseConfirmByte, parseRealtimeStatus, PrinterProblem, PrinterStatus } from "./escpos";

export interface PrinterConnection {
  /** False for one-way links (e.g. the operating system's print spooler): no status is asked. */
  readonly canRead: boolean;
  write(bytes: Uint8Array): Promise<void>;
  /** Bytes received since the last read; waits up to `timeoutMs` for at least one. Empty array on timeout. */
  read(timeoutMs: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** What a printer was seen to support last time — saves waiting for answers it never gives. */
export interface PrinterCapabilities {
  realtimeStatus: boolean;
  confirm: boolean;
}

export type PrintFailure = PrinterProblem | "unreachable" | "interrupted" | "paperOutDuringPrint";

export type PrintOutcome =
  | { result: "printed"; paperNearEnd: boolean; capabilities: PrinterCapabilities }
  | { result: "sent"; capabilities: PrinterCapabilities }
  | { result: "failed"; failure: PrintFailure; detail?: string; capabilities?: PrinterCapabilities };

export interface PrintJobOptions {
  /** How long to wait for each real-time status answer (default 1500 ms). */
  statusTimeoutMs?: number;
  /** How long to wait for the end-of-ticket confirmation (default 12 s — long tickets on slow printers). */
  confirmTimeoutMs?: number;
  /** From a previous print on this printer; unknown → everything is tried. */
  known?: Partial<PrinterCapabilities>;
}

const STATUS_TIMEOUT_MS = 1500;
const CONFIRM_TIMEOUT_MS = 12_000;

/** Asks DLE EOT 1, 2 and 4. Null when the printer doesn't answer the first one (no real-time status support). */
export async function queryStatus(conn: PrinterConnection, timeoutMs = STATUS_TIMEOUT_MS): Promise<PrinterStatus | null> {
  if (!conn.canRead) return null;
  await conn.read(30).catch(() => undefined); // drop anything left over from an earlier exchange
  const ask = async (n: 1 | 2 | 4) => {
    await conn.write(Uint8Array.from(CMD.realtimeStatus(n)));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const got = await conn.read(Math.max(1, deadline - Date.now()));
      const b = [...got].find(isRealtimeStatusByte);
      if (b !== undefined) return b;
      if (got.length === 0) break;
    }
    return undefined;
  };
  const printer = await ask(1);
  if (printer === undefined) return null;
  const offlineCause = await ask(2);
  const paper = await ask(4);
  return parseRealtimeStatus({ printer, offlineCause, paper });
}

/** Opens the printer, checks it, sends `ticket` (built with encodeReceipt) and waits for the printer's confirmation. */
export async function printWithConfirmation(
  open: () => Promise<PrinterConnection>,
  ticket: Uint8Array,
  opts: PrintJobOptions = {}
): Promise<PrintOutcome> {
  let conn: PrinterConnection;
  try {
    conn = await open();
  } catch (e) {
    return { result: "failed", failure: "unreachable", detail: message(e) };
  }

  try {
    const caps: PrinterCapabilities = { realtimeStatus: false, confirm: false };

    // 1. Is it ready?
    if (conn.canRead && opts.known?.realtimeStatus !== false) {
      let status: PrinterStatus | null;
      try {
        status = await queryStatus(conn, opts.statusTimeoutMs);
      } catch (e) {
        return { result: "failed", failure: "interrupted", detail: message(e), capabilities: caps };
      }
      if (status) {
        caps.realtimeStatus = true;
        const problem = blockingProblem(status);
        if (problem) return { result: "failed", failure: problem, capabilities: caps };
      }
    }

    // 2. Send it.
    try {
      await conn.write(ticket);
    } catch (e) {
      return { result: "failed", failure: "interrupted", detail: message(e), capabilities: caps };
    }
    if (!conn.canRead) return { result: "sent", capabilities: caps };

    // 3. Did it go through? Printers that never confirmed before get a short wait only.
    const wait = opts.known?.confirm === false ? 1500 : opts.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS;
    const deadline = Date.now() + wait;
    while (Date.now() < deadline) {
      const got = await conn.read(Math.max(1, deadline - Date.now()));
      if (got.length === 0) break;
      const answer = [...got].map(parseConfirmByte).find((a) => a.valid);
      if (answer) {
        caps.confirm = true;
        if (answer.paperOut) return { result: "failed", failure: "paperOutDuringPrint", capabilities: caps };
        return { result: "printed", paperNearEnd: answer.paperNearEnd, capabilities: caps };
      }
    }

    // No confirmation: if the printer can still explain itself, a problem now means the ticket didn't come out.
    if (caps.realtimeStatus) {
      const after = await queryStatus(conn, opts.statusTimeoutMs).catch(() => null);
      const problem = after && blockingProblem(after);
      if (problem) return { result: "failed", failure: problem === "paperOut" ? "paperOutDuringPrint" : problem, capabilities: caps };
    }
    return { result: "sent", capabilities: caps };
  } finally {
    await conn.close().catch(() => undefined);
  }
}

/** Just the status, for the "Check printer" button and the printer list. */
export async function checkPrinter(
  open: () => Promise<PrinterConnection>,
  opts: { statusTimeoutMs?: number } = {}
): Promise<{ reachable: true; status: PrinterStatus | null } | { reachable: false; detail: string }> {
  let conn: PrinterConnection;
  try {
    conn = await open();
  } catch (e) {
    return { reachable: false, detail: message(e) };
  }
  try {
    return { reachable: true, status: await queryStatus(conn, opts.statusTimeoutMs) };
  } catch (e) {
    return { reachable: false, detail: message(e) };
  } finally {
    await conn.close().catch(() => undefined);
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? "");
}
