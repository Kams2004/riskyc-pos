/**
 * ESC/POS — the command language of thermal receipt printers (Epson, Xprinter, Goojprt, Rongta, Sunmi and most
 * 58/80 mm printers). Turns a receipt into the exact bytes the printer understands, and reads back the status bytes it
 * answers with. Pure functions, no I/O: the same file is used by the desktop POS and the phone POS
 * (riskyc-pos-mobile/src/lib/printer/escpos.ts is a copy — change both together).
 */

export type PaperColumns = 32 | 48;

/** Characters per line in the printer's standard font: 58 mm rolls print 32, 80 mm rolls 48. */
export function columnsFor(paperWidth: "MM58" | "MM80" | "A4"): PaperColumns {
  return paperWidth === "MM58" ? 32 : 48;
}

const ESC = 0x1b;
const GS = 0x1d;
const DLE = 0x10;
const EOT = 0x04;

export const CMD = {
  init: [ESC, 0x40],
  /** Code page 16 = Windows-1252 on Epson and on the clones that copy its table — gives é, è, à, ç, ô, €. */
  codePage1252: [ESC, 0x74, 16],
  alignLeft: [ESC, 0x61, 0],
  alignCenter: [ESC, 0x61, 1],
  boldOn: [ESC, 0x45, 1],
  boldOff: [ESC, 0x45, 0],
  /** GS ! n — 0x00 normal, 0x01 double height, 0x11 double width and height. */
  size: (n: 0x00 | 0x01 | 0x11) => [GS, 0x21, n],
  feed: (lines: number) => [ESC, 0x64, Math.max(0, Math.min(255, lines))],
  /** Feed to the cutter, then partial cut. Printers without a cutter ignore it. */
  cut: [GS, 0x56, 0x42, 0x03],
  /**
   * GS r 1 — "transmit paper sensor status". Unlike the real-time DLE EOT queries it waits its turn in the print
   * buffer, so the printer only answers once everything sent before it has been processed: the answer is the
   * confirmation that the ticket went through.
   */
  confirmMarker: [GS, 0x72, 0x01],
  /** DLE EOT n — real-time status, answered at once even while printing. */
  realtimeStatus: (n: 1 | 2 | 4) => [DLE, EOT, n],
} as const;

/** Windows-1252 bytes for the characters outside Latin-1 that a receipt may contain. */
const CP1252_EXTRA: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96,
  "—": 0x97, "œ": 0x9c, "Œ": 0x8c, "Ÿ": 0x9f, "™": 0x99,
};
/** Typographic characters that have a plain equivalent everywhere. */
const PLAIN: Record<string, string> = {
  "×": "x", "·": "-", "«": "\"", "»": "\"", " ": " ", " ": " ", "‘": "'", "’": "'", "“": "\"", "”": "\"",
  "–": "-", "—": "-", "…": "...", "•": "*", "€": "EUR", "œ": "oe", "Œ": "OE",
};

/**
 * Text → printer bytes. `accents` true: Windows-1252 (needs the printer to honour code page 16 — almost all do).
 * false: plain ASCII with accents removed, for printers that print garbage instead of é.
 */
export function encodeText(text: string, accents: boolean): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x0a) {
      out.push(0x0a);
      continue;
    }
    if (code < 0x20) continue;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    if (accents) {
      if (code >= 0xa1 && code <= 0xff) {
        out.push(code); // Latin-1 and Windows-1252 agree from 0xA1 to 0xFF
        continue;
      }
      if (CP1252_EXTRA[ch] !== undefined) {
        out.push(CP1252_EXTRA[ch]);
        continue;
      }
    }
    const plain = PLAIN[ch] ?? ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const p of plain) {
      const c = p.codePointAt(0)!;
      out.push(c >= 0x20 && c < 0x80 ? c : 0x3f);
    }
  }
  return out;
}

/** Visible width of a line once printed (one column per character). */
function width(s: string): number {
  return [...s].length;
}

/** Splits text into lines of at most `cols` characters, breaking between words when it can. */
export function wrap(text: string, cols: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (width(line) + 1 + width(word) <= cols) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
      while (width(line) > cols) {
        const chars = [...line];
        lines.push(chars.slice(0, cols).join(""));
        line = chars.slice(cols).join("");
      }
    }
    lines.push(line);
  }
  return lines;
}

/** "Left ........ right" on one line; the left side wraps above when both don't fit. */
export function twoColumns(left: string, right: string, cols: number): string[] {
  const room = cols - width(right) - 1;
  if (room < 4) return [...wrap(left, cols), " ".repeat(Math.max(0, cols - width(right))) + right];
  const lines = wrap(left, room);
  const last = lines.pop() ?? "";
  return [...lines, last + " ".repeat(cols - width(last) - width(right)) + right];
}

export interface ReceiptLineItem {
  /** e.g. "2x Robe pagne" — already built by the caller. */
  label: string;
  /** e.g. "Rouge · M" — printed indented under the label; empty for none. */
  detail: string;
  /** e.g. "12 000 FCFA". */
  amount: string;
}

/**
 * Everything printed, already formatted and translated by the app — the encoder only lays it out. Matches the
 * on-screen ticket (components/Receipt.tsx).
 */
export interface ReceiptDocument {
  storeName: string;
  storeAddress?: string | null;
  storePhone?: string | null;
  /** Date, sale number, cashier — one line each, in order. */
  infoLines: string[];
  items: ReceiptLineItem[];
  /** Subtotal / discount lines shown above the total, as label + amount. */
  adjustments: { label: string; amount: string }[];
  total: { label: string; amount: string };
  payment: { label: string; value: string };
  footer?: string | null;
}

