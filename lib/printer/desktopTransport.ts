/**
 * The desktop app's printer links, over the Rust commands in src-tauri/src/printer: PrinterConnection adapters for
 * printWithConfirmation (network, serial/Bluetooth, Linux USB device), one-way printing through the system's print
 * queue with job tracking, and printer discovery. Desktop only — check isDesktop() first.
 */
import type { PrinterConnection } from "./printJob";

/** Where the receipt printer is. Mirrors LinkTarget in src-tauri/src/printer/link.rs (plus the system queue). */
export type PrinterTarget =
  | { kind: "network"; host: string; port: number }
  /** COM port (Windows; Bluetooth printers too) or /dev/ttyUSB*, /dev/ttyACM*, /dev/rfcomm* (Linux). No baud: found by trying. */
  | { kind: "serial"; path: string; baud?: number }
  /** Linux USB printer-class device, /dev/usb/lp*. */
  | { kind: "usbDevice"; path: string }
  /** A printer installed in Windows / CUPS: one-way, through the print queue. */
  | { kind: "system"; name: string };

export type LinkTarget = Exclude<PrinterTarget, { kind: "system" }>;

export const DEFAULT_NETWORK_PORT = 9100;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e ?? "unknown error"));
}

/** Rejects when `p` takes longer than `ms` — a Rust call stuck on a dead link must not hang the till. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(asError(e));
      }
    );
  });
}

interface OpenedPrinter {
  handle: number;
  baud: number | null;
  baudConfirmed: boolean;
}

/** A two-way link plus what the opening learnt (the serial speed the printer answered at). */
export interface OpenedLink extends PrinterConnection {
  /** Set when a serial printer answered at this speed — save it in the target so it isn't searched again. */
  confirmedBaud: number | null;
}

/**
 * Opens a two-way link. Opening a Bluetooth COM port can take several seconds (Windows connects then), and an
 * unknown serial speed is searched for, so the open gets a generous timeout.
 */
export async function openLink(target: LinkTarget): Promise<OpenedLink> {
  const opened = await withTimeout(call<OpenedPrinter>("printer_open", { target }), 40_000, "Opening the printer");
  let closed = false;
  return {
    canRead: true,
    confirmedBaud: opened.baudConfirmed ? opened.baud : null,
    write: (bytes) =>
      withTimeout(call<void>("printer_write", { handle: opened.handle, bytes: Array.from(bytes) }), 25_000, "Sending to the printer"),
    read: async (timeoutMs) => {
      const got = await withTimeout(
        call<number[]>("printer_read", { handle: opened.handle, timeoutMs: Math.max(1, Math.round(timeoutMs)) }),
        timeoutMs + 10_000,
        "Reading from the printer"
      );
      return Uint8Array.from(got);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await call<void>("printer_close", { handle: opened.handle });
    },
  };
}

/** For printWithConfirmation / checkPrinter: `() => openPrinter(target)`. System queues are one-way — see printSystem. */
export function openPrinter(target: LinkTarget): Promise<OpenedLink> {
  return openLink(target);
}

// ── System print queue (Windows spooler, CUPS) ─────────────────────────────────────────────────────────────────

export interface QueueProblems {
  offline: boolean;
  paperOut: boolean;
  coverOpen: boolean;
  error: boolean;
  paused: boolean;
  needsAttention: boolean;
  message: string | null;
}

export type SystemConnection = "usb" | "network" | "serial" | "bluetooth" | "virtual" | "other";

export interface SystemPrinter {
  name: string;
  driver: string | null;
  port: string | null;
  connection: SystemConnection;
  isDefault: boolean;
  problems: QueueProblems;
}

export interface JobStatus {
  state: "queued" | "printing" | "done" | "deleted";
  problems: QueueProblems;
}

export const listSystemPrinters = () => call<SystemPrinter[]>("printer_list_system");
export const systemPrinterStatus = (name: string) => call<QueueProblems>("printer_system_status", { name });
/** Sends the bytes untouched (RAW) as one job; returns the job id. */
export const printSystem = (name: string, bytes: Uint8Array) =>
  withTimeout(call<string>("printer_print_system", { name, bytes: Array.from(bytes) }), 30_000, "Sending to the print queue");
export const systemJobStatus = (name: string, job: string) => call<JobStatus>("printer_system_job_status", { name, job });
export const cancelSystemJob = (name: string, job: string) => call<void>("printer_system_cancel", { name, job });

export function hasQueueProblem(p: QueueProblems): boolean {
  return p.offline || p.paperOut || p.coverOpen || p.error || p.paused || p.needsAttention;
}

// ── Discovery ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface NetworkPrinterFound {
  host: string;
  port: number;
  interface: string;
}

export interface SerialPortFound {
  path: string;
  connection: "bluetooth" | "usb" | "cable" | "unknown";
  name: string | null;
  manufacturer: string | null;
  vid: number | null;
  pid: number | null;
}

