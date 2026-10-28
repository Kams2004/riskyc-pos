"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePosAuthStore } from "@/lib/authStore";

export default function RootPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);
  const hasHydrated = usePosAuthStore((s) => s.hasHydrated);

  useEffect(() => {
    if (!hasHydrated) return;
    router.replace(session ? "/pos" : "/login");
  }, [hasHydrated, session, router]);

  return null;
}
