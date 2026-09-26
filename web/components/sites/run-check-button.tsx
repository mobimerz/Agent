"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2Icon, PlayIcon } from "lucide-react";
import { toast } from "sonner";
import { CHECK_LABELS, reasonLabel, type CheckType } from "@siteguard/core";
import { runCheckNow } from "@/app/(dashboard)/sites/actions";
import { Button } from "@/components/ui/button";
import type { ResultRow } from "@/lib/queries/sites";

const POLL_MS = 1500;
const MAX_WAIT_MS = 120_000;
/** Two Lighthouse runs (mobile + desktop) plus keyless spacing take minutes. */
const MAX_WAIT_PSI_MS = 6 * 60_000;

/**
 * Queues an immediate run, polls for the new result, shows it in a toast and
 * soft-refreshes the page data (no full reload).
 */
export function RunCheckButton({ siteId, type, size = "sm", variant = "outline" }: { siteId: string; type: CheckType; size?: "sm" | "default"; variant?: "outline" | "default" }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  async function run() {
    setRunning(true);
    cancelled.current = false;
    const res = await runCheckNow(siteId, type);
    if (!res.ok) {
      toast.error(res.error);
      setRunning(false);
      return;
    }
    const toastId = toast.loading(`Running ${CHECK_LABELS[type]} check…`);
    const started = Date.now();
    const after = encodeURIComponent(res.data.requestedAt);

    const maxWait = type === "pagespeed" ? MAX_WAIT_PSI_MS : MAX_WAIT_MS;
    while (!cancelled.current && Date.now() - started < maxWait) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const r = await fetch(`/api/sites/${siteId}/latest?type=${type}&after=${after}`, { cache: "no-store" });
      if (r.status === 204) continue;
      if (!r.ok) break;
      const result = (await r.json()) as ResultRow;
      const text = `${result.status === "OK" ? "OK" : reasonLabel(result.reason)} — ${result.message}`;
      if (result.status === "OK") toast.success(text, { id: toastId });
      else if (result.status === "FAIL") toast.error(text, { id: toastId, duration: 8000 });
      else toast.warning(text, { id: toastId, duration: 8000 });
      router.refresh();
      setRunning(false);
      return;
    }
    toast.error("No result yet. Is the worker running? (pnpm dev:worker)", { id: toastId });
    setRunning(false);
  }

  return (
    <Button size={size} variant={variant} onClick={run} disabled={running}>
      {running ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
      {running ? "Checking…" : `Run ${type} check`}
    </Button>
  );
}
