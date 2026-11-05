"use client";

import { useEffect, useState } from "react";
import { Loader2, MonitorSmartphone } from "lucide-react";
import { API_BASE_URL } from "@/lib/apiClient";
import { desktop, isDesktop, TillDevice } from "@/lib/desktop";
import { useTillStore } from "@/lib/tillStore";
import { usePosAuthStore } from "@/lib/authStore";
import { useOfflineSalesStore } from "@/lib/offlineSales";
import { loadSavedPhotos, syncPhotoCache } from "@/lib/photoCache";
import { PosCatalog } from "@/lib/types";

const HEARTBEAT_MS = 15_000;
const CATALOG_SYNC_MS = 60_000;
/** While sales are waiting, retry the upload this often (on top of every successful check-in). */
const SALES_SYNC_MS = 30_000;

function deviceFetch(device: TillDevice, path: string, init: RequestInit = {}) {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Device-Token": device.deviceToken, ...(init.headers ?? {}) },
  });
}

/** Keeps the till checked in, uploads sales made offline, and keeps its offline copy of the catalog, photos and ticket settings fresh. */
function useTillSync(device: TillDevice | null, onRevoked: () => void) {
  const setOnline = useTillStore((s) => s.setOnline);
  const setCatalogSynced = useTillStore((s) => s.setCatalogSynced);

  useEffect(() => {
    if (!device) return;
    let cancelled = false;
    let appVersion: string | undefined;

    const syncCatalog = async () => {
      try {
        const etag = await desktop.cacheGet<string>("catalogEtag");
        const res = await deviceFetch(device, "/api/pos/device/catalog", { headers: etag ? { "If-None-Match": etag } : {} });
        if (res.status === 200) {
          await desktop.cacheSet("catalog", await res.json());
          const newEtag = res.headers.get("ETag");
          if (newEtag) await desktop.cacheSet("catalogEtag", newEtag);
        }
        if (res.status === 200 || res.status === 304) {
          const settings = await deviceFetch(device, "/api/pos/device/settings");
          if (settings.ok) await desktop.cacheSet("settings", await settings.json());
          if (!cancelled) setCatalogSynced();
        }
        const catalog = await desktop.cacheGet<PosCatalog>("catalog");
        if (catalog && !cancelled) syncPhotoCache(catalog.products).catch(() => {});
      } catch {
        // Offline — the cached copy stays in use.
      }
    };

    const heartbeat = async () => {
      try {
        const res = await deviceFetch(device, "/api/pos/device/heartbeat", {
          method: "POST",
          body: JSON.stringify({
            appVersion: appVersion || undefined,
            pendingSales: useOfflineSalesStore.getState().sales.filter((s) => s.status === "PENDING").length,
          }),
        });
        if (cancelled) return;
        if (res.status === 401) {
          onRevoked();
          return;
        }
        setOnline(res.ok);
        // Reachable again: upload anything sold while offline before the catalog is refreshed, so the
        // refreshed stock already includes those sales.
        if (res.ok) await useOfflineSalesStore.getState().syncNow();
      } catch {
        if (!cancelled) setOnline(false);
      }
    };

    // Photos already saved on the till go on screen straight away — no network needed.
    loadSavedPhotos().catch(() => {});
    // Read the app's version first so even the first check-in reports it to the Tills card, and load the queue of
    // unsynced sales so the first check-in can already upload it. Each failing on its own doesn't affect the other.
    Promise.all([
      desktop.appVersion().catch(() => undefined),
      useOfflineSalesStore.getState().load().catch(() => {}),
    ])
      .then(([v]) => {
        appVersion = v;
        return heartbeat();
      })
      .then(syncCatalog);
    const beat = setInterval(heartbeat, HEARTBEAT_MS);
    const sync = setInterval(syncCatalog, CATALOG_SYNC_MS);
    const salesSync = setInterval(() => useOfflineSalesStore.getState().syncNow(), SALES_SYNC_MS);
    return () => {
      cancelled = true;
      clearInterval(beat);
      clearInterval(sync);
      clearInterval(salesSync);
    };
  }, [device, onRevoked, setOnline, setCatalogSynced]);
}

