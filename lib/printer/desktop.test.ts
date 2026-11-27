/**
 * Desktop printing, end to end without hardware: the receipt built from a sale (receiptDocument.ts), encoded, and sent
 * through the print-with-confirmation flow over a real TCP connection to scripts/fake-escpos-printer.mjs, in each of
 * the situations it can simulate. The TCP adapter here behaves like the Rust network link (src-tauri/src/printer/
 * link.rs): an empty read on silence, an error once the printer closed the connection.
 * Run with `npm run test:printer`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import type { ReceiptData } from "../../components/Receipt";
import type { PosSettings } from "../types";
import { decodeForPreview, encodeReceipt } from "./escpos";
import { checkPrinter, PrinterConnection } from "./printJob";
import { buildReceiptDocument } from "./receiptDocument";
import { printOverLink, queueFailure } from "./printReceipt";
import { knownForNextPrint, learnFrom } from "./printerSettingsStore";

// ── Receipt content ─────────────────────────────────────────────────────────────────────────────────────────────

const FR: Record<string, string> = {
  "receipt.saleNo": "Vente n° {{ref}}",
  "receipt.servedBy": "Servi par {{name}}",
  "receipt.subtotal": "Sous-total",
  "receipt.bulkDiscount": "Remise quantité",
  "receipt.total": "TOTAL",
  "receipt.payment": "Paiement",
  "pay.cash": "Espèces",
  "pay.orangeMoney": "Orange Money",
  "pay.mtnMomo": "MTN MoMo",
};
const t = (key: string, vars?: Record<string, string | number>) =>
  Object.entries(vars ?? {}).reduce((s, [k, v]) => s.split(`{{${k}}}`).join(String(v)), FR[key] ?? key);

const settings: PosSettings = {
  storeName: "Riskyc Fashion",
  storeAddress: "Akwa, Douala",
  storePhone: "+237 690 00 00 00",
  footerMessage: "Merci et à bientôt !",
  showCashierName: true,
  showSaleId: true,
  showLogo: false,
  paperWidth: "MM58",
  logoUrl: null,
  cashEnabled: true,
  orangeMoneyEnabled: true,
  mobileMoneyEnabled: true,
};

const sale: ReceiptData = {
  saleRef: "A1B2C3D4",
  cashierName: "Arnold",
  items: [
    { productName: "Blousson Ermess", selectedColor: "Noir", selectedSize: "M", quantity: 1, unitPrice: 35000 },
    { productName: "Maillot", selectedColor: "", selectedSize: "", quantity: 2, unitPrice: 3500 },
  ],
  total: 41000,
  paymentMethod: "ORANGE_MONEY",
  soldAt: "2026-11-27T10:42:00.000Z",
  discount: 1000,
};

test("receipt document has the on-screen ticket's content, in order", () => {
  const doc = buildReceiptDocument(sale, settings, t as never, "fr-FR");
  assert.equal(doc.storeName, "Riskyc Fashion");
  assert.equal(doc.infoLines.length, 3);
  assert.equal(doc.infoLines[0], new Date(sale.soldAt).toLocaleString("fr-FR"));
  assert.equal(doc.infoLines[1], "Vente n° A1B2C3D4");
  assert.equal(doc.infoLines[2], "Servi par Arnold");
  assert.deepEqual(doc.items[0], { label: "1× Blousson Ermess", detail: "Noir · M", amount: "35,000 FCFA" });
  assert.deepEqual(doc.items[1], { label: "2× Maillot", detail: "", amount: "7,000 FCFA" });
  assert.deepEqual(doc.adjustments, [
    { label: "Sous-total", amount: "42,000 FCFA" },
    { label: "Remise quantité", amount: "-1,000 FCFA" },
  ]);
  assert.deepEqual(doc.total, { label: "TOTAL", amount: "41,000 FCFA" });
  assert.deepEqual(doc.payment, { label: "Paiement", value: "Orange Money" });
  assert.equal(doc.footer, "Merci et à bientôt !");
});

test("receipt document follows the ticket settings: no sale no., no cashier, no discount line", () => {
  const doc = buildReceiptDocument(
    { ...sale, discount: 0, paymentMethod: "CASH" },
    { ...settings, showSaleId: false, showCashierName: false, footerMessage: null },
    t as never,
    "fr-FR"
  );
  assert.equal(doc.infoLines.length, 1);
  assert.deepEqual(doc.adjustments, []);
  assert.equal(doc.payment.value, "Espèces");
  assert.equal(doc.footer, null);
});

test("encoded 58 mm ticket fits and reads back (× and · kept with accents on, plain without)", () => {
  const doc = buildReceiptDocument(sale, settings, t as never, "fr-FR");
  const text = decodeForPreview(encodeReceipt(doc, { columns: 32, accents: true }));
  for (const line of text.split("\n")) assert.ok([...line].length <= 32, `too wide: "${line}"`);
  assert.match(text, /1× Blousson Ermess\s+35,000 FCFA/);
  assert.match(text, /Noir · M/);
  assert.match(text, /Remise quantité\s+-1,000 FCFA/);
  const plain = decodeForPreview(encodeReceipt(doc, { columns: 32, accents: false }));
  assert.match(plain, /1x Blousson Ermess/);
  assert.match(plain, /Remise quantite/);
});

// ── Learning what a printer supports ────────────────────────────────────────────────────────────────────────────

test("capabilities: a refused ticket doesn't teach 'no confirmation'; a silent printer stops being asked", () => {
  const caps = { realtimeStatus: true, confirm: false };
  assert.deepEqual(learnFrom(null, { result: "failed", failure: "coverOpen", capabilities: caps }), { realtimeStatus: true });
  assert.deepEqual(learnFrom(null, { result: "printed", paperNearEnd: false, capabilities: { realtimeStatus: true, confirm: true } }), {
    realtimeStatus: true,
    confirm: true,
  });
  const silent = learnFrom(null, { result: "sent", capabilities: { realtimeStatus: false, confirm: false } });
  assert.deepEqual(knownForNextPrint(silent), { confirm: false, realtimeStatus: false });
  // Confirms tickets but no real-time status: keep asking for status (it may just have been busy).
  assert.deepEqual(knownForNextPrint({ realtimeStatus: false, confirm: true }), { confirm: true, realtimeStatus: undefined });
});

test("print queue flags map to the cashier's words", () => {
  const none = { offline: false, paperOut: false, coverOpen: false, error: false, paused: false, needsAttention: false, message: null };
  assert.equal(queueFailure(none), null);
  assert.equal(queueFailure({ ...none, paperOut: true, offline: true }), "paperOut");
  assert.equal(queueFailure({ ...none, paused: true }), "offline");
  assert.equal(queueFailure({ ...none, needsAttention: true }), "error");
});

// ── Against the fake printer ────────────────────────────────────────────────────────────────────────────────────

const SCRIPT = path.join(process.cwd(), "scripts", "fake-escpos-printer.mjs");

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

async function startFakePrinter(...flags: string[]): Promise<{ port: number; output: () => string; stop: () => Promise<void> }> {
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, [SCRIPT, String(port), ...flags], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout!.on("data", (d) => (stdout += d));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fake printer didn't start")), 5000);
    child.stderr!.on("data", (d) => {
      if (String(d).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  return {
    port,
    output: () => stdout,
    stop: () =>
      new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.kill();
      }),
  };
}

/** Like the desktop's network link: bytes since the last read, empty on silence, an error once closed. */
function tcpConnection(port: number): Promise<PrinterConnection> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    let buf: number[] = [];
    let closed = false;
    let wake: (() => void) | null = null;
    sock.on("data", (d) => {
      buf.push(...d);
      wake?.();
    });
    sock.on("close", () => {
      closed = true;
      wake?.();
    });
    sock.on("error", () => undefined);
    sock.once("error", reject);
    sock.once("connect", () =>
      resolve({
        canRead: true,
        write: (bytes) =>
          new Promise((res, rej) => (closed ? rej(new Error("connection closed")) : sock.write(bytes, (e) => (e ? rej(e) : res())))),
        read: (timeoutMs) =>
          new Promise((res, rej) => {
            const take = () => {
              const out = Uint8Array.from(buf);
              buf = [];
              return out;
            };
            if (buf.length) return res(take());
            if (closed) return rej(new Error("the printer closed the connection"));
            const timer = setTimeout(() => {
              wake = null;
              res(new Uint8Array());
            }, timeoutMs);
            wake = () => {
              clearTimeout(timer);
              wake = null;
              if (buf.length) res(take());
              else rej(new Error("the printer closed the connection"));
            };
          }),
        close: async () => {
          sock.destroy();
        },
      })
    );
  });
}

