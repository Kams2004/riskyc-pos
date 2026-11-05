"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { usePosAuthStore } from "@/lib/authStore";
import { getProduct } from "@/lib/api/products";
import { Product } from "@/lib/types";
import PosShell from "@/components/PosShell";
import BackButton from "@/components/BackButton";
import ProductForm from "@/components/ProductForm";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canView = usePosAuthStore((s) => s.hasPermission("VIEW_PRODUCTS"));
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasHydrated || !session) return;
    if (!canView) {
      router.replace("/pos");
      return;
    }
    getProduct(id, session.token)
      .then(setProduct)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this product."));
  }, [hasHydrated, session, canView, id, router]);

  return (
    <PosShell title={product ? product.name : "Product"}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 pb-0">
          <BackButton href="/products" label="Back to products" />
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