export interface EncodeOptions {
  columns: PaperColumns;
  accents: boolean;
  /** Feed and cut at the end (default true). */
  cut?: boolean;
  /** Ask the printer to answer once the ticket went through (default true; see CMD.confirmMarker). */
  confirm?: boolean;
}

/** The receipt as printer bytes, ready to send as is. */
export function encodeReceipt(doc: ReceiptDocument, opts: EncodeOptions): Uint8Array {
  const { columns: cols, accents } = opts;
  const out: number[] = [];
  const raw = (bytes: readonly number[]) => out.push(...bytes);
  const text = (s: string) => raw(encodeText(s, accents));
  const line = (s = "") => {
    text(s);
    out.push(0x0a);
  };
  const rule = () => line("-".repeat(cols));

  raw(CMD.init);
  if (accents) raw(CMD.codePage1252);

  // Header: big centred store name, then address and phone.
  raw(CMD.alignCenter);
  raw(CMD.boldOn);
  raw(CMD.size(0x11));
  for (const l of wrap(doc.storeName.toUpperCase(), Math.floor(cols / 2))) line(l);
  raw(CMD.size(0x00));
  raw(CMD.boldOff);
  for (const extra of [doc.storeAddress, doc.storePhone]) {
    if (extra) for (const l of wrap(extra, cols)) line(l);
  }
  raw(CMD.alignLeft);
  rule();

  for (const info of doc.infoLines) for (const l of wrap(info, cols)) line(l);
  rule();

  for (const item of doc.items) {
    for (const l of twoColumns(item.label, item.amount, cols)) line(l);
    if (item.detail) for (const l of wrap(item.detail, cols - 2)) line(`  ${l}`);
  }
  rule();

  for (const adj of doc.adjustments) for (const l of twoColumns(adj.label, adj.amount, cols)) line(l);
  raw(CMD.boldOn);
  raw(CMD.size(0x01));
  for (const l of twoColumns(doc.total.label, doc.total.amount, cols)) line(l);
  raw(CMD.size(0x00));
  raw(CMD.boldOff);
  for (const l of twoColumns(doc.payment.label, doc.payment.value, cols)) line(l);

  if (doc.footer) {
    rule();
    raw(CMD.alignCenter);
    for (const l of wrap(doc.footer, cols)) line(l);
    raw(CMD.alignLeft);
  }

  if (opts.cut !== false) {
    raw(CMD.feed(4));
    raw(CMD.cut);
  } else {
    raw(CMD.feed(3));
  }
  if (opts.confirm !== false) raw(CMD.confirmMarker);
  return Uint8Array.from(out);
}

// ── Status ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PrinterStatus {
  offline: boolean;
  coverOpen: boolean;
  paperOut: boolean;
  paperNearEnd: boolean;
  /** Cutter jam, overheating or another error the printer reports. */
  error: boolean;
}

export type PrinterProblem = "offline" | "coverOpen" | "paperOut" | "error";

/** Status bytes carry fixed marker bits (bit 1 and 4 set, bits 0 and 7 clear) — anything else is not a status. */
export function isRealtimeStatusByte(b: number): boolean {
  return (b & 0x93) === 0x12;
}

/** Merges the answers to DLE EOT 1, 2 and 4 (any of them may be missing) into one status. */
export function parseRealtimeStatus(answers: { printer?: number; offlineCause?: number; paper?: number }): PrinterStatus {
  const { printer = 0x12, offlineCause = 0x12, paper = 0x12 } = answers;
  return {
    offline: (printer & 0x08) !== 0,
    coverOpen: (offlineCause & 0x04) !== 0,
    paperOut: (paper & 0x60) !== 0 || (offlineCause & 0x20) !== 0,
    paperNearEnd: (paper & 0x0c) !== 0,
    error: (offlineCause & 0x40) !== 0,
  };
}

/** The answer to GS r 1 (CMD.confirmMarker): bits 0–1 paper near end, bits 2–3 paper end, bit 4 always clear. */
export function parseConfirmByte(b: number): { valid: boolean; paperOut: boolean; paperNearEnd: boolean } {
  return { valid: (b & 0x90) === 0, paperOut: (b & 0x0c) !== 0, paperNearEnd: (b & 0x03) !== 0 };
}

/** The first thing stopping the printer from printing, if any — in the order a cashier should fix them. */
export function blockingProblem(s: PrinterStatus): PrinterProblem | null {
  if (s.coverOpen) return "coverOpen";
  if (s.paperOut) return "paperOut";
  if (s.error) return "error";
  if (s.offline) return "offline";
  return null;
}

// ── Turning bytes back into text (tests, and the "what was sent" preview) ─────────────────────────────────────────

/** Strips commands and returns the printed text — used by tests and fake printers to check a ticket. */
export function decodeForPreview(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === ESC) {
      const op = bytes[i + 1];
      i += op === 0x40 ? 1 : 2; // ESC @ has no argument; ESC t/a/E/d have one
      continue;
    }
    if (b === GS) {
      const op = bytes[i + 1];
      i += op === 0x56 ? 3 : 2; // GS V m n; GS ! n; GS r n
      continue;
    }
    if (b === DLE) {
      i += 2;
      continue;
    }
    if (b === 0x0a) s += "\n";
    else if (b >= 0x20 && b < 0x80) s += String.fromCharCode(b);
    else if (b >= 0xa0) s += String.fromCharCode(b);
    else {
      const extra = Object.entries(CP1252_EXTRA).find(([, v]) => v === b);
      s += extra ? extra[0] : "?";
    }
  }
  return s;
}