const ticket = encodeReceipt(buildReceiptDocument(sale, settings, t as never, "fr-FR"), { columns: 32, accents: true });
const fast = { statusTimeoutMs: 400, confirmTimeoutMs: 1500 };

async function printOn(...flags: string[]) {
  const printer = await startFakePrinter(...flags);
  try {
    const outcome = await printOverLink(() => tcpConnection(printer.port), ticket, {}, fast);
    await new Promise((r) => setTimeout(r, 150)); // let the fake printer flush its output
    return { outcome, printed: printer.output() };
  } finally {
    await printer.stop();
  }
}

test("fake printer, all fine → printed, and the ticket text came out", async () => {
  const { outcome, printed } = await printOn();
  assert.equal(outcome.result, "printed");
  assert.ok(outcome.result === "printed" && !outcome.paperNearEnd);
  assert.deepEqual(outcome.capabilities, { realtimeStatus: true, confirm: true });
  assert.match(printed, /RISKYC FASHION/);
  assert.match(printed, /Vente n° A1B2C3D4/);
  assert.match(printed, /Merci et à bientôt !/);
});

test("fake printer, paper running low → printed, with the warning", async () => {
  const { outcome } = await printOn("--paper-near-end");
  assert.ok(outcome.result === "printed" && outcome.paperNearEnd);
});

