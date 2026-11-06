"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import { getProduct } from "@/lib/api/products";
import { Product } from "@/lib/types";
import PosShell from "@/components/PosShell";
import BackButton from "@/components/BackButton";
import ProductForm from "@/components/ProductForm";
import { useT } from "@/lib/i18n";

// /products/edit?id=… rather than /products/[id]: a static export (the desktop app's build) can't serve
// dynamic route segments it didn't know about at build time.
export default function EditProductPage() {
  return (
    <Suspense fallback={null}>
      <EditProduct />
    </Suspense>
  );
}

function EditProduct() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canView = usePosAuthStore((s) => s.hasPermission("VIEW_PRODUCTS"));
  const { t } = useT();
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canView) {
      router.replace("/");
      return;
    }
    if (!id) {
      setError(t("products.noneSelected"));
      return;
    }
    getProduct(id, session.token)
      .then(setProduct)
      .catch((e) => setError(e instanceof Error ? e.message : t("products.loadOneFailed")));
  }, [hasHydrated, session, canView, id, router]);

  return (
    <PosShell title={product ? product.name : t("products.product")}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 pb-0">
          <BackButton href="/products" label={t("products.back")} />
          {error ? (
            <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{error}</div>
          ) : !product ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : (
            <ProductForm key={product.id} initial={product} />
          )}
        </div>
      </div>
    </PosShell>
  );
}