export interface UsbDeviceFound {
  path: string;
  name: string | null;
  accessible: boolean;
}

export const scanNetwork = () => call<NetworkPrinterFound[]>("printer_scan_network");
export const listSerialPorts = () => call<SerialPortFound[]>("printer_list_serial");
export const listUsbDevices = () => call<UsbDeviceFound[]>("printer_list_usb_devices");

export type PrinterGroup = "network" | "bluetooth" | "usb" | "other";

/** One printer the search found, ready to show and to pick. */
export interface FoundPrinter {
  id: string;
  group: PrinterGroup;
  name: string;
  /** IP address, COM port, device path or queue port — what the cashier can match with the printer. */
  address: string;
  target: PrinterTarget;
  /** Through the system queue: prints, but can't report paper / cover or confirm the ticket. */
  oneWay: boolean;
  /** Linux: this user may not open the device (needs the lp / dialout group). */
  noAccess?: boolean;
}

export function targetId(target: PrinterTarget): string {
  switch (target.kind) {
    case "network":
      return `network:${target.host}:${target.port}`;
    case "serial":
      return `serial:${target.path}`;
    case "usbDevice":
      return `usb:${target.path}`;
    case "system":
      return `system:${target.name}`;
  }
}

export function describeTarget(target: PrinterTarget): string {
  switch (target.kind) {
    case "network":
      return target.port === DEFAULT_NETWORK_PORT ? target.host : `${target.host}:${target.port}`;
    case "serial":
    case "usbDevice":
      return target.path;
    case "system":
      return target.name;
  }
}

export interface DiscoveryLabels {
  networkPrinter: string;
  bluetoothPrinter: string;
  usbPrinter: string;
  serialPort: string;
}

export interface DiscoveryProgress {
  network: "searching" | "done" | "failed";
  ports: "searching" | "done" | "failed";
  system: "searching" | "done" | "failed";
}

/**
 * Runs every search at once — network scan (a few seconds), serial / Bluetooth ports, Linux USB devices and the
 * system's printers — and calls `onUpdate` with everything found so far each time one finishes.
 */
export async function discoverPrinters(
  labels: DiscoveryLabels,
  onUpdate: (found: FoundPrinter[], progress: DiscoveryProgress) => void
): Promise<FoundPrinter[]> {
  const byPart: { network: FoundPrinter[]; ports: FoundPrinter[]; system: FoundPrinter[] } = { network: [], ports: [], system: [] };
  const progress: DiscoveryProgress = { network: "searching", ports: "searching", system: "searching" };
  const all = () => [...byPart.network, ...byPart.ports, ...byPart.system];
  onUpdate([], { ...progress });

  const run = async (part: keyof typeof byPart, find: () => Promise<FoundPrinter[]>) => {
    try {
      byPart[part] = await find();
      progress[part] = "done";
    } catch {
      progress[part] = "failed";
    }
    onUpdate(all(), { ...progress });
  };

  await Promise.all([
    run("network", async () =>
      (await scanNetwork()).map((p) => {
        const target: PrinterTarget = { kind: "network", host: p.host, port: p.port };
        return { id: targetId(target), group: "network", name: labels.networkPrinter, address: p.host, target, oneWay: false };
      })
    ),
    run("ports", async () => {
      const [serial, usb] = await Promise.all([listSerialPorts(), listUsbDevices().catch(() => [] as UsbDeviceFound[])]);
      const fromSerial = serial.map((p): FoundPrinter => {
        const target: PrinterTarget = { kind: "serial", path: p.path };
        const group: PrinterGroup = p.connection === "bluetooth" ? "bluetooth" : p.connection === "usb" ? "usb" : "other";
        const fallback = group === "bluetooth" ? labels.bluetoothPrinter : group === "usb" ? labels.usbPrinter : labels.serialPort;
        return { id: targetId(target), group, name: p.name || fallback, address: p.path, target, oneWay: false };
      });
      const fromUsb = usb.map((d): FoundPrinter => {
        const target: PrinterTarget = { kind: "usbDevice", path: d.path };
        return { id: targetId(target), group: "usb", name: d.name || labels.usbPrinter, address: d.path, target, oneWay: false, noAccess: !d.accessible };
      });
      return [...fromUsb, ...fromSerial];
    }),
    run("system", async () =>
      (await listSystemPrinters())
        .filter((p) => p.connection !== "virtual")
        .map((p): FoundPrinter => {
          const target: PrinterTarget = { kind: "system", name: p.name };
          const group: PrinterGroup =
            p.connection === "usb" ? "usb" : p.connection === "network" ? "network" : p.connection === "bluetooth" ? "bluetooth" : "other";
          return { id: targetId(target), group, name: p.name, address: p.port ?? p.driver ?? "", target, oneWay: true };
        })
    ),
  ]);
  return all();
}