function EnrollScreen({ notice, onEnrolled }: { notice: string; onEnrolled: (device: TillDevice) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("Caisse 1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const appVersion = await desktop.appVersion().catch(() => "");
      const platform = navigator.userAgent.includes("Windows") ? "windows" : navigator.userAgent.includes("Mac") ? "macos" : "linux";
      const res = await fetch(`${API_BASE_URL}/api/pos/devices/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), name: name.trim(), platform, appVersion }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message || "That code didn't work. Ask an admin for a new one.");
        return;
      }
      const device: TillDevice = {
        deviceId: body.deviceId,
        deviceToken: body.deviceToken,
        enterpriseId: body.enterpriseId ?? null,
        storeName: body.storeName,
        name: name.trim(),
        enrolledAt: new Date().toISOString(),
      };
      await desktop.saveDevice(device);
      onEnrolled(device);
    } catch {
      setError("Can't reach the server. Setting up a till needs an internet connection once.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden bg-gray-950">
      {/* Same shop-counter photo and overlays as the sign-in screen. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/login-background.png" alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/70 to-gray-950/30" />
      <div className="absolute inset-0 bg-brand-900/10" />
      <form onSubmit={submit} className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-brand-500 text-white flex items-center justify-center">
            <MonitorSmartphone size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Set up this till</h1>
            <p className="text-xs text-gray-500">Riskyc POS · one time only</p>
          </div>
        </div>
        {notice && <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">{notice}</div>}
        <p className="text-sm text-gray-600 leading-relaxed">
          An admin creates a code in the admin panel:{" "}
          <span className="font-semibold text-gray-900">Point de Vente → Settings → Add a till</span>. Enter it below to link this
          computer to the shop.
        </p>
        <div>
          <label className="block text-xs font-semibold text-gray-900 mb-1.5">Setup code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD-2345"
            autoFocus
            required
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-xl font-mono tracking-widest text-center outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-900 mb-1.5">Name for this till</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className="w-full border border-gray-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-500"
          />
        </div>
        {error && <div className="text-sm text-red-700 bg-red-50 rounded-xl px-3.5 py-2.5">{error}</div>}
        <button
          type="submit"
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl py-3 disabled:opacity-60"
        >
          {busy && <Loader2 size={16} className="animate-spin" />} Set up till
        </button>
      </form>
    </div>
  );
}

/**
 * Desktop app only: the till must be enrolled before anything else; once it is, it keeps checking in and keeps
 * an offline copy of the catalog. In the browser this renders the app unchanged.
 */
export default function DesktopGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<"browser" | "loading" | "enroll" | "ready">("loading");
  const [notice, setNotice] = useState("");
  const device = useTillStore((s) => s.device);
  const setDevice = useTillStore((s) => s.setDevice);
  const logout = usePosAuthStore((s) => s.logout);

  useEffect(() => {
    if (!isDesktop()) {
      setPhase("browser");
      return;
    }
    desktop
      .getDevice()
      .then((d) => {
        setDevice(d);
        setPhase(d ? "ready" : "enroll");
      })
      .catch(() => setPhase("enroll"));
  }, [setDevice]);

  const [onRevoked] = useState(() => async () => {
    await desktop.resetTill().catch(() => {});
    logout();
    setDevice(null);
    setNotice("This till was removed by an admin. Enter a new code to set it up again.");
    setPhase("enroll");
  });

  useTillSync(phase === "ready" ? device : null, onRevoked);

  if (phase === "browser" || phase === "ready") return <>{children}</>;
  if (phase === "enroll") {
    return (
      <EnrollScreen
        notice={notice}
        onEnrolled={(d) => {
          setDevice(d);
          setNotice("");
          setPhase("ready");
        }}
      />
    );
  }
  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <Loader2 size={24} className="animate-spin text-white/60" />
    </div>
  );
}
