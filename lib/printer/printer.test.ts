/**
 * Receipt encoding and the print/confirm flow against simulated printers. Run with `npm run test:printer`.
 * Shared with riskyc-pos-mobile (same file there).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeForPreview, encodeReceipt, encodeText, parseRealtimeStatus, ReceiptDocument, twoColumns, wrap } from "./escpos";
import { checkPrinter, PrinterConnection, printWithConfirmation } from "./printJob";

const doc: ReceiptDocument = {
  storeName: "Riskyc Fashion Akwa",
  storeAddress: "Rue Joss, Douala",
  storePhone: "+237 6 90 00 00 00",
  infoLines: ["27/11/2026 10:42", "Vente n° 8F3A21", "Servi par Arnold"],
  items: [
    { label: "2x Robe pagne wax manches longues taille unique", detail: "Rouge · M", amount: "24 000 FCFA" },
    { label: "1x Ceinture", detail: "", amount: "3 500 FCFA" },
  ],
  adjustments: [
    { label: "Sous-total", amount: "27 500 FCFA" },
    { label: "Remise", amount: "-500 FCFA" },
  ],
  total: { label: "TOTAL", amount: "27 000 FCFA" },
  payment: { label: "Paiement", value: "Orange Money" },
  footer: "Merci et à bientôt !",
};

test("58 mm ticket: every line fits in 32 columns, accents kept, ends with cut and confirmation", () => {
  const bytes = encodeReceipt(doc, { columns: 32, accents: true });
  const text = decodeForPreview(bytes);
  for (const line of text.split("\n")) assert.ok([...line].length <= 32, `too wide: "${line}"`);
  assert.match(text, /Vente n° 8F3A21/);
  assert.match(text, /Merci et à bientôt !/);
  assert.match(text, /TOTAL\s+27 000 FCFA/);
  assert.match(text, /Paiement\s+Orange Money/);
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40], "starts with ESC @");
  assert.deepEqual([...bytes.slice(-3)], [0x1d, 0x72, 0x01], "ends with GS r 1");
  assert.ok(bytes.includes(0xe0), "à sent as Windows-1252 0xE0");
});

test("80 mm ticket uses 48 columns", () => {
  const text = decodeForPreview(encodeReceipt(doc, { columns: 48, accents: true }));
  assert.ok(text.split("\n").some((l) => [...l].length === 48));
  assert.ok(text.split("\n").every((l) => [...l].length <= 48));
});

test("without accents only plain ASCII is sent", () => {
  const bytes = encodeReceipt(doc, { columns: 32, accents: false, confirm: false, cut: false });
  const text = decodeForPreview(bytes);
  assert.match(text, /Merci et a bientot !/);
  assert.match(text, /Rouge - M/);
  assert.deepEqual([...encodeText("é€×", false)], [..."eEURx"].map((c) => c.charCodeAt(0)));
});

test("wrap and two columns", () => {
  assert.deepEqual(wrap("un deux trois quatre", 9), ["un deux", "trois", "quatre"]);
  assert.deepEqual(wrap("abcdefghijk", 4), ["abcd", "efgh", "ijk"]);
  assert.deepEqual(twoColumns("TOTAL", "500 FCFA", 20), ["TOTAL       500 FCFA"]);
});

test("status bytes", () => {
  assert.deepEqual(parseRealtimeStatus({ printer: 0x12, offlineCause: 0x12, paper: 0x12 }), {
    offline: false, coverOpen: false, paperOut: false, paperNearEnd: false, error: false,
  });
  assert.equal(parseRealtimeStatus({ printer: 0x1a, offlineCause: 0x16, paper: 0x12 }).coverOpen, true);
  assert.equal(parseRealtimeStatus({ paper: 0x72 }).paperOut, true);
  assert.equal(parseRealtimeStatus({ paper: 0x1e }).paperNearEnd, true);
});

// ── Simulated printers ───────────────────────────────────────────────────────────────────────────────────────────

interface FakeBehaviour {
  realtime?: boolean;
  confirm?: boolean;
  printerByte?: number;
  offlineCauseByte?: number;
  paperByte?: number;
  confirmByte?: number;
  canRead?: boolean;
  failOpen?: boolean;
  failWrite?: boolean;
}

function fakePrinter(b: FakeBehaviour) {
  const received: number[] = [];
  let inbox: number[] = [];
  const conn: PrinterConnection = {
    canRead: b.canRead !== false,
    async write(bytes) {
      if (b.failWrite) throw new Error("broken pipe");
      for (let i = 0; i < bytes.length; i++) {
        received.push(bytes[i]);
        if (bytes[i] === 0x10 && bytes[i + 1] === 0x04 && b.realtime !== false) {
          const n = bytes[i + 2];
          inbox.push(n === 1 ? b.printerByte ?? 0x12 : n === 2 ? b.offlineCauseByte ?? 0x12 : b.paperByte ?? 0x12);
        }
        if (bytes[i] === 0x1d && bytes[i + 1] === 0x72 && b.confirm !== false) inbox.push(b.confirmByte ?? 0x00);
      }
    },
    async read() {
      const out = Uint8Array.from(inbox);
      inbox = [];
      return out;
    },
    async close() {},
  };
  return {
    received,
    open: async () => {
      if (b.failOpen) throw new Error("connect ECONNREFUSED 192.168.1.50:9100");
      return conn;
    },
  };
}

const ticket = encodeReceipt(doc, { columns: 32, accents: true });
const fast = { statusTimeoutMs: 20, confirmTimeoutMs: 50 };

test("healthy printer: printed and confirmed", async () => {
  const p = fakePrinter({});
  const out = await printWithConfirmation(p.open, ticket, fast);
  assert.equal(out.result, "printed");
  assert.deepEqual(out.result === "printed" && out.capabilities, { realtimeStatus: true, confirm: true });
  assert.match(decodeForPreview(Uint8Array.from(p.received)), /TOTAL/);
});

test("paper out before printing: nothing is printed", async () => {
  const p = fakePrinter({ paperByte: 0x72 });
  const out = await printWithConfirmation(p.open, ticket, fast);
  assert.deepEqual(out.result === "failed" && out.failure, "paperOut");
  assert.ok(!decodeForPreview(Uint8Array.from(p.received)).includes("TOTAL"));
});

test("cover open is reported", async () => {
  const out = await printWithConfirmation(fakePrinter({ printerByte: 0x1a, offlineCauseByte: 0x16 }).open, ticket, fast);
  assert.deepEqual(out.result === "failed" && out.failure, "coverOpen");
});

test("paper ran out during the ticket", async () => {
  const out = await printWithConfirmation(fakePrinter({ confirmByte: 0x0c }).open, ticket, fast);
  assert.deepEqual(out.result === "failed" && out.failure, "paperOutDuringPrint");
});

test("printer that never answers: sent, not confirmed", async () => {
  const out = await printWithConfirmation(fakePrinter({ realtime: false, confirm: false }).open, ticket, fast);
  assert.equal(out.result, "sent");
});

test("answers status but not the confirmation: sent", async () => {
  const out = await printWithConfirmation(fakePrinter({ confirm: false }).open, ticket, fast);
  assert.equal(out.result, "sent");
  assert.deepEqual(out.result === "sent" && out.capabilities, { realtimeStatus: true, confirm: false });
});

test("one-way link (system spooler): sent without asking anything", async () => {
  const p = fakePrinter({ canRead: false });
  const out = await printWithConfirmation(p.open, ticket, fast);
  assert.equal(out.result, "sent");
  assert.ok(!p.received.some((b, i) => b === 0x10 && p.received[i + 1] === 0x04), "no status query on one-way link");
});

test("unreachable and broken connection", async () => {
  const off = await printWithConfirmation(fakePrinter({ failOpen: true }).open, ticket, fast);
  assert.deepEqual(off.result === "failed" && off.failure, "unreachable");
  const cut = await printWithConfirmation(fakePrinter({ failWrite: true, realtime: false }).open, ticket, fast);
  assert.deepEqual(cut.result === "failed" && cut.failure, "interrupted");
});

test("check printer", async () => {
  const ok = await checkPrinter(fakePrinter({}).open, fast);
  assert.ok(ok.reachable && ok.status && !ok.status.paperOut);
  const silent = await checkPrinter(fakePrinter({ realtime: false }).open, fast);
  assert.ok(silent.reachable && silent.status === null);
});
