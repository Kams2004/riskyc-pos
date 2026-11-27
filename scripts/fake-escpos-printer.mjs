#!/usr/bin/env node
/**
 * A pretend network receipt printer, for trying the till's thermal printing without hardware.
 *
 *   node scripts/fake-escpos-printer.mjs [port] [flags]      (port defaults to 9100)
 *
 * It listens like a real ESC/POS printer on the raw printing port, answers the real-time status queries
 * (DLE EOT 1/2/4) and the end-of-ticket confirmation (GS r 1), and prints each ticket's text to stdout.
 *
 * Flags (simulate problems):
 *   --paper-out        no paper: status says so, nothing is printed
 *   --cover-open       cover open: status says so, nothing is printed
 *   --paper-near-end   paper running low (still prints)
 *   --run-out          paper runs out during the ticket: the confirmation says "paper end"
 *   --silent           never answers anything (a one-way printer, or one without status support); still prints
 *   --no-confirm       answers status but ignores GS r 1
 *   --drop             closes the connection as soon as the ticket starts arriving (connection lost)
 *   --slow=MS          waits MS milliseconds before confirming (a long ticket on a slow printer)
 *
 * In the till: Settings → Printer → enter this computer's IP address (or 127.0.0.1) and port.
 */
import net from "node:net";

const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 9100);
const flag = (name) => args.includes(`--${name}`);
const slowArg = args.find((a) => a.startsWith("--slow="));
const slowMs = slowArg ? Number(slowArg.split("=")[1]) : 0;

const paperOut = flag("paper-out");
const coverOpen = flag("cover-open");
const nearEnd = flag("paper-near-end");
const runOut = flag("run-out");
const silent = flag("silent");
const noConfirm = flag("no-confirm");
const drop = flag("drop");

const ESC = 0x1b, GS = 0x1d, DLE = 0x10, EOT = 0x04;

/** DLE EOT n answers. Fixed bits: 1 and 4 set (0x12). */
function realtimeStatus(n) {
  const blocked = paperOut || coverOpen;
  if (n === 1) return 0x12 | (blocked ? 0x08 : 0); // bit 3: offline
  if (n === 2) return 0x12 | (coverOpen ? 0x04 : 0) | (paperOut ? 0x20 : 0); // bit 2 cover open, bit 5 paper-end stop
  if (n === 4) return 0x12 | (nearEnd ? 0x0c : 0) | (paperOut ? 0x60 : 0); // bits 2–3 near end, 5–6 paper end
  return 0x12;
}

/** GS r 1 answer: bits 0–1 paper near end, bits 2–3 paper end. */
function confirmByte() {
  return (nearEnd ? 0x03 : 0) | (paperOut || runOut ? 0x0c : 0);
}

const CP1252 = { 0x80: "€", 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x9c: "œ", 0x8c: "Œ" };

const server = net.createServer((socket) => {
  const who = `${socket.remoteAddress}:${socket.remotePort}`;
  let text = "";
  let pending = Buffer.alloc(0);
  let printedSomething = false;
  log(`connection from ${who}`);

  const flush = (why) => {
    if (!text.trim()) return;
    const blocked = paperOut || coverOpen;
    console.log(`\n┌── ticket ${blocked ? "NOT PRINTED (" + (paperOut ? "no paper" : "cover open") + ")" : "printed"} — ${why} ──`);
    for (const line of text.replace(/\n+$/, "").split("\n")) console.log(`│ ${line}`);
    console.log("└──");
    text = "";
    printedSomething = true;
  };

  socket.on("data", (chunk) => {
    if (drop && chunk.some((b) => b >= 0x20 && b !== DLE)) {
      log("--drop: closing the connection mid-ticket");
      socket.destroy();
      return;
    }
    pending = Buffer.concat([pending, chunk]);
    let i = 0;
    while (i < pending.length) {
      const b = pending[i];
      const left = pending.length - i;
      if (b === DLE) {
        if (left < 3) break;
        if (pending[i + 1] === EOT) {
          const n = pending[i + 2];
          if (!silent) socket.write(Buffer.from([realtimeStatus(n)]));
        }
        i += 3;
        continue;
      }
      if (b === ESC) {
        if (left < 2) break;
        const op = pending[i + 1];
        if (op === 0x40) { i += 2; continue; } // ESC @
        if (left < 3) break;
        i += 3; // ESC t n, ESC a n, ESC E n, ESC d n
        continue;
      }
      if (b === GS) {
        if (left < 2) break;
        const op = pending[i + 1];
        if (op === 0x56) { // GS V m n
          if (left < 4) break;
          i += 4;
          text += "✂ - - - - - - - - - - - - -\n";
          continue;
        }
        if (left < 3) break;
        if (op === 0x72) { // GS r n: confirmation, after everything before it is processed
          const answer = confirmByte();
          flush(runOut ? "paper ran out during the ticket" : silent || noConfirm ? "not confirmed to the till" : "confirmed");
          if (!silent && !noConfirm) setTimeout(() => !socket.destroyed && socket.write(Buffer.from([answer])), slowMs);
        }
        i += 3; // GS ! n, GS r n
        continue;
      }
      if (b === 0x0a) text += "\n";
      else if (b >= 0x20 && b < 0x7f) text += String.fromCharCode(b);
      else if (b >= 0xa0) text += String.fromCharCode(b); // Latin-1 = Windows-1252 from 0xA0
      else if (CP1252[b]) text += CP1252[b];
      i += 1;
    }
    pending = pending.subarray(i);
  });

  socket.on("close", () => {
    flush("connection closed");
    log(`${who} disconnected${printedSomething ? "" : " (nothing printed)"}`);
  });
  socket.on("error", () => undefined);
});

function log(msg) {
  console.error(`[fake printer :${port}] ${msg}`);
}

server.listen(port, "0.0.0.0", () => {
  const mode = [paperOut && "no paper", coverOpen && "cover open", nearEnd && "paper near end", runOut && "runs out mid-ticket",
    silent && "silent", noConfirm && "no confirmation", drop && "drops the connection", slowMs && `confirms after ${slowMs} ms`]
    .filter(Boolean).join(", ") || "all fine";
  log(`listening on port ${port} — ${mode}`);
});
