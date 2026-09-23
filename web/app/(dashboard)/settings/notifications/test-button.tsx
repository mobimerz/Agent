"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, EyeIcon, Loader2Icon } from "lucide-react";
import type { SendOutcome } from "@siteguard/notify";
import { Button } from "@/components/ui/button";
import { sendTestEmailAction, sendTestTelegramAction } from "./actions";

export function TestButton({ channel }: { channel: "email" | "telegram" }) {
  const [result, setResult] = useState<SendOutcome | null>(null);
  const [pending, startTransition] = useTransition();
  const label = channel === "email" ? "Send test email" : "Send test Telegram";
  const previewHref = channel === "email" ? "/dev/emails" : "/dev/telegram";

  return (
    <div className="grid gap-2">
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setResult(null);
              setResult(await (channel === "email" ? sendTestEmailAction() : sendTestTelegramAction()));
            })
          }
        >
          {pending && <Loader2Icon className="animate-spin" />} {label}
        </Button>
      </div>
      {result?.state === "sent" && (
        <p className="text-success flex items-center gap-1.5 text-xs">
          <CheckCircle2Icon className="size-3.5" /> Sent{result.error ? ` — ${result.error.message}` : ". Check your inbox/Telegram."}
        </p>
      )}
      {result?.state === "preview" && (
        <p className="flex items-center gap-1.5 text-xs">
          <EyeIcon className="size-3.5" /> Preview mode — nothing was sent.{" "}
          <Link href={`${previewHref}?id=${result.previewId}`} className="font-medium underline underline-offset-4">
            See exactly what would have been sent →
          </Link>
        </p>
      )}
      {(result?.state === "failed" || result?.state === "skipped") && (
        <div className="border-destructive/40 bg-destructive/5 rounded-md border p-2 text-xs">
          <p className="text-destructive flex items-center gap-1.5 font-medium">
            <AlertTriangleIcon className="size-3.5" /> {result.error?.message ?? "Failed"}
          </p>
          {result.error?.hint && <p className="mt-1">{result.error.hint}</p>}
        </div>
      )}
    </div>
  );
}
