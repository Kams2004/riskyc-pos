"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, MonitorSmartphone, Ban, Copy, Check } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { createEnrollmentCode, listDevices, revokeDevice, PosDevice } from "@/lib/api/pos";

function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Tills = installed POS desktop apps. Lets an admin add one (one-time code), watch its status, and revoke it. */
export default function TillsCard() {
  const token = usePosAuthStore((s) => s.session?.token ?? "");
  const [devices, setDevices] = useState<PosDevice[] | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    if (!token) return;
    listDevices(token)
      .then(setDevices)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the tills."));
  }, [token]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const handleAdd = async () => {
    setCreating(true);
    setError("");
    try {
      setCode(await createEnrollmentCode(token));
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create a code.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (device: PosDevice) => {
    if (!window.confirm(`Revoke "${device.name}"? It stops syncing immediately and must be set up again with a new code.`)) return;
    try {
      await revokeDevice(token, device.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't revoke that till.");
    }
  };

  const secondsLeft = code ? Math.max(0, Math.round((new Date(code.expiresAt).getTime() - now) / 1000)) : 0;
  const active = (devices ?? []).filter((d) => !d.revokedAt);
  const revoked = (devices ?? []).filter((d) => d.revokedAt);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-bold text-gray-900 uppercase tracking-wide">Caisses — tills</p>
          <p className="text-[11px] text-gray-600 mt-0.5">
            Computers running the Riskyc POS app. They keep selling offline and sync their sales when the connection returns.
          </p>
        </div>
        <button
          onClick={handleAdd}
          disabled={creating}
          className="flex items-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-60"
        >
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add a till
        </button>
      </div>

      {code && secondsLeft > 0 && (
        <div className="mb-5 rounded-xl border-2 border-dashed border-brand-300 bg-brand-50 p-4 flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm font-semibold text-gray-900">Enter this code in the POS app on the new computer</p>
            <p className="text-[11px] text-gray-600 mt-0.5">
              Works once, expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xl font-bold tracking-widest text-gray-900 bg-white border border-gray-300 rounded-xl px-4 py-2">
              {code.code}
            </span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(code.code).then(() => setCopied(true)).catch(() => {});
              }}
              title="Copy code"
              className="p-2.5 rounded-xl bg-white border border-gray-300 text-gray-900 hover:bg-gray-50"
            >
              {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
            </button>
          </div>
        </div>
      )}

      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-xl px-3.5 py-2.5">{error}</div>}

      {devices === null ? (
        <div className="flex justify-center py-6 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : active.length === 0 && revoked.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No tills yet. Use “Add a till” to set up the POS app on a computer.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {[...active, ...revoked].map((d) => (
            <div key={d.id} className={clsx("flex flex-wrap items-center gap-3 py-3", d.revokedAt && "opacity-50")}>
              <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-700 flex items-center justify-center flex-shrink-0">
                <MonitorSmartphone size={18} />
              </div>
              <div className="flex-1 min-w-[180px]">
                <p className="text-sm font-semibold text-gray-900">{d.name}</p>
                <p className="text-[11px] text-gray-500">
                  {[d.platform, d.appVersion && `v${d.appVersion}`, `added ${timeAgo(d.enrolledAt)}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              {d.revokedAt ? (
                <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-gray-100 text-gray-500">Revoked</span>
              ) : (
                <>
                  <span
                    className={clsx(
                      "flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full",
                      d.online ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                    )}
                  >
                    <span className={clsx("w-1.5 h-1.5 rounded-full", d.online ? "bg-green-500" : "bg-red-500")} />
                    {d.online ? "Online" : `Offline · seen ${timeAgo(d.lastSeenAt)}`}
                  </span>
                  {d.pendingSales > 0 && (
                    <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700">
                      {d.pendingSales} sale{d.pendingSales !== 1 ? "s" : ""} to sync
                    </span>
                  )}
                  <button
                    onClick={() => handleRevoke(d)}
                    className="flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg"
                  >
                    <Ban size={13} /> Revoke
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
