"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePosAuthStore } from "@/lib/authStore";

export default function RootPage() {
  const router = useRouter();
  const session = usePosAuthStore((s) => s.session);

  useEffect(() => {
    router.replace(session ? "/pos" : "/login");
  }, [session, router]);

  return null;
}
