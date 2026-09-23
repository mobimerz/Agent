"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Soft-refresh server data periodically while the tab is visible.
 * (Phase 3 adds real-time push via SSE; this keeps pages fresh until then.)
 */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
