"use client";

import { useState } from "react";
import { AlertTriangle, Bluetooth, Check, Loader2, Network, Printer as PrinterIcon, Search, Usb, XCircle } from "lucide-react";
import clsx from "clsx";
import ToggleSwitch from "./ToggleSwitch";
import { failureKey } from "./ReceiptPrinter";
import { isDesktop } from "@/lib/desktop";
import { TKey, useT } from "@/lib/i18n";
import {
  DEFAULT_NETWORK_PORT,
  describeTarget,
  discoverPrinters,
  DiscoveryProgress,
  FoundPrinter,
  PrinterGroup,
  PrinterTarget,
  targetId,
} from "@/lib/printer/desktopTransport";
import { CheckResult, checkTarget, isPermissionProblem } from "@/lib/printer/printReceipt";
import { PrintMode, usePrinterSettingsStore } from "@/lib/printer/printerSettingsStore";
import type { PosSettings } from "@/lib/types";

const GROUPS: { group: PrinterGroup; label: TKey; icon: typeof Network }[] = [
  { group: "network", label: "printer.group.network", icon: Network },
  { group: "bluetooth", label: "printer.group.bluetooth", icon: Bluetooth },
  { group: "usb", label: "printer.group.usb", icon: Usb },
  { group: "other", label: "printer.group.other", icon: PrinterIcon },
];

const PARTS: { part: keyof DiscoveryProgress; label: TKey }[] = [
  { part: "network", label: "printer.part.network" },
  { part: "ports", label: "printer.part.ports" },
  { part: "system", label: "printer.part.system" },
];

type CheckState = { checking: true } | { checking: false; result: CheckResult };

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function StatusChip({ state }: { state: CheckState }) {
  const { t } = useT();
  if (state.checking) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500">
        <Loader2 size={11} className="animate-spin" /> {t("printer.checking")}
      </span>
    );
  }
  const r = state.result;
  const [tone, label]: ["green" | "amber" | "red", string] =
    r.state === "ready"
      ? [r.paperNearEnd ? "amber" : "green", t(r.paperNearEnd ? "printer.status.readyLow" : "printer.status.ready")]
      : r.state === "queueReady"
        ? ["green", t("printer.status.queueReady")]
        : r.state === "noStatus"
          ? ["amber", t("printer.status.noStatus")]
          : r.state === "problem"
            ? ["red", t(({ paperOut: "printer.status.paperOut", coverOpen: "printer.status.coverOpen", offline: "printer.status.offline", error: "printer.status.error" } as const)[r.problem])]
            : ["red", t("printer.status.notResponding")];
  const detail = r.state === "unreachable" ? r.detail : r.state === "problem" ? r.detail : undefined;
  return (
    <span className="inline-flex flex-col">
      <span
        className={clsx(
          "inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 w-fit",
          tone === "green" && "bg-green-50 text-green-700",
          tone === "amber" && "bg-amber-50 text-amber-700",
          tone === "red" && "bg-red-50 text-red-600"
        )}
      >
        {tone === "green" ? <Check size={11} /> : tone === "amber" ? <AlertTriangle size={11} /> : <XCircle size={11} />}
        {label}
      </span>
      {isPermissionProblem(detail) && <span className="text-[11px] text-red-500 mt-0.5">{t("print.permissionHint")}</span>}
      {detail && <span className="text-[10px] text-gray-400 mt-0.5 break-all">{detail}</span>}
    </span>
  );
}

/**
 * Settings → Printer, this till's part: thermal printer or print window, finding and checking the receipt printer,
 * typing its IP address, accents. Saved on this till at once (lib/printer/printerSettingsStore.ts).
 */
