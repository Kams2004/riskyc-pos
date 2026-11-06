"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Plus, X, Trash2, ImagePlus, Lock } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import * as productsApi from "@/lib/api/products";
import { variantKey } from "@/lib/stock";
import { Badge, BulkPriceTier, Category, MediaItem, Product, ProductColor } from "@/lib/types";
import { useT } from "@/lib/i18n";
import ToggleSwitch from "@/components/ToggleSwitch";

const SIZE_PRESETS = ["XS", "S", "M", "L", "XL", "XXL"];

interface PendingFile {
  file: File;
  previewUrl: string;
}

function Section({
  title,
  granted,
  hint,
  children,
}: {
  title: string;
  granted: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset disabled={!granted} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 sm:p-6 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-bold text-gray-900 uppercase tracking-wide">{title}</p>
          {hint && <p className="text-[11px] text-gray-600 mt-0.5">{hint}</p>}
        </div>
        {!granted && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded-full flex-shrink-0">
            <Lock size={10} /> <NoAccess />
          </span>
        )}
      </div>
      <div className={clsx(!granted && "opacity-60")}>{children}</div>
    </fieldset>
  );
}

const inputClass =
  "w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 disabled:bg-gray-50 disabled:text-gray-500";
const labelClass = "block text-xs font-semibold text-gray-900 mb-1.5";

/** One stock box: unlimited (never sells out), or a counted quantity ("" counts as 0). */
interface StockCell {
  unlimited: boolean;
  value: string;
}

/**
 * What the server holds for one (color, size), in the form's terms. A size with no stock row yet is unlimited while the
 * product counts no stock at all, and 0 once it does — the same rule as lib/stock.ts and the backend.
 */
function savedCell(product: Product | undefined, key: string): StockCell {
  const variant = (product?.variants ?? []).find((v) => variantKey(v.colorName, v.size) === key);
  if (variant) return variant.untracked ? { unlimited: true, value: "" } : { unlimited: false, value: String(variant.quantity) };
  const counted = (product?.variants ?? []).some((v) => !v.untracked);
  return { unlimited: !counted, value: "" };
}

function sameCell(a: StockCell, b: StockCell) {
  return a.unlimited === b.unlimited && (a.unlimited || Number(a.value || 0) === Number(b.value || 0));
}

function NoAccess() {
  const { t } = useT();
  return <>{t("pf.noAccess")}</>;
}

