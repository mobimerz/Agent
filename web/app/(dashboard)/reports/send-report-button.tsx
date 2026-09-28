"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2Icon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import type { ReportKind } from "@siteguard/core";
import { Button } from "@/components/ui/button";
import { requestReport } from "./actions";

export function SendReportButton({ kind, label }: { kind: ReportKind; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await requestReport(kind);
          if (!res.ok) return void toast.error(res.error);
          toast.success("Report requested — the worker sends it within a minute (email, Telegram, in-app).");
          // The new report appears after the worker's next tick.
          setTimeout(() => router.refresh(), 70_000);
        })
      }
    >
      {pending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
      {label}
    </Button>
  );
}
