"use server";

import { revalidatePath } from "next/cache";
import { REPORT_KINDS, type ReportKind } from "@siteguard/core";
import { JobState, jobKeys } from "@siteguard/db";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/session";

/** Ask the worker to generate and send a report now (it picks the request up within a minute). */
export async function requestReport(kind: ReportKind): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireAdmin();
  if (!REPORT_KINDS.includes(kind)) return { ok: false, error: "Unknown report type" };
  await db();
  await JobState.updateOne(
    { key: jobKeys.global("report-request") },
    { $set: { kind: "global", data: { kind, requestedBy: session.user.name, requestedAt: new Date().toISOString() } } },
    { upsert: true },
  );
  revalidatePath("/reports");
  return { ok: true };
}
