"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  X,
  Check,
  Loader2,
  Banknote,
  Printer,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { ApiError } from "@/lib/apiClient";
import { usePosPreferencesStore } from "@/lib/posPreferencesStore";
import { getCatalog, createSale, getSettings, listSales, listOnlineSales } from "@/lib/api/pos";
import { allocateGroupedLineTotals } from "@/lib/pricing";
import { availableQuantity, isProductSoldOut, stockLevel } from "@/lib/stock";
import { CartLine, PosCatalog, PosPaymentMethod, PosSale, PosSettings, Product } from "@/lib/types";
import PrintArea from "@/components/PrintArea";
import { ReceiptData } from "@/components/Receipt";
import PosShell from "@/components/PosShell";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";
import { usePosCartStore } from "@/lib/cartStore";

const PAYMENT_METHODS: {
  value: PosPaymentMethod;
  label: string;
  /** Brand logo for the mobile-money buttons; cash keeps the banknote icon. */
  logo?: string;
  enabledKey: "cashEnabled" | "orangeMoneyEnabled" | "mobileMoneyEnabled";
  classes: string;
}[] = [
  { value: "CASH", label: "Cash", enabledKey: "cashEnabled", classes: "bg-green-500 hover:bg-green-600 text-white" },
  { value: "ORANGE_MONEY", label: "Orange Money", logo: "/orange-money.png", enabledKey: "orangeMoneyEnabled", classes: "bg-orange-500 hover:bg-orange-600 text-white" },
  { value: "MOBILE_MONEY", label: "MTN MoMo", logo: "/mtn-momo.png", enabledKey: "mobileMoneyEnabled", classes: "bg-amber-400 hover:bg-amber-500 text-gray-900" },
];

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

function cartLineKey(line: Pick<CartLine, "product" | "selectedColor" | "selectedSize">) {
  return `${line.product.id}::${line.selectedColor}::${line.selectedSize}`;
}

/**
 * Bulk-tier pricing is pooled across every cart line of the SAME product
 * (different color/size lines included) rather than priced per line in
 * isolation — mirrors the backend's PricingService.allocateGroupedLineTotals
 * exactly (same pattern as the main storefront's lib/store.ts), so the cart
 * total always matches what the sale will actually charge.
 */
function computeCartLineTotals(cart: CartLine[]): Map<string, number> {
  const byProduct = new Map<string, CartLine[]>();
  for (const line of cart) {
    const list = byProduct.get(line.product.id) ?? [];
    list.push(line);
    byProduct.set(line.product.id, list);
  }
  const totals = new Map<string, number>();
  for (const group of byProduct.values()) {
    const allocated = allocateGroupedLineTotals(
      group[0].product.price,
      group[0].product.bulkPrices,
      group.map((l) => l.quantity)
    );
    group.forEach((line, i) => totals.set(cartLineKey(line), allocated[i]));
  }
  return totals;
}

const STOCK_DOT = { high: "bg-green-500", low: "bg-amber-500", out: "bg-red-500" };

/** "10 for 10,000" style labels for a product's bulk prices, smallest quantity first. */
function bulkTierLabels(product: Product): string[] {
  return (product.bulkPrices ?? [])
    .filter((t) => t.quantity > 1 && t.price > 0)
    .sort((a, b) => a.quantity - b.quantity)
    .map((t) => `${t.quantity} for ${Math.round(t.price).toLocaleString("en-US")}`);
}

// Picks the first in-stock (color, size) combination for a product, so a
// tapped product can be added straight to the cart with no intermediate
// picker — the cashier then refines color/size/quantity on the cart line
// itself, with everything resolved before the sale is validated.
function defaultVariant(product: Product, cart: CartLine[]): { color: string; size: string } {
  const colors = product.colors.length > 0 ? product.colors.map((c) => c.name) : [""];
  const sizes = product.sizes.length > 0 ? product.sizes : [""];
  for (const c of colors) {
    for (const s of sizes) {
      const avail = availableQuantity(product, c, s);
      const inCart = cart
        .filter((l) => l.product.id === product.id && l.selectedColor === c && l.selectedSize === s)
        .reduce((n, l) => n + l.quantity, 0);
      if (!Number.isFinite(avail) || avail - inCart > 0) return { color: c, size: s };
    }
  }
  return { color: colors[0], size: sizes[0] };
}

