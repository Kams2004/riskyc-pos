"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePosAuthStore } from "@/lib/authStore";
import PosShell from "@/components/PosShell";
import BackButton from "@/components/BackButton";
import ProductForm from "@/components/ProductForm";

export default function NewProductPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);
  const canCreate = usePosAuthStore((s) => s.hasPermission("CREATE_PRODUCT"));

  useEffect(() => {
    if (hasHydrated && session && !canCreate) router.replace("/products");
  }, [hasHydrated, session, canCreate, router]);

  return (
    <PosShell title="New product">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 pb-0">
          <BackButton href="/products" label="Back to products" />
          {canCreate && <ProductForm />}
        </div>
      </div>
    </PosShell>
  );
}