export default function PrinterSetup({ settings }: { settings: PosSettings }) {
  const { t, locale } = useT();
  const desktop = isDesktop();
  const mode = usePrinterSettingsStore((s) => s.mode);
  const target = usePrinterSettingsStore((s) => s.target);
  const targetName = usePrinterSettingsStore((s) => s.targetName);
  const accents = usePrinterSettingsStore((s) => s.accents);
  const lastResult = usePrinterSettingsStore((s) => s.lastResult);
  const setMode = usePrinterSettingsStore((s) => s.setMode);
  const chooseTarget = usePrinterSettingsStore((s) => s.chooseTarget);
  const updateTarget = usePrinterSettingsStore((s) => s.updateTarget);
  const setAccents = usePrinterSettingsStore((s) => s.setAccents);

  const [found, setFound] = useState<FoundPrinter[] | null>(null);
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [ip, setIp] = useState("");
  const [port, setPort] = useState(String(DEFAULT_NETWORK_PORT));
  const [ipError, setIpError] = useState(false);

  const searching = !!progress && Object.values(progress).some((p) => p === "searching");
  const effectiveMode: PrintMode = desktop ? mode : "system";

  const search = async () => {
    setChecks({});
    await discoverPrinters(
      {
        networkPrinter: t("printer.networkName"),
        bluetoothPrinter: t("printer.bluetoothName"),
        usbPrinter: t("printer.usbName"),
        serialPort: t("printer.serialName"),
      },
      (list, p) => {
        setFound(list);
        setProgress(p);
      }
    );
  };

  const check = async (id: string, which: PrinterTarget) => {
    setChecks((c) => ({ ...c, [id]: { checking: true } }));
    const { result, confirmedBaud } = await checkTarget(which);
    setChecks((c) => ({ ...c, [id]: { checking: false, result } }));
    if (confirmedBaud && which.kind === "serial") {
      const withBaud: PrinterTarget = { ...which, baud: confirmedBaud };
      // Remember the speed it answered at, in the list and — if it's the printer in use — in the settings.
      setFound((list) => list?.map((f) => (f.id === id ? { ...f, target: withBaud } : f)) ?? list);
      if (target && targetId(target) === id) updateTarget(withBaud);
    }
  };

  const applyManualAddress = () => {
    const host = ip.trim();
    const portNumber = Number(port) || DEFAULT_NETWORK_PORT;
    if (!IPV4.test(host) || portNumber < 1 || portNumber > 65535) {
      setIpError(true);
      return;
    }
    setIpError(false);
    const manual: PrinterTarget = { kind: "network", host, port: portNumber };
    chooseTarget(manual, t("printer.networkName"));
    void check(targetId(manual), manual);
  };

  const currentId = target ? targetId(target) : null;

  return (
    <div className="space-y-4">
      {/* Mode */}
      <div>
        <p className="block text-xs font-semibold text-gray-900 mb-1.5">{t("printer.mode")}</p>
        <div className="space-y-2">
          {(["thermal", "system"] as const).map((m) => {
            const disabled = m === "thermal" && !desktop;
            return (
              <button
                key={m}
                type="button"
                disabled={disabled}
                onClick={() => setMode(m)}
                className={clsx(
                  "w-full text-left px-3.5 py-3 rounded-xl border-2 transition-colors",
                  effectiveMode === m ? "border-brand-500 bg-brand-50" : "border-gray-200 hover:border-gray-300",
                  disabled && "opacity-50 cursor-not-allowed hover:border-gray-200"
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={clsx(
                      "w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0",
                      effectiveMode === m ? "border-brand-500" : "border-gray-300"
                    )}
                  >
                    {effectiveMode === m && <span className="w-2 h-2 rounded-full bg-brand-500" />}
                  </span>
                  <span className={clsx("text-sm font-semibold", effectiveMode === m ? "text-brand-700" : "text-gray-900")}>
                    {t(m === "thermal" ? "printer.modeThermal" : "printer.modeSystem")}
                  </span>
                </span>
                <span className="block text-[11px] text-gray-500 mt-1 pl-6">
                  {m === "thermal" ? (desktop ? t("printer.modeThermalHint") : t("printer.desktopOnly")) : t("settings.printerHint")}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {effectiveMode === "thermal" && (
        <>
          {/* The printer in use */}
          <div className="rounded-xl border border-gray-200 p-3.5">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1">{t("printer.current")}</p>
            {target ? (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{targetName || describeTarget(target)}</p>
                  <p className="text-[11px] text-gray-500 break-all">{describeTarget(target)}</p>
                  {target.kind === "system" && <p className="text-[11px] text-amber-600 mt-0.5">{t("printer.viaQueue")}</p>}
                  {lastResult && (
                    <p
                      className={clsx(
                        "text-[11px] font-semibold mt-1",
                        lastResult.result === "printed" ? "text-green-600" : lastResult.result === "sent" ? "text-amber-600" : "text-red-500"
                      )}
                    >
                      {t("printer.lastResult", {
                        result:
                          lastResult.result === "failed" && lastResult.failure
                            ? `${t("printer.result.failed")} (${t(failureKey(lastResult.failure))})`
                            : t(`printer.result.${lastResult.result}` as TKey),
                        when: new Date(lastResult.at).toLocaleString(locale),
                      })}
                    </p>
                  )}
                  {currentId && checks[currentId] && (
                    <div className="mt-1.5">
                      <StatusChip state={checks[currentId]} />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => check(currentId!, target)}
                  disabled={currentId ? checks[currentId]?.checking : false}
                  className="flex-shrink-0 text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-gray-200 text-gray-600 hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
                >
                  {t("printer.check")}
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-500">{t("printer.none")}</p>
            )}
          </div>

          {/* Search */}
          <div>
            <button
              type="button"
              onClick={search}
              disabled={searching}
              className="w-full flex items-center justify-center gap-2 font-semibold text-sm rounded-xl py-2.5 bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-70"
            >
              {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              {searching ? t("printer.searching") : found ? t("printer.searchAgain") : t("printer.search")}
            </button>

            {progress && (
              <ul className="mt-2.5 space-y-1">
                {PARTS.map(({ part, label }) => {
                  const state = progress[part];
                  const count = (found ?? []).filter((f) =>
                    part === "network" ? f.target.kind === "network" : part === "system" ? f.target.kind === "system" : f.target.kind === "serial" || f.target.kind === "usbDevice"
                  ).length;
                  return (
                    <li key={part} className="flex items-center gap-2 text-[11px] text-gray-500">
                      {state === "searching" ? (
                        <Loader2 size={11} className="animate-spin text-brand-500" />
                      ) : state === "done" ? (
                        <Check size={11} className="text-green-600" />
                      ) : (
                        <XCircle size={11} className="text-red-500" />
                      )}
                      <span>{t(label)}</span>
                      {state === "done" && <span className="text-gray-400">· {t("printer.part.found", { n: count })}</span>}
                      {state === "failed" && <span className="text-red-500">· {t("printer.part.failed")}</span>}
                    </li>
                  );
                })}
              </ul>
            )}

            {found && !searching && found.length === 0 && (
              <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2.5">{t("printer.noneFound")}</p>
            )}

            {found && found.length > 0 && (
              <div className="mt-3 space-y-3">
                {GROUPS.map(({ group, label, icon: Icon }) => {
                  const items = found.filter((f) => f.group === group);
                  if (items.length === 0) return null;
                  return (
                    <div key={group}>
                      <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-1.5">
                        <Icon size={12} /> {t(label)}
                      </p>
                      <ul className="space-y-1.5">
                        {items.map((f) => {
                          const inUse = f.id === currentId;
                          return (
                            <li
                              key={f.id}
                              className={clsx("rounded-xl border px-3 py-2.5", inUse ? "border-brand-300 bg-brand-50/50" : "border-gray-200")}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-gray-900 truncate">{f.name}</p>
                                  <p className="text-[11px] text-gray-500 break-all">{f.address}</p>
                                  {f.oneWay && <p className="text-[11px] text-amber-600">{t("printer.viaQueue")}</p>}
                                  {f.noAccess && <p className="text-[11px] text-red-500">{t("printer.noAccess")}</p>}
                                  {checks[f.id] && (
                                    <div className="mt-1">
                                      <StatusChip state={checks[f.id]} />
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-shrink-0 gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => check(f.id, f.target)}
                                    disabled={checks[f.id]?.checking}
                                    className="text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-gray-200 text-gray-600 hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
                                  >
                                    {t("printer.check")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => chooseTarget(f.target, f.name)}
                                    disabled={inUse}
                                    className={clsx(
                                      "text-xs font-semibold rounded-lg px-2.5 py-1.5",
                                      inUse ? "bg-green-50 text-green-700" : "bg-gray-900 text-white hover:bg-gray-800"
                                    )}
                                  >
                                    {inUse ? t("printer.inUse") : t("printer.choose")}
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}

            {found && <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">{t("printer.bluetoothHint")}</p>}
          </div>

          {/* Manual IP address */}
          <div>
            <label className="block text-xs font-semibold text-gray-900 mb-1.5">{t("printer.manual")}</label>
            <div className="flex gap-2">
              <input
                value={ip}
                onChange={(e) => {
                  setIp(e.target.value);
                  setIpError(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && applyManualAddress()}
                inputMode="decimal"
                placeholder="192.168.1.100"
                className={clsx(
                  "flex-1 min-w-0 border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400",
                  ipError ? "border-red-300" : "border-gray-200"
                )}
              />
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
                inputMode="numeric"
                aria-label={t("printer.port")}
                title={t("printer.port")}
                className="w-20 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-400 tabular-nums"
              />
            </div>
            {ipError && <p className="text-[11px] text-red-500 mt-1">{t("printer.invalidAddress")}</p>}
            <p className="text-[11px] text-gray-400 mt-1">{t("printer.manualHint")}</p>
            <button
              type="button"
              onClick={applyManualAddress}
              disabled={!ip.trim()}
              className="mt-2 text-xs font-semibold rounded-xl px-3 py-2 border-2 border-gray-200 text-gray-600 hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
            >
              {t("printer.useAddress")}
            </button>
          </div>

          {/* Accents */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
            <div className="pr-4">
              <p className="text-sm font-semibold text-gray-900">{t("printer.accents")}</p>
              <p className="text-[11px] text-gray-400">{t("printer.accentsHint")}</p>
            </div>
            <ToggleSwitch checked={accents} onChange={setAccents} />
          </div>

          {settings.paperWidth === "A4" && (
            <p className="text-[11px] text-amber-700 bg-amber-50 rounded-xl px-3 py-2">{t("printer.a4Hint")}</p>
          )}
          <p className="text-[11px] text-gray-300">{t("printer.savedOnTill")}</p>
        </>
      )}
    </div>
  );
}
