"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, Pencil, Trash2, EyeOff, X } from "lucide-react";
import clsx from "clsx";
import { usePosAuthStore } from "@/lib/authStore";
import { listAdminProducts, deleteProduct } from "@/lib/api/products";
import { isProductSoldOut, stockLevel } from "@/lib/stock";
import { Product } from "@/lib/types";
import PosShell from "@/components/PosShell";
import Pagination from "@/components/Pagination";
import { usePagination } from "@/lib/usePagination";

const EDIT_PERMISSIONS = [
  "UPDATE_PRODUCT_INFO",
  "UPDATE_PRODUCT_PRICING",
  "UPDATE_PRODUCT_IMAGES",
  "UPDATE_PRODUCT_COLORS",
  "UPDATE_PRODUCT_STOCK",
  "UPDATE_PRODUCT_DISPLAY",
  "UPDATE_PRODUCT_VISIBILITY",
];

function formatPrice(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} FCFA`;
}

function stockLabel(product: Product): { text: string; classes: string } {
  const tracked = product.variants.filter((v) => !v.untracked);
  if (tracked.length === 0) return { text: "Unlimited", classes: "bg-gray-100 text-gray-600" };
  if (isProductSoldOut(product)) return { text: "Sold out", classes: "bg-red-50 text-red-600" };
  const total = tracked.reduce((s, v) => s + Math.max(0, v.quantity), 0);
  return stockLevel(product) === "low"
    ? { text: `${total} left`, classes: "bg-amber-50 text-amber-700" }
    : { text: `${total} in stock`, classes: "bg-green-50 text-green-700" };
}

export default function ProductsPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const hasPermission = usePosAuthStore((s) => s.hasPermission);
  const canView = hasPermission("VIEW_PRODUCTS");
  const canCreate = hasPermission("CREATE_PRODUCT");
  const canDelete = hasPermission("DELETE_PRODUCT");
  const canEdit = EDIT_PERMISSIONS.some((p) => hasPermission(p));

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canView) {
      router.replace("/");
      return;
    }
    listAdminProducts(session.token)
      .then(setProducts)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load products."))
      .finally(() => setLoading(false));
  }, [hasHydrated, session, canView, router]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? products.filter((p) => `${p.name} ${p.categorySlug}`.toLowerCase().includes(q)) : products;
  }, [products, search]);

  const pagination = usePagination(filtered, 10, search);

  const handleDelete = async (product: Product) => {
    if (!session) return;
    if (!window.confirm(`Delete "${product.name}"? It disappears from the online shop and the till. This can't be undone.`)) return;
    setDeletingId(product.id);
    try {
      await deleteProduct(product.id, session.token);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that product.");
    } finally {
      setDeletingId(null);
    }
  };

  const headerExtra = canCreate ? (
    <div className="flex justify-end">
      <Link
        href="/products/new"
        className="flex items-center gap-1.5 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
      >
        <Plus size={15} /> New product
      </Link>
    </div>
  ) : undefined;

  return (
    <PosShell title="Products" headerExtra={headerExtra}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 space-y-5">
          <div className="bg-white border border-gray-200 shadow-sm rounded-2xl p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSearch("")}
                placeholder="Search a product by name or category…"
                className="w-full bg-gray-100 border border-gray-200 rounded-xl pl-9 pr-9 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  title="Clear the search and show every product"
                  aria-label="Clear the search and show every product"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400">
              {filtered.length} product{filtered.length !== 1 ? "s" : ""}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-gray-400 py-16 text-sm">
              {products.length === 0 ? "No products yet." : "No products match your search."}
            </p>
          ) : (
            <>
            <div className="bg-white border border-gray-200 shadow-sm rounded-2xl overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3 text-left">Product</th>
                    <th className="px-4 py-3 text-left">Category</th>
                    <th className="px-4 py-3 text-left">Price</th>
                    <th className="px-4 py-3 text-left">Stock</th>
                    <th className="px-4 py-3 text-left">Variants</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pagination.pageItems.map((product) => {
                    const image = product.media.find((m) => m.type === "IMAGE");
                    const stock = stockLabel(product);
                    return (
                      <tr key={product.id} className="hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                              {image && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={image.presignedUrl} alt="" className="w-full h-full object-cover" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate max-w-[280px]">{product.name}</p>
                              {product.hidden && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-gray-500">
                                  <EyeOff size={10} /> Hidden online
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 capitalize">{product.categorySlug.replace(/-/g, " ")}</td>
                        <td className="px-4 py-3 text-sm font-bold tabular-nums text-gray-900">{formatPrice(product.price)}</td>
                        <td className="px-4 py-3">
                          <span className={clsx("text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap", stock.classes)}>{stock.text}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {[
                            product.colors.length > 0 && `${product.colors.length} color${product.colors.length !== 1 ? "s" : ""}`,
                            product.sizes.length > 0 && `${product.sizes.length} size${product.sizes.length !== 1 ? "s" : ""}`,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <Link
                              href={`/products/edit?id=${product.id}`}
                              title={canEdit ? "Edit" : "View"}
                              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                            >
                              <Pencil size={14} />
                            </Link>
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(product)}
                                disabled={deletingId === product.id}
                                title="Delete"
                                className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                              >
                                {deletingId === product.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pagination.pageSize}
              noun="products"
              onPageChange={pagination.setPage}
            />
            </>
          )}
        </div>
      </div>
    </PosShell>
  );
}
