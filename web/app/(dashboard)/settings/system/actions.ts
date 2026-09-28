"use server";

import { revalidatePath } from "next/cache";
import { resolveFromRoot } from "@siteguard/core/env";
import { createBackup, JobState, jobKeys, pruneBackups } from "@siteguard/db";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireAdmin } from "@/lib/session";

/** Manual backup from the dashboard (same format as the worker's nightly one). Restore stays CLI-only on purpose. */
export async function backupNow(): Promise<{ ok: true; name: string; documents: number } | { ok: false; error: string }> {
  await requireAdmin();
  await db();
  try {
    const dir = resolveFromRoot(env.BACKUP_DIR);
    const b = await createBackup(dir);
    const removed = await pruneBackups(dir, env.BACKUP_KEEP_DAYS);
    await JobState.updateOne(
      { key: jobKeys.global("backup") },
      { $set: { kind: "global", lastRunAt: b.createdAt, lastFinishedAt: new Date(), lastStatus: "OK", lastError: null, data: { name: b.name, documents: b.documents, bytes: b.bytes, removed, manual: true } } },
      { upsert: true },
    );
    revalidatePath("/settings/system");
    return { ok: true, name: b.name, documents: b.documents };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
