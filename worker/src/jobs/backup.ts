import { resolveFromRoot } from "@siteguard/core/env";
import { createBackup, JobState, jobKeys, pruneBackups } from "@siteguard/db";
import { createInAppNotification } from "@siteguard/notify";
import { env } from "../env";
import type { Logger } from "../logger";

export const BACKUP_JOB_KEY = jobKeys.global("backup");

/** Nightly: full database backup into BACKUP_DIR, then drop backups older than BACKUP_KEEP_DAYS. */
export async function runBackup(log: Logger): Promise<void> {
  const dir = resolveFromRoot(env.BACKUP_DIR);
  const started = new Date();
  try {
    const b = await createBackup(dir, started);
    const removed = await pruneBackups(dir, env.BACKUP_KEEP_DAYS, started);
    await JobState.updateOne(
      { key: BACKUP_JOB_KEY },
      {
        $set: { kind: "global", lastRunAt: started, lastFinishedAt: new Date(), lastStatus: "OK", lastError: null, data: { name: b.name, documents: b.documents, bytes: b.bytes, removed } },
        $inc: { runCount: 1 },
      },
      { upsert: true },
    );
    log.info({ backup: b.name, documents: b.documents, kb: Math.round(b.bytes / 1024), removed }, "database backup done");
  } catch (err) {
    const message = (err as Error).message;
    await JobState.updateOne({ key: BACKUP_JOB_KEY }, { $set: { kind: "global", lastRunAt: started, lastStatus: "FAIL", lastError: message } }, { upsert: true });
    await createInAppNotification({ type: "system", severity: "CRITICAL", title: "Nightly database backup failed", body: message, link: "/settings/system" });
    log.error({ err }, "database backup failed");
  }
}