export default function ProductForm({ initial }: { initial?: Product }) {
  const router = useRouter();
  const { t } = useT();
  const session = usePosAuthStore((s) => s.session);
  const hasPermission = usePosAuthStore((s) => s.hasPermission);
  const isNew = !initial;
  const token = session?.token ?? "";

  // A new product's core fields all travel in the create call (CREATE_PRODUCT); images and stock
  // are separate requests on the backend, so they need their own permissions even when creating.
  const canCreate = hasPermission("CREATE_PRODUCT");
  const canInfo = isNew ? canCreate : hasPermission("UPDATE_PRODUCT_INFO");
  const canPricing = isNew ? canCreate : hasPermission("UPDATE_PRODUCT_PRICING");
  const canColors = isNew ? canCreate : hasPermission("UPDATE_PRODUCT_COLORS");
  const canDisplay = isNew ? canCreate : hasPermission("UPDATE_PRODUCT_DISPLAY");
  const canVisibility = isNew ? canCreate : hasPermission("UPDATE_PRODUCT_VISIBILITY");
  const canImages = hasPermission("UPDATE_PRODUCT_IMAGES");
  const canStock = hasPermission("UPDATE_PRODUCT_STOCK");

  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categorySlug, setCategorySlug] = useState(initial?.categorySlug ?? "");
  const [subcategorySlug, setSubcategorySlug] = useState(initial?.subcategorySlug ?? "");
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  const [originalPrice, setOriginalPrice] = useState(initial?.originalPrice ? String(initial.originalPrice) : "");
  const [bulkPrices, setBulkPrices] = useState<BulkPriceTier[]>(initial?.bulkPrices ?? []);
  const [colors, setColors] = useState<ProductColor[]>(initial?.colors ?? []);
  const [sizes, setSizes] = useState<string[]>(initial?.sizes ?? []);
  const [sizeInput, setSizeInput] = useState("");
  const [badge, setBadge] = useState<Badge | "">(initial?.badge ?? "");
  const [hidden, setHidden] = useState(initial?.hidden ?? false);
  // Only boxes the user touched are kept here; every other box shows what the server has (savedCell).
  const [stockEdits, setStockEdits] = useState<Record<string, StockCell>>({});
  const [existingMedia, setExistingMedia] = useState<MediaItem[]>(initial?.media ?? []);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    productsApi
      .listCategories()
      .then((all) => {
        const allowed = session?.enterpriseId ? all.filter((c) => session.enterpriseCategoryIds.includes(c.id)) : all;
        setCategories(allowed);
        if (isNew && allowed.length > 0) {
          setCategorySlug((cur) => cur || allowed[0].slug);
          setSubcategorySlug((cur) => cur || allowed[0].subcategories[0]?.slug || "");
        }
      })
      .catch(() => setError(t("pf.categoriesFailed")));
  }, [session?.enterpriseId, session?.enterpriseCategoryIds, isNew]);

  const pendingRef = useRef(pendingFiles);
  pendingRef.current = pendingFiles;
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  const category = categories.find((c) => c.slug === categorySlug);
  const colorNames = colors.length > 0 ? colors.map((c) => c.name) : [""];
  const sizeNames = sizes.length > 0 ? sizes : [""];
  const stockCells = colorNames.flatMap((c) => sizeNames.map((s) => ({ color: c, size: s, key: variantKey(c, s) })));
  const cellFor = (key: string): StockCell => stockEdits[key] ?? savedCell(initial, key);
  const setCell = (key: string, cell: StockCell) => setStockEdits((prev) => ({ ...prev, [key]: cell }));
  const allUnlimited = stockCells.every(({ key }) => cellFor(key).unlimited);

  const addSize = (raw: string) => {
    const value = raw.trim().toUpperCase();
    if (value && !sizes.includes(value)) setSizes((prev) => [...prev, value]);
    setSizeInput("");
  };

  const handleFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setPendingFiles((prev) => [...prev, ...files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))]);
  };

  const removeExistingMedia = async (media: MediaItem) => {
    if (!window.confirm(t("pf.deletePhotoConfirm"))) return;
    try {
      await productsApi.deleteMedia(media.id, token);
      setExistingMedia((prev) => prev.filter((m) => m.id !== media.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pf.deletePhotoFailed"));
    }
  };

  const validate = (): string | null => {
    if (!name.trim()) return t("pf.errName");
    if (!categorySlug) return t("pf.errCategory");
    const priceNum = Number(price);
    if (price === "" || Number.isNaN(priceNum) || priceNum < 0) return t("pf.errPrice");
    if (originalPrice && (Number.isNaN(Number(originalPrice)) || Number(originalPrice) < 0)) return t("pf.errOriginalPrice");
    if (colors.some((c) => !c.name.trim())) return t("pf.errColorName");
    if (new Set(colors.map((c) => c.name.trim().toLowerCase())).size !== colors.length) return t("pf.errColorDup");
    if (bulkPrices.some((tier) => tier.quantity <= 1 || tier.price <= 0)) return t("pf.errBulk");
    if (isNew && canImages && pendingFiles.length === 0) return t("pf.errPhoto");
    if (Object.values(stockEdits).some((c) => !c.unlimited && c.value !== "" && !/^\d+$/.test(c.value))) return t("pf.errStock");
    return null;
  };

  /**
   * Only the boxes whose state differs from what the server has are sent, each as unlimited (untracked) or a count.
   * Untouched sizes are never re-sent, so an unlimited size can't silently turn into "0 left". For a new product the
   * server starts with nothing: all-unlimited needs no request, and as soon as one size is counted every size is sent
   * explicitly (otherwise the server would treat the unsent ones as 0).
   */
  const stockEntries = (original?: Product): productsApi.StockEntry[] => {
    const toEntry = ({ color, size, key }: (typeof stockCells)[number]): productsApi.StockEntry => {
      const cell = cellFor(key);
      return cell.unlimited
        ? { colorName: color, size, quantity: 0, untracked: true }
        : { colorName: color, size, quantity: Number(cell.value || 0), untracked: false };
    };
    if (!original) return allUnlimited ? [] : stockCells.map(toEntry);
    return stockCells.filter(({ key }) => !sameCell(cellFor(key), savedCell(original, key))).map(toEntry);
  };

  const handleSave = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    const sortedTiers = [...bulkPrices].sort((a, b) => a.quantity - b.quantity);
    const priceNum = Number(price);
    const originalNum = originalPrice ? Number(originalPrice) : undefined;
    try {
      if (isNew) {
        const product = await productsApi.createProduct(
          {
            name: name.trim(),
            description: description.trim() || undefined,
            price: priceNum,
            originalPrice: originalNum,
            categorySlug,
            subcategorySlug: subcategorySlug || undefined,
            sizes,
            tags: [],
            badge: badge || undefined,
            hidden,
            colors: colors.map((c) => ({ name: c.name.trim(), hex: c.hex })),
            bulkPrices: sortedTiers,
          },
          token
        );
        if (canImages) {
          for (const pf of pendingFiles) await productsApi.uploadProductMedia(product.id, pf.file, token);
        }
        const entries = canStock ? stockEntries() : [];
        if (entries.length > 0) await productsApi.updateProductStock(product.id, entries, token);
      } else {
        const p = initial!;
        const calls: Promise<unknown>[] = [];
        if (
          canInfo &&
          (name.trim() !== p.name ||
            description.trim() !== (p.description ?? "") ||
            categorySlug !== p.categorySlug ||
            (subcategorySlug || "") !== (p.subcategorySlug ?? ""))
        ) {
          calls.push(
            productsApi.updateProductInfo(
              p.id,
              { name: name.trim(), description: description.trim() || undefined, categorySlug, subcategorySlug: subcategorySlug || undefined },
              token
            )
          );
        }
        const initialTiers = [...(p.bulkPrices ?? [])].sort((a, b) => a.quantity - b.quantity);
        if (
          canPricing &&
          (priceNum !== p.price || (originalNum ?? null) !== (p.originalPrice ?? null) || JSON.stringify(sortedTiers) !== JSON.stringify(initialTiers))
        ) {
          calls.push(productsApi.updateProductPricing(p.id, { price: priceNum, originalPrice: originalNum, bulkPrices: sortedTiers }, token));
        }
        if (canDisplay && ((badge || null) !== (p.badge ?? null) || JSON.stringify(sizes) !== JSON.stringify(p.sizes))) {
          calls.push(productsApi.updateProductDisplay(p.id, { badge: badge || undefined, sizes }, token));
        }
        if (canVisibility && hidden !== p.hidden) {
          calls.push(productsApi.setProductVisibility(p.id, hidden, token));
        }
        await Promise.all(calls);

        // Colors before stock: stock rows are keyed by color name, so a renamed/added color must exist first.
        const colorIdentity = (list: ProductColor[]) => JSON.stringify(list.map((c) => ({ id: c.id, name: c.name.trim(), hex: c.hex })));
        if (canColors && colorIdentity(colors) !== colorIdentity(p.colors)) {
          await productsApi.updateProductColors(p.id, colors.map((c) => ({ id: c.id, name: c.name.trim(), hex: c.hex })), token);
        }
        const changedStock = canStock ? stockEntries(p) : [];
        if (changedStock.length > 0) await productsApi.updateProductStock(p.id, changedStock, token);

        if (canImages) {
          for (const pf of pendingFiles) await productsApi.uploadProductMedia(p.id, pf.file, token);
        }
      }
      setSaved(true);
      setTimeout(() => router.push("/products"), 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("pf.saveFailed"));
      setSaving(false);
    }
  };

  const nothingEditable = !canInfo && !canPricing && !canColors && !canDisplay && !canVisibility && !canImages && !canStock;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <Section title={t("pf.basic")} granted={canInfo}>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>{t("pf.name")}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder={t("pf.namePlaceholder")} />
              </div>
              <div>
                <label className={labelClass}>{t("pf.description")}</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className={clsx(inputClass, "resize-none")}
                  placeholder={t("pf.descriptionPlaceholder")}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>{t("pf.category")}</label>
                  <select
                    value={categorySlug}
                    onChange={(e) => {
                      const next = categories.find((c) => c.slug === e.target.value);
                      setCategorySlug(e.target.value);
                      setSubcategorySlug(next?.subcategories[0]?.slug ?? "");
                    }}
                    className={inputClass}
                  >
                    {!categories.some((c) => c.slug === categorySlug) && categorySlug && <option value={categorySlug}>{categorySlug}</option>}
                    {categories.map((c) => (
                      <option key={c.id} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>{t("pf.subcategory")}</label>
                  <select value={subcategorySlug} onChange={(e) => setSubcategorySlug(e.target.value)} className={inputClass}>
                    <option value="">{t("pf.none")}</option>
                    {(category?.subcategories ?? []).map((s) => (
                      <option key={s.id} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </Section>

          <Section title={t("pf.pricing")} granted={canPricing}>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>{t("pf.price")}</label>
                  <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} placeholder="0" />
                </div>
                <div>
                  <label className={labelClass}>{t("pf.originalPrice")}</label>
                  <input
                    inputMode="numeric"
                    value={originalPrice}
                    onChange={(e) => setOriginalPrice(e.target.value)}
                    className={inputClass}
                    placeholder={t("pf.originalPricePlaceholder")}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>{t("pf.bulkPrices")}</label>
                <div className="space-y-2">
                  {bulkPrices.map((tier, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        inputMode="numeric"
                        value={tier.quantity || ""}
                        onChange={(e) => setBulkPrices((prev) => prev.map((t, idx) => (idx === i ? { ...t, quantity: Number(e.target.value) || 0 } : t)))}
                        className={clsx(inputClass, "w-28")}
                        placeholder={t("pf.qty")}
                      />
                      <span className="text-xs text-gray-400">{t("pf.for")}</span>
                      <input
                        inputMode="numeric"
                        value={tier.price || ""}
                        onChange={(e) => setBulkPrices((prev) => prev.map((t, idx) => (idx === i ? { ...t, price: Number(e.target.value) || 0 } : t)))}
                        className={inputClass}
                        placeholder={t("pf.totalPrice")}
                      />
                      <button
                        type="button"
                        onClick={() => setBulkPrices((prev) => prev.filter((_, idx) => idx !== i))}
                        className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 flex-shrink-0"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBulkPrices((prev) => [...prev, { quantity: 0, price: 0 }])}
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
                  >
                    <Plus size={13} /> {t("pf.addBulk")}
                  </button>
                </div>
              </div>
            </div>
          </Section>

          <Section title={t("pf.colors")} granted={canColors} hint={t("pf.colorsHint")}>
            <div className="space-y-2">
              {colors.map((c, i) => (
                <div key={c.id ?? `new-${i}`} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={c.hex}
                    onChange={(e) => setColors((prev) => prev.map((col, idx) => (idx === i ? { ...col, hex: e.target.value } : col)))}
                    className="w-11 h-11 rounded-xl border border-gray-200 cursor-pointer flex-shrink-0 p-1 bg-white"
                  />
                  <input
                    value={c.name}
                    onChange={(e) => setColors((prev) => prev.map((col, idx) => (idx === i ? { ...col, name: e.target.value } : col)))}
                    className={inputClass}
                    placeholder={t("pf.colorPlaceholder")}
                  />
                  <button
                    type="button"
                    onClick={() => setColors((prev) => prev.filter((_, idx) => idx !== i))}
                    className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 flex-shrink-0"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setColors((prev) => [...prev, { name: "", hex: "#888888" }])}
                className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                <Plus size={13} /> {t("pf.addColor")}
              </button>
            </div>
          </Section>

          <Section title={t("pf.sizesBadge")} granted={canDisplay} hint={t("pf.sizesHint")}>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>{t("pf.sizes")}</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {sizes.map((s) => (
                    <span key={s} className="flex items-center gap-1 text-xs font-semibold bg-gray-100 text-gray-700 pl-2.5 pr-1 py-1 rounded-lg">
                      {s}
                      <button type="button" onClick={() => setSizes((prev) => prev.filter((x) => x !== s))} className="p-0.5 rounded hover:bg-gray-200">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={sizeInput}
                    onChange={(e) => setSizeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addSize(sizeInput);
                      }
                    }}
                    className={inputClass}
                    placeholder={t("pf.sizePlaceholder")}
                  />
                  <button type="button" onClick={() => addSize(sizeInput)} className="px-3 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">
                    <Plus size={15} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {SIZE_PRESETS.filter((s) => !sizes.includes(s)).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => addSize(s)}
                      className="text-[11px] font-semibold text-gray-500 border border-dashed border-gray-300 px-2 py-0.5 rounded-md hover:border-brand-300 hover:text-brand-600"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>{t("pf.badge")}</label>
                <div className="flex gap-2">
                  {(["", "NEW", "SALE", "HOT"] as const).map((b) => (
                    <button
                      key={b || "none"}
                      type="button"
                      onClick={() => setBadge(b)}
                      className={clsx(
                        "flex-1 px-3 py-2 rounded-xl border-2 text-xs font-semibold",
                        badge === b ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-200 text-gray-600"
                      )}
                    >
                      {b || t("pf.none")}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </div>

        <div className="space-y-6 min-w-0">
          <Section title={t("pf.photos")} granted={canImages}>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {existingMedia
                .filter((m) => m.type === "IMAGE")
                .map((m) => (
                  <div key={m.id} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.presignedUrl} alt="" className="w-full h-full object-cover" />
                    {canImages && (
                      <button
                        type="button"
                        onClick={() => removeExistingMedia(m)}
                        className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              {pendingFiles.map((pf, i) => (
                <div key={pf.previewUrl} className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 ring-2 ring-brand-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pf.previewUrl} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-black/60 text-white"
                  >
                    <X size={12} />
                  </button>
                  <span className="absolute bottom-1.5 left-1.5 text-[9px] font-bold bg-brand-500 text-white px-1.5 py-0.5 rounded">{t("pf.new")}</span>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-brand-300 hover:text-brand-500 transition-colors"
              >
                <ImagePlus size={20} />
                <span className="text-[11px] font-semibold">{t("pf.addPhotos")}</span>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFilesPicked} />
            </div>
          </Section>

          <Section
            title={t("pf.stock")}
            granted={canStock}
            hint={allUnlimited ? t("pf.stockHintAll") : t("pf.stockHint")}
          >
            <div className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3.5 py-2.5 mb-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{t("pf.unlimitedStock")}</p>
                <p className="text-[11px] text-gray-500">{t("pf.unlimitedStockHint")}</p>
              </div>
              <ToggleSwitch
                checked={allUnlimited}
                disabled={!canStock}
                onChange={(unlimited) =>
                  // On: every size unlimited. Off: every size counted, starting at 0 so the boxes can be filled in.
                  setStockEdits(Object.fromEntries(stockCells.map(({ key }) => [key, { unlimited, value: unlimited ? "" : "0" }])))
                }
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] font-bold uppercase tracking-wide text-gray-900">
                    <th className="text-left pb-2 pr-3">{colors.length > 0 ? t("pf.color") : ""}</th>
                    {sizeNames.map((s) => (
                      <th key={s || "one"} className="pb-2 px-1 text-center min-w-[116px]">
                        {s || t("pf.quantity")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {colorNames.map((c) => (
                    <tr key={c || "one"} className="border-t border-gray-100">
                      <td className="py-2 pr-3 text-xs font-semibold text-gray-700 whitespace-nowrap">
                        {c ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-full ring-1 ring-gray-200" style={{ backgroundColor: colors.find((x) => x.name === c)?.hex }} />
                            {c}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                      {sizeNames.map((s) => {
                        const key = variantKey(c, s);
                        return (
                          <td key={key} className="py-2 px-1">
                            <div className="flex items-center gap-1">
                              <input
                                inputMode="numeric"
                                aria-label={t("pf.stockAria", { what: [c, s].filter(Boolean).join(" ") || t("pf.quantityLower") })}
                                value={cellFor(key).unlimited ? "" : cellFor(key).value}
                                // Typing a number makes this size counted.
                                onChange={(e) => setCell(key, { unlimited: false, value: e.target.value.replace(/[^\d]/g, "") })}
                                placeholder={cellFor(key).unlimited ? "∞" : "0"}
                                className="w-full min-w-0 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center tabular-nums outline-none focus:border-brand-400 disabled:bg-gray-50"
                              />
                              <button
                                type="button"
                                title={cellFor(key).unlimited ? t("pf.unlimitedTapToCount") : t("pf.makeUnlimited")}
                                aria-pressed={cellFor(key).unlimited}
                                onClick={() =>
                                  setCell(key, cellFor(key).unlimited ? { unlimited: false, value: "0" } : { unlimited: true, value: "" })
                                }
                                className={clsx(
                                  "flex-shrink-0 w-7 h-7 rounded-lg text-sm font-bold",
                                  cellFor(key).unlimited ? "bg-brand-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                )}
                              >
                                ∞
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {colors.some((c) => !c.name.trim()) && <p className="text-[11px] text-amber-600 mt-2">{t("pf.nameColors")}</p>}
          </Section>

          <Section title={t("pf.visibility")} granted={canVisibility}>
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <p className="text-sm font-semibold text-gray-900">{t("pf.visible")}</p>
                <p className="text-[11px] text-gray-400">{t("pf.visibleHint")}</p>
              </div>
              <ToggleSwitch checked={!hidden} disabled={!canVisibility} onChange={(v) => setHidden(!v)} />
            </div>
          </Section>
        </div>
      </div>

      <div className="sticky bottom-0 bg-gray-100/95 backdrop-blur-sm -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-4 border-t border-gray-200 flex flex-wrap items-center gap-3">
        {error && <div className="w-full text-sm text-red-600 bg-red-50 rounded-xl px-3.5 py-2.5">{error}</div>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || saved || nothingEditable}
          className={clsx(
            "w-full sm:w-auto sm:min-w-[240px] flex items-center justify-center gap-2 font-semibold text-sm rounded-xl py-3 px-8 transition-colors",
            saved ? "bg-green-500 text-white" : "bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-60"
          )}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null}
          {saving ? t("pf.saving") : saved ? t("pf.saved") : isNew ? t("pf.create") : t("pf.save")}
        </button>
        <button
          type="button"
          onClick={() => router.push("/products")}
          className="px-5 py-3 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-200"
        >
          {t("pf.cancel")}
        </button>
      </div>
    </div>
  );
}
