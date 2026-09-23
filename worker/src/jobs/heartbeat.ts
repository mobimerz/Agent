import { USER_AGENT } from "@siteguard/core";
import { JobState, jobKeys } from "@siteguard/db";
import { env } from "../env";
import type { Logger } from "../logger";
import { WORKER_ID } from "../worker-id";

/** Internal heartbeat: /api/health reads this to know the worker is alive. */
export async function writeHeartbeat(): Promise<void> {
  const now = new Date();
  await JobState.updateOne(
    { key: jobKeys.heartbeat },
    {
      $set: { kind: "global", lastRunAt: now, lastFinishedAt: now, lockedBy: WORKER_ID, data: { pid: process.pid, uptimeSec: Math.round(process.uptime()) } },
      $inc: { runCount: 1 },
    },
    { upsert: true },
  );
}

/** External dead-man's switch (Healthchecks.io etc.). Optional. */
export async function pingExternalHeartbeat(log: Logger): Promise<void> {
  if (!env.HEARTBEAT_PING_URL) return;
  try {
    const res = await fetch(env.HEARTBEAT_PING_URL, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log.warn({ status: res.status }, "heartbeat ping returned non-2xx");
  } catch (err) {
    log.warn({ err }, "heartbeat ping failed");
  }
}