test("fake printer, no paper → not printed (paperOut), nothing sent", async () => {
  const { outcome, printed } = await printOn("--paper-out");
  assert.deepEqual([outcome.result, outcome.result === "failed" && outcome.failure], ["failed", "paperOut"]);
  assert.doesNotMatch(printed, /RISKYC/);
});

test("fake printer, cover open → not printed (coverOpen)", async () => {
  const { outcome } = await printOn("--cover-open");
  assert.deepEqual([outcome.result, outcome.result === "failed" && outcome.failure], ["failed", "coverOpen"]);
});

test("fake printer, paper runs out mid-ticket → not printed (paperOutDuringPrint)", async () => {
  const { outcome } = await printOn("--run-out");
  assert.deepEqual([outcome.result, outcome.result === "failed" && outcome.failure], ["failed", "paperOutDuringPrint"]);
});

test("fake printer that never answers → sent (not 'printed'), ticket still delivered", async () => {
  const { outcome, printed } = await printOn("--silent");
  assert.equal(outcome.result, "sent");
  assert.deepEqual(outcome.capabilities, { realtimeStatus: false, confirm: false });
  assert.match(printed, /RISKYC FASHION/);
});

test("fake printer answering status but not the confirmation → sent", async () => {
  const { outcome } = await printOn("--no-confirm");
  assert.equal(outcome.result, "sent");
  assert.deepEqual(outcome.capabilities, { realtimeStatus: true, confirm: false });
});

test("fake printer dropping the connection mid-ticket → not printed (interrupted)", async () => {
  const { outcome } = await printOn("--drop");
  assert.deepEqual([outcome.result, outcome.result === "failed" && outcome.failure], ["failed", "interrupted"]);
});

test("slow confirmation is waited for", async () => {
  const printer = await startFakePrinter("--slow=800");
  try {
    const outcome = await printOverLink(() => tcpConnection(printer.port), ticket, {}, { statusTimeoutMs: 400, confirmTimeoutMs: 3000 });
    assert.equal(outcome.result, "printed");
  } finally {
    await printer.stop();
  }
});

test("printer switched off (nothing listening) → not printed (unreachable)", async () => {
  const port = await freePort();
  const outcome = await printOverLink(() => tcpConnection(port), ticket, {}, fast);
  assert.deepEqual([outcome.result, outcome.result === "failed" && outcome.failure], ["failed", "unreachable"]);
});

test("Check button: ready / no paper", async () => {
  for (const [flags, paperOut] of [[[], false], [["--paper-out"], true]] as const) {
    const printer = await startFakePrinter(...flags);
    try {
      const checked = await checkPrinter(() => tcpConnection(printer.port), { statusTimeoutMs: 400 });
      assert.ok(checked.reachable && checked.status);
      assert.equal(checked.status.paperOut, paperOut);
    } finally {
      await printer.stop();
    }
  }
});