// ── A cart line's color/size, shown inline as small swatches/chips right on
// the line — no popup, no separate screen. Changing one re-resolves against
// stock and merges into a matching line if the new combination is already
// in the cart. Quantity lives here too, via the same +/− stepper as before. ──
function CartLineRow({
  line,
  cart,
  lineTotal,
  onChangeVariant,
  onQtyChange,
  onRemove,
}: {
  line: CartLine;
  cart: CartLine[];
  lineTotal: number;
  onChangeVariant: (line: CartLine, color: string, size: string) => void;
  onQtyChange: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
}) {
  const product = line.product;
  const key = cartLineKey(line);
  const image = product.media.find((m) => m.type === "IMAGE");
  const needsColor = product.colors.length > 1;
  const needsSize = product.sizes.length > 1;

  const inCartFor = (c: string, s: string) =>
    cart
      .filter((l) => l !== line && l.product.id === product.id && l.selectedColor === c && l.selectedSize === s)
      .reduce((n, l) => n + l.quantity, 0);

  const sizeAvailableFor = (c: string, s: string) => {
    const avail = availableQuantity(product, c, s);
    return !Number.isFinite(avail) || avail - inCartFor(c, s) > 0;
  };
  const colorAvailable = (c: string) => {
    const sizes = product.sizes.length > 0 ? product.sizes : [""];
    return sizes.some((s) => sizeAvailableFor(c, s));
  };

  const pickColor = (c: string) => {
    if (c === line.selectedColor) return;
    const sizes = product.sizes.length > 0 ? product.sizes : [""];
    const nextSize =
      (sizeAvailableFor(c, line.selectedSize) ? line.selectedSize : undefined) ??
      sizes.find((s) => sizeAvailableFor(c, s)) ??
      sizes[0];
    onChangeVariant(line, c, nextSize);
  };

  return (
    <div className="pb-3 border-b border-gray-50 last:border-0 last:pb-0">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.presignedUrl} alt="" className="w-full h-full object-cover" />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-900 truncate">{product.name}</p>
          <p className="text-xs font-bold text-brand-600">{formatPrice(lineTotal)}</p>
          {lineTotal < product.price * line.quantity && (
            <p className="flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
              <span className="text-[11px] text-gray-400 line-through">{formatPrice(product.price * line.quantity)}</span>
              <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded">Bulk price</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => onQtyChange(key, line.quantity - 1)} className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center text-gray-500">
            <Minus size={11} />
          </button>
          <span className="w-5 text-center text-xs font-bold tabular-nums">{line.quantity}</span>
          <button onClick={() => onQtyChange(key, line.quantity + 1)} className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center text-gray-500">
            <Plus size={11} />
          </button>
        </div>
        <button onClick={() => onRemove(key)} className="text-gray-300 hover:text-red-500 flex-shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {(needsColor || needsSize) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-[60px]">
          {needsColor &&
            product.colors.map((c) => {
              const selected = c.name === line.selectedColor;
              const disabled = !selected && !colorAvailable(c.name);
              return (
                <button
                  key={c.name}
                  disabled={disabled}
                  onClick={() => pickColor(c.name)}
                  title={c.name}
                  className={clsx(
                    "w-5 h-5 rounded-full flex-shrink-0 transition-all",
                    selected ? "ring-2 ring-brand-400 ring-offset-1" : "ring-1 ring-gray-200",
                    disabled && "opacity-30"
                  )}
                  style={{ backgroundColor: c.hex }}
                />
              );
            })}
          {needsColor && needsSize && <span className="w-px h-4 bg-gray-100 mx-0.5" />}
          {needsSize &&
            product.sizes.map((s) => {
              const selected = s === line.selectedSize;
              const disabled = !selected && !sizeAvailableFor(line.selectedColor, s);
              return (
                <button
                  key={s}
                  disabled={disabled}
                  onClick={() => !selected && onChangeVariant(line, line.selectedColor, s)}
                  className={clsx(
                    "px-1.5 py-0.5 rounded-md border text-[10px] font-semibold flex-shrink-0",
                    selected ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-200 text-gray-500",
                    disabled && "opacity-30 line-through"
                  )}
                >
                  {s}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ── Catalog card — tapping the card adds the product to the cart (unchanged
// behavior); a product with more than one photo gets small edge tap-zones
// and a dot indicator to browse the rest, each stopping propagation so
// browsing photos never also adds the item. ──
function ProductCard({
  product,
  soldOut,
  level,
  inCartQty,
  onTap,
}: {
  product: Product;
  soldOut: boolean;
  level: "high" | "low" | "out";
  inCartQty: number;
  onTap: () => void;
}) {
  const images = product.media.filter((m) => m.type === "IMAGE");
  const [imageIndex, setImageIndex] = useState(0);
  const image = images[imageIndex] ?? images[0];

  return (
    <button
      onClick={onTap}
      disabled={soldOut}
      className={clsx(
        "relative text-left bg-white border rounded-2xl overflow-hidden transition-all",
        "border-gray-100 hover:border-brand-200",
        soldOut && "opacity-50 cursor-not-allowed"
      )}
    >
      <div className="aspect-square bg-gray-100 relative">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.presignedUrl} alt={product.name} className="w-full h-full object-cover" />
        ) : null}
        <span className={clsx("absolute top-2 left-2 w-2.5 h-2.5 rounded-full border-2 border-white shadow", STOCK_DOT[level])} />
        {soldOut && (
          <span className="absolute top-2 right-2 bg-gray-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            Sold out
          </span>
        )}
        {product.colors.length > 1 && (
          <div className="absolute bottom-2 left-2 flex gap-1">
            {product.colors.slice(0, 4).map((c) => (
              <span key={c.name} className="w-3 h-3 rounded-full border border-white shadow" style={{ backgroundColor: c.hex }} />
            ))}
          </div>
        )}
        {inCartQty > 0 && (
          <span className="absolute top-1.5 right-1.5 z-10 bg-brand-500 text-white text-[11px] font-bold w-6 h-6 rounded-full flex items-center justify-center shadow-lg border-2 border-white">
            {inCartQty}
          </span>
        )}
        {images.length > 1 && (
          <>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                setImageIndex((i) => (i - 1 + images.length) % images.length);
              }}
              className="absolute inset-y-0 left-0 w-7 flex items-center justify-center text-white/0 hover:text-white/90 hover:bg-black/10 transition-colors"
            >
              <ChevronLeft size={16} />
            </span>
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                setImageIndex((i) => (i + 1) % images.length);
              }}
              className="absolute inset-y-0 right-0 w-7 flex items-center justify-center text-white/0 hover:text-white/90 hover:bg-black/10 transition-colors"
            >
              <ChevronRight size={16} />
            </span>
            <div className="absolute bottom-2 right-2 flex gap-1">
              {images.map((_, i) => (
                <span key={i} className={clsx("w-1.5 h-1.5 rounded-full", i === imageIndex ? "bg-white" : "bg-white/50")} />
              ))}
            </div>
          </>
        )}
      </div>
      <div className="p-2.5">
        <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2">{product.name}</p>
        <p className="text-brand-600 font-bold text-sm mt-1">{formatPrice(product.price)}</p>
        {bulkTierLabels(product).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {bulkTierLabels(product).map((label) => (
              <span key={label} className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-md">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function CheckoutBar({
  total,
  settings,
  onCharge,
}: {
  total: number;
  settings: PosSettings | null;
  onCharge: (method: PosPaymentMethod) => Promise<void>;
}) {
  const confirmBeforeCharge = usePosPreferencesStore((s) => s.confirmBeforeCharge);
  const [charging, setCharging] = useState<PosPaymentMethod | null>(null);
  const [armed, setArmed] = useState<PosPaymentMethod | null>(null);
  const [chargeError, setChargeError] = useState("");

  // With the "confirm before charging" preference on, the first tap arms the
  // button (it switches to "Confirm?") and only a second tap actually charges;
  // the arm disarms itself after a few seconds or when another method is tapped.
  const handleTap = async (method: PosPaymentMethod) => {
    if (charging) return;
    if (confirmBeforeCharge && armed !== method) {
      setArmed(method);
      setTimeout(() => setArmed((cur) => (cur === method ? null : cur)), 3000);
      return;
    }
    setArmed(null);
    setCharging(method);
    setChargeError("");
    try {
      await onCharge(method);
    } catch (e) {
      setChargeError(
        e instanceof ApiError && e.status === 403
          ? "Your account isn't allowed to record sales. Ask an admin to check your role."
          : e instanceof ApiError
            ? `The sale wasn't recorded: ${e.message}`
            : "The sale wasn't recorded — the server can't be reached. Check the connection and try again."
      );
    } finally {
      setCharging(null);
    }
  };

  const methods = settings ? PAYMENT_METHODS.filter((m) => settings[m.enabledKey]) : PAYMENT_METHODS;

  return (
    <>
    {chargeError && (
      <div role="alert" className="mb-3 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
        {chargeError}
      </div>
    )}
    <div className="grid grid-cols-3 gap-2">
      {methods.map((m) => {
        const isCharging = charging === m.value;
        const isArmed = armed === m.value;
        return (
          <button
            key={m.value}
            onClick={() => handleTap(m.value)}
            disabled={!!charging || total <= 0}
            className={clsx(
              "flex flex-col items-center justify-center gap-1.5 py-3.5 rounded-xl font-bold text-xs transition-all disabled:opacity-40",
              isArmed ? "bg-gray-900 text-white ring-2 ring-offset-2 ring-gray-900" : m.classes
            )}
          >
            {isCharging ? (
              <Loader2 size={18} className="animate-spin" />
            ) : m.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.logo} alt="" className="w-8 h-8 rounded-lg object-cover ring-2 ring-white/80 shadow-sm" />
            ) : (
              <Banknote size={18} />
            )}
            {isCharging ? "Charging…" : isArmed ? "Confirm?" : m.label}
          </button>
        );
      })}
    </div>
    </>
  );
}

function SuccessToast({ sale, onPrint, onDismiss }: { sale: PosSale; onPrint: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-4 inset-x-0 mx-auto w-fit z-40 bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-4 animate-slide-up">
      <div className="w-9 h-9 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
        <Check size={18} className="text-green-400" />
      </div>
      <div>
        <p className="font-bold">{formatPrice(sale.total)}</p>
        <p className="text-xs text-gray-400">{sale.paymentMethod.replace("_", " ")} · {sale.items.reduce((s, i) => s + i.quantity, 0)} items</p>
      </div>
      <button
        onClick={onPrint}
        className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 text-xs font-semibold ml-2"
      >
        <Printer size={14} /> Print
      </button>
      <button onClick={onDismiss} className="text-gray-500 hover:text-white">
        <X size={16} />
      </button>
    </div>
  );
}

export default function PosScreen() {
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const autoPrintAfterSale = usePosPreferencesStore((s) => s.autoPrintAfterSale);

  const [catalog, setCatalog] = useState<PosCatalog | null>(null);
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [todayStats, setTodayStats] = useState<{ count: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  // The basket lives in a store, not here, so leaving the Sale screen and coming back keeps it.
  const cartOwnerId = usePosCartStore((s) => s.ownerId);
  const cartLines = usePosCartStore((s) => s.lines);
  const setCartLines = usePosCartStore((s) => s.setLines);
  const refreshCartProducts = usePosCartStore((s) => s.refreshProducts);
  const cart = useMemo(() => (session && cartOwnerId === session.id ? cartLines : []), [session, cartOwnerId, cartLines]);
  const setCart = (update: CartLine[] | ((prev: CartLine[]) => CartLine[])) => {
    if (session) setCartLines(session.id, update);
  };
  const [successSale, setSuccessSale] = useState<PosSale | null>(null);
  const [successDiscount, setSuccessDiscount] = useState(0);
  const [printData, setPrintData] = useState<ReceiptData | null>(null);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    Promise.all([
      getCatalog(session.token),
      getSettings(session.token),
      // Optional for the till to work: offline, the catalog comes from the offline copy and today's totals just start at 0.
      listSales(session.token).catch(() => []),
      listOnlineSales(session.token).catch(() => []),
    ])
      .then(([cat, settingsResp, sales, onlineSales]) => {
        setCatalog(cat);
        // A basket kept from earlier picks up any price/stock change made since it was filled.
        refreshCartProducts(cat.products);
        setSettings(settingsResp);
        const today = new Date().toDateString();
        const todaySales = sales.filter((s) => !s.voided && new Date(s.soldAt).toDateString() === today);
        const todayOnline = onlineSales.filter((o) => o.packagingCompletedAt && new Date(o.packagingCompletedAt).toDateString() === today);
        setTodayStats({
          count: todaySales.length + todayOnline.length,
          total: todaySales.reduce((s, x) => s + x.total, 0) + todayOnline.reduce((s, x) => s + x.total, 0),
        });
      })
      .catch((e) =>
        setLoadError(
          e instanceof ApiError
            ? e.message
            : "Can't reach the server, so the catalog couldn't load. Check the connection, then reload this page."
        )
      )
      .finally(() => setLoading(false));
  }, [hasHydrated, session, refreshCartProducts]);

  const products = catalog?.products ?? [];
  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.categorySlug))).sort(), [products]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category && p.categorySlug !== category) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, category]);
  // 24 fills a 2-, 3- or 4-column grid evenly; search and category chips still look across every product.
  const catalogPage = usePagination(filtered, 24, [search, category]);

  const addToCart = (product: Product, selectedColor: string, selectedSize: string) => {
    setCart((prev) => {
      const key = cartLineKey({ product, selectedColor, selectedSize });
      const idx = prev.findIndex((l) => cartLineKey(l) === key);
      if (idx === -1) return [...prev, { product, selectedColor, selectedSize, quantity: 1 }];
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
      return next;
    });
  };

  // Tapping a card always adds straight to the cart — no popup, no in-between
  // step. Color/size/quantity are then set directly on the cart line.
  const handleCardTap = (product: Product) => {
    if (isProductSoldOut(product)) return;
    const { color, size } = defaultVariant(product, cart);
    addToCart(product, color, size);
  };

  const updateCartQty = (key: string, quantity: number) => {
    setCart((prev) => {
      if (quantity <= 0) return prev.filter((l) => cartLineKey(l) !== key);
      return prev.map((l) => (cartLineKey(l) === key ? { ...l, quantity } : l));
    });
  };
  const removeCartLine = (key: string) => setCart((prev) => prev.filter((l) => cartLineKey(l) !== key));

  // Re-pointing a cart line at a different color/size: merge into an existing
  // line for that combination if there is one, otherwise just relabel this line.
  const changeCartVariant = (line: CartLine, color: string, size: string) => {
    setCart((prev) => {
      const newKey = cartLineKey({ product: line.product, selectedColor: color, selectedSize: size });
      if (newKey === cartLineKey(line)) return prev;
      const existingIdx = prev.findIndex((l) => l !== line && cartLineKey(l) === newKey);
      if (existingIdx !== -1) {
        const merged = [...prev];
        merged[existingIdx] = { ...merged[existingIdx], quantity: merged[existingIdx].quantity + line.quantity };
        return merged.filter((l) => l !== line);
      }
      return prev.map((l) => (l === line ? { ...l, selectedColor: color, selectedSize: size } : l));
    });
  };

  const lineTotals = useMemo(() => computeCartLineTotals(cart), [cart]);
  const total = Array.from(lineTotals.values()).reduce((s, v) => s + v, 0);
  const regularTotal = cart.reduce((s, l) => s + l.product.price * l.quantity, 0);
  const discount = Math.max(0, Math.round(regularTotal - total));
  const itemCount = cart.reduce((s, l) => s + l.quantity, 0);

  const handleCharge = async (method: PosPaymentMethod) => {
    if (!session) return;
    const sale = await createSale(session.token, {
      clientSaleId: crypto.randomUUID(),
      items: cart.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        selectedColor: l.selectedColor,
        selectedSize: l.selectedSize,
      })),
      paymentMethod: method,
      soldAt: new Date().toISOString(),
    });
    // The backend applies the same bulk prices; the reduction is what the regular prices would have cost minus that.
    const saleDiscount = Math.max(0, Math.round(regularTotal - sale.total));
    setCart([]);
    setSuccessSale(sale);
    setSuccessDiscount(saleDiscount);
    setTodayStats((prev) => (prev ? { count: prev.count + 1, total: prev.total + sale.total } : prev));
    getCatalog(session.token).then(setCatalog).catch(() => {});
    if (autoPrintAfterSale) printSale(sale, saleDiscount);
  };

  const printSale = (sale: PosSale, saleDiscount = 0) => {
    setPrintData({
      saleRef: sale.id.slice(0, 8).toUpperCase(),
      cashierName: sale.cashierName,
      items: sale.items.map((i) => ({
        productName: i.productName,
        selectedColor: i.selectedColor,
        selectedSize: i.selectedSize,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      total: sale.total,
      paymentMethod: sale.paymentMethod,
      soldAt: sale.soldAt,
      discount: saleDiscount,
    });
    setTimeout(() => window.print(), 50);
  };

  if (!session) return null;

  const headerExtra = (
    <div className="flex items-center gap-3">
      <div className="relative flex-1 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a product (name, reference…)"
          className="w-full bg-gray-50 border border-gray-100 rounded-xl pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white"
        />
      </div>
      {todayStats && (
        <span className="hidden md:flex items-center gap-1.5 text-xs font-semibold text-gray-500 bg-gray-50 px-3 py-1.5 rounded-full whitespace-nowrap">
          <TrendingUp size={12} className="text-brand-500" />
          {todayStats.count} sales today · {formatPrice(todayStats.total)}
        </span>
      )}
    </div>
  );

  return (
    <>
      <PosShell title="Sale" headerExtra={headerExtra}>
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* Catalog */}
          <div className="relative flex-1 flex flex-col min-h-0 p-4 sm:p-6">
            {categories.length > 1 && (
              <div className="flex-shrink-0 flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
                <button
                  onClick={() => setCategory(null)}
                  className={clsx(
                    "flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors",
                    category === null ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600"
                  )}
                >
                  All
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={clsx(
                      "flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors",
                      category === c ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-600"
                    )}
                  >
                    {c.replace(/-/g, " ")}
                  </button>
                ))}
              </div>
            )}

            {loading && (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <Loader2 size={24} className="animate-spin" />
              </div>
            )}

            {loadError && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{loadError}</div>}

            {!loading && !loadError && (
              // The scroll area is its own box so the grid inside keeps natural row heights — when the grid itself
              // was the flex child that scrolled, WebKit (the desktop app's engine) squashed every card to fit.
              <div className="flex-1 min-h-0 overflow-y-auto pb-28 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 content-start">
                {catalogPage.pageItems.map((product) => {
                  const soldOut = isProductSoldOut(product);
                  const level = stockLevel(product);
                  const inCartQty = cart.filter((l) => l.product.id === product.id).reduce((s, l) => s + l.quantity, 0);
                  return (
                    <ProductCard
                      key={product.id}
                      product={product}
                      soldOut={soldOut}
                      level={level}
                      inCartQty={inCartQty}
                      onTap={() => handleCardTap(product)}
                    />
                  );
                })}
                {filtered.length === 0 && (
                  <p className="col-span-full text-center text-gray-400 text-sm py-10">No products match &ldquo;{search}&rdquo;.</p>
                )}
              </div>
              <Pagination
                page={catalogPage.page}
                totalPages={catalogPage.totalPages}
                total={catalogPage.total}
                pageSize={catalogPage.pageSize}
                noun="products"
                onPageChange={catalogPage.setPage}
              />
              </div>
            )}
          </div>

          {/* Cart */}
          <div className="w-full lg:w-96 bg-white border-t lg:border-t-0 lg:border-l border-gray-100 flex flex-col flex-shrink-0">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <ShoppingCart size={16} className="text-gray-500" />
              <h2 className="font-bold text-gray-900 text-sm">Current sale</h2>
              {itemCount > 0 && <span className="ml-auto text-xs font-semibold text-gray-400">{itemCount} items</span>}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[100px]">
              {cart.length === 0 && <p className="text-center text-gray-300 text-sm py-10">Tap a product to add it here.</p>}
              {cart.map((line) => (
                <CartLineRow
                  key={cartLineKey(line)}
                  line={line}
                  cart={cart}
                  lineTotal={lineTotals.get(cartLineKey(line)) ?? line.product.price * line.quantity}
                  onChangeVariant={changeCartVariant}
                  onQtyChange={updateCartQty}
                  onRemove={removeCartLine}
                />
              ))}
            </div>

            <div className="p-5 border-t border-gray-100">
              {discount > 0 && (
                <div className="space-y-1 mb-2 text-sm">
                  <div className="flex items-center justify-between text-gray-500">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatPrice(regularTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between font-semibold text-green-700">
                    <span>Bulk discount</span>
                    <span className="tabular-nums">-{formatPrice(discount)}</span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-gray-500">Total</span>
                <span className="text-2xl font-bold text-gray-900">{formatPrice(total)}</span>
              </div>
              <CheckoutBar total={total} settings={settings} onCharge={handleCharge} />
            </div>
          </div>
        </div>
      </PosShell>

      {successSale && (
        <SuccessToast
          sale={successSale}
          onPrint={() => printSale(successSale, successDiscount)}
          onDismiss={() => setSuccessSale(null)}
        />
      )}

      <PrintArea settings={settings} data={printData} />
    </>
  );
}
