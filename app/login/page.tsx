"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { User, Lock, Eye, EyeOff, Loader2, CreditCard, Store, Printer } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { useLangStore, useT } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const login = usePosAuthStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { t, lang } = useT();
  const setLang = useLangStore((s) => s.setLang);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await login(email, password);
    if (result.ok) {
      router.replace("/");
    } else {
      setError(result.error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center px-4 py-10 overflow-hidden bg-gray-950">
      {/* The till's own counter — printer, scanner, the boutique floor behind it. */}
      <Image
        src="/login-background.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/70 to-gray-950/30" />
      <div className="absolute inset-0 bg-brand-900/10" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-lg shadow-brand-900/50 mb-3">
            <span className="text-white font-bold text-xl font-display">RF</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-white">Riskyc Fashion</h1>
          <span className="mt-2.5 flex items-center gap-1.5 text-[11px] font-bold text-white bg-gradient-to-r from-brand-500 to-brand-700 px-3 py-1 rounded-full uppercase tracking-wide shadow-sm">
            <CreditCard size={11} /> {t("login.pointOfSale")}
          </span>
        </div>

        <div className="flex items-center justify-center gap-3 mb-5">
          <p className="text-gray-300 text-sm font-medium">{t("login.title")}</p>
          <div className="flex items-center rounded-full bg-white/10 p-0.5 text-[11px] font-bold">
            {(["fr", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={clsx("px-2 py-0.5 rounded-full uppercase", lang === l ? "bg-white text-gray-900" : "text-gray-300 hover:text-white")}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t("login.username")}</label>
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
                placeholder="you@riskyc.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{t("login.password")}</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-xl pl-10 pr-10 py-2.5 text-sm outline-none focus:border-brand-400"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3.5 py-2.5">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className={clsx(
              "w-full flex items-center justify-center gap-2 font-semibold text-sm rounded-xl py-3 transition-all shadow-md",
              "bg-gradient-to-r from-brand-500 to-brand-700 hover:from-brand-600 hover:to-brand-800 text-white disabled:opacity-60"
            )}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {loading ? t("login.signingIn") : t("login.signIn")}
          </button>
        </form>

        {/* Footer badge */}
        <div className="mt-4 flex items-center gap-3 bg-white/10 backdrop-blur border border-white/10 rounded-2xl px-4 py-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
            <Store size={16} className="text-brand-300" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">{t("login.registerTitle")}</p>
            <p className="text-[11px] text-gray-300 flex items-center gap-1 mt-0.5">
              <Printer size={10} /> {t("login.registerFeatures")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
