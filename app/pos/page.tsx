"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Store,
  LogOut,
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  X,
  Check,
  Loader2,
  Receipt,
  Banknote,
  Smartphone,
} from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { getCatalog, createSale } from "@/lib/api/pos";
import { availableQuantity, isProductSoldOut } from "@/lib/stock";
import { CartLine, PosCatalog, PosPaymentMethod, Product, PosSale } from "@/lib/types";

const PAYMENT_METHODS: { value: PosPaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "CASH", label: "Cash", icon: Banknote },
  { value: "ORANGE_MONEY", label: "Orange Money", icon: Smartphone },
  { value: "MOBILE_MONEY", label: "Mobile Money", icon: Smartphone },
];

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

function cartLineKey(line: Pick<CartLine, "product" | "selectedColor" | "selectedSize">) {
  return `${line.product.id}::${line.selectedColor}::${line.selectedSize}`;
}

// ── Variant picker — opened from a product card, lets the cashier choose
// color/size (if the product has them) and a quantity capped at what's
// actually left, accounting for anything already sitting in the cart for
// that same combination. ──
function VariantPickerModal({
  product,
  cart,
  onAdd,
  onClose,
}: {
  product: Product;
  cart: CartLine[];
  onAdd: (line: CartLine) => void;
  onClose: () => void;
}) {
  const [color, setColor] = useState(product.colors[0]?.name ?? "");
  const [size, setSize] = useState(product.sizes[0] ?? "");
  const [qty, setQty] = useState(1);

  const inCartQty = cart
    .filter((l) => l.product.id === product.id && l.selectedColor === color && l.selectedSize === size)
    .reduce((s, l) => s + l.quantity, 0);
  const available = availableQuantity(product, color, size);
  const remaining = Number.isFinite(available) ? Math.max(0, available - inCartQty) : Infinity;

  useEffect(() => {
    setQty(1);
  }, [color, size]);

  const image = product.media.find((m) => m.type === "IMAGE");

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image.presignedUrl} alt={product.name} className="w-full h-full object-cover" />
            ) : null}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 leading-tight">{product.name}</h3>
            <p className="text-brand-600 font-bold mt-0.5">{formatPrice(product.price)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X size={18} />
          </button>
        </div>

        {product.colors.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">Color</p>
            <div className="flex flex-wrap gap-2">
              {product.colors.map((c) => {
                const sizes = product.sizes.length > 0 ? product.sizes : [""];
                const colorSoldOut = !sizes.some((sz) => availableQuantity(product, c.name, sz) > 0);
                return (
                  <button
                    key={c.name}
                    onClick={() => setColor(c.name)}
                    className={clsx(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 text-sm font-medium",
                      colorSoldOut && "opacity-50",
                      color === c.name ? "border-brand-500 bg-brand-50" : "border-gray-200"
                    )}
                  >
                    <span className="w-4 h-4 rounded-full border border-gray-200" style={{ backgroundColor: c.hex }} />
                    <span className={colorSoldOut ? "line-through" : undefined}>{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {product.sizes.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-500 mb-2">Size</p>
            <div className="flex flex-wrap gap-2">
              {product.sizes.map((s) => {
                const soldOut = availableQuantity(product, color, s) <= 0;
                return (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={clsx(
                      "min-w-[42px] px-3 py-1.5 rounded-xl border-2 text-sm font-medium",
                      soldOut && "opacity-50 line-through",
                      size === s ? "border-brand-500 bg-brand-500 text-white" : "border-gray-200"
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3 mb-4">
          <span className="text-sm font-semibold text-gray-700">Quantity</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="w-9 h-9 rounded-lg border-2 border-gray-200 flex items-center justify-center"
            >
              <Minus size={15} />
            </button>
            <span className="w-8 text-center font-bold tabular-nums">{qty}</span>
            <button
              onClick={() => setQty((q) => Math.min(q + 1, Number.isFinite(remaining) ? remaining : q + 1))}
              disabled={qty >= remaining}
              className="w-9 h-9 rounded-lg border-2 border-gray-200 flex items-center justify-center disabled:opacity-30"
            >
              <Plus size={15} />
            </button>
          </div>
        </div>

        {remaining <= 0 ? (
          <p className="text-sm font-semibold text-red-500 mb-3 text-center">Sold out</p>
        ) : Number.isFinite(remaining) ? (
          <p className="text-xs text-gray-400 mb-3 text-center">{remaining} left</p>
        ) : null}

        <button
          onClick={() => {
            onAdd({ product, selectedColor: color, selectedSize: size, quantity: qty });
            onClose();
          }}
          disabled={remaining <= 0}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-3 transition-colors"
        >
          Add to sale
        </button>
      </div>
    </div>
  );
}

// ── Checkout — payment method, then confirm. ──
function CheckoutModal({
  total,
  onConfirm,
  onClose,
}: {
  total: number;
  onConfirm: (method: PosPaymentMethod) => Promise<void>;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PosPaymentMethod | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    if (!method) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(method);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't record the sale.");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-sm rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-1">Charge</h3>
        <p className="text-3xl font-bold text-brand-600 mb-5">{formatPrice(total)}</p>

        <p className="text-xs font-semibold text-gray-500 mb-2">Payment method</p>
        <div className="grid grid-cols-1 gap-2 mb-5">
          {PAYMENT_METHODS.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.value}
                onClick={() => setMethod(m.value)}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-colors",
                  method === m.value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-gray-200 text-gray-700"
                )}
              >
                <Icon size={18} />
                {m.label}
                {method === m.value && <Check size={16} className="ml-auto text-brand-500" />}
              </button>
            );
          })}
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-3.5 py-2.5 mb-4">{error}</div>}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border-2 border-gray-200 font-semibold text-gray-600">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!method || submitting}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-40 text-white font-semibold"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
            {submitting ? "Recording…" : "Confirm sale"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SuccessScreen({ sale, onNewSale }: { sale: PosSale; onNewSale: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white p-6">
      <div className="w-full max-w-sm text-center">
        <div className="w-20 h-20 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
          <Check size={36} className="text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Sale complete</h2>
        <p className="text-gray-400 mb-6">{sale.items.reduce((s, i) => s + i.quantity, 0)} items · {sale.paymentMethod.replace("_", " ")}</p>
        <p className="text-4xl font-bold text-brand-600 mb-8">{formatPrice(sale.total)}</p>
        <button
          onClick={onNewSale}
          className="w-full bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl py-3.5 transition-colors"
        >
          New sale
        </button>
      </div>
    </div>
  );
}

export default function PosScreen() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const logout = usePosAuthStore((s) => s.logout);

  const [catalog, setCatalog] = useState<PosCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<PosSale | null>(null);

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }
    getCatalog(session.token)
      .then(setCatalog)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load the catalog."))
      .finally(() => setLoading(false));
  }, [session, router]);

  const products = catalog?.products ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  const addToCart = (line: CartLine) => {
    setCart((prev) => {
      const key = cartLineKey(line);
      const idx = prev.findIndex((l) => cartLineKey(l) === key);
      if (idx === -1) return [...prev, line];
      const next = [...prev];
      next[idx] = { ...next[idx], quantity: next[idx].quantity + line.quantity };
      return next;
    });
  };

  const updateCartQty = (key: string, quantity: number) => {
    setCart((prev) => {
      if (quantity <= 0) return prev.filter((l) => cartLineKey(l) !== key);
      return prev.map((l) => (cartLineKey(l) === key ? { ...l, quantity } : l));
    });
  };

  const removeCartLine = (key: string) => setCart((prev) => prev.filter((l) => cartLineKey(l) !== key));

  const total = cart.reduce((s, l) => s + l.product.price * l.quantity, 0);
  const itemCount = cart.reduce((s, l) => s + l.quantity, 0);

  const handleConfirmSale = async (method: PosPaymentMethod) => {
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
    setCheckoutOpen(false);
    setCompletedSale(sale);
    // Re-fetch so the catalog's stock numbers reflect this sale immediately.
    getCatalog(session.token).then(setCatalog).catch(() => {});
  };

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center">
            <Store size={17} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-gray-900 leading-none text-sm">Riskyc POS</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{session.firstName} {session.lastName} · {session.roleName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/sales")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100"
          >
            <Receipt size={14} /> Sales
          </button>
          <button
            onClick={() => {
              logout();
              router.replace("/login");
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100"
          >
            <LogOut size={14} /> Log out
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Catalog */}
        <div className="flex-1 flex flex-col min-h-0 p-4 sm:p-6">
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full bg-white border border-gray-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>

          {loading && (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          )}

          {loadError && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{loadError}</div>}

          {!loading && !loadError && (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 overflow-y-auto pb-4">
              {filtered.map((product) => {
                const image = product.media.find((m) => m.type === "IMAGE");
                const soldOut = isProductSoldOut(product);
                return (
                  <button
                    key={product.id}
                    onClick={() => !soldOut && setPickerProduct(product)}
                    disabled={soldOut}
                    className={clsx(
                      "text-left bg-white border border-gray-100 rounded-2xl overflow-hidden hover:border-brand-200 transition-colors",
                      soldOut && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <div className="aspect-square bg-gray-100 relative">
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={image.presignedUrl} alt={product.name} className="w-full h-full object-cover" />
                      ) : null}
                      {soldOut && (
                        <span className="absolute top-2 left-2 bg-gray-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                          Sold out
                        </span>
                      )}
                    </div>
                    <div className="p-2.5">
                      <p className="text-xs font-semibold text-gray-900 leading-tight line-clamp-2">{product.name}</p>
                      <p className="text-brand-600 font-bold text-sm mt-1">{formatPrice(product.price)}</p>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="col-span-full text-center text-gray-400 text-sm py-10">No products match &ldquo;{search}&rdquo;.</p>
              )}
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

          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[120px]">
            {cart.length === 0 && (
              <p className="text-center text-gray-300 text-sm py-10">Tap a product to add it here.</p>
            )}
            {cart.map((line) => {
              const key = cartLineKey(line);
              const image = line.product.media.find((m) => m.type === "IMAGE");
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image.presignedUrl} alt="" className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-900 truncate">{line.product.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {[line.selectedColor, line.selectedSize].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <p className="text-xs font-bold text-brand-600">{formatPrice(line.product.price * line.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => updateCartQty(key, line.quantity - 1)}
                      className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center text-gray-500"
                    >
                      <Minus size={11} />
                    </button>
                    <span className="w-5 text-center text-xs font-bold tabular-nums">{line.quantity}</span>
                    <button
                      onClick={() => updateCartQty(key, line.quantity + 1)}
                      className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center text-gray-500"
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                  <button onClick={() => removeCartLine(key)} className="text-gray-300 hover:text-red-500 flex-shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="p-5 border-t border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-semibold text-gray-500">Total</span>
              <span className="text-2xl font-bold text-gray-900">{formatPrice(total)}</span>
            </div>
            <button
              onClick={() => setCheckoutOpen(true)}
              disabled={cart.length === 0}
              className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl py-3.5 transition-colors"
            >
              Charge
            </button>
          </div>
        </div>
      </div>

      {pickerProduct && (
        <VariantPickerModal product={pickerProduct} cart={cart} onAdd={addToCart} onClose={() => setPickerProduct(null)} />
      )}

      {checkoutOpen && <CheckoutModal total={total} onConfirm={handleConfirmSale} onClose={() => setCheckoutOpen(false)} />}

      {completedSale && (
        <SuccessScreen
          sale={completedSale}
          onNewSale={() => {
            setCompletedSale(null);
            setCart([]);
          }}
        />
      )}
    </div>
  );
}
