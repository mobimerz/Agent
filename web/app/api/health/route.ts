import { JobState, jobKeys, pingDb } from "@siteguard/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Worker writes a heartbeat every minute; older than this = worker considered down. */
const WORKER_STALE_SEC = 180;

/**
 * Public health endpoint for an external monitor (UptimeRobot / Healthchecks.io).
 * 200 = DB reachable and worker alive, 503 otherwise. Exposes no sensitive data.
 */
export async function GET() {
  const dbOk = await pingDb();
  let workerAgeSec: number | null = null;

  if (dbOk) {
    await db();
    const hb = await JobState.findOne({ key: jobKeys.heartbeat }, { lastRunAt: 1 }).lean();
    if (hb?.lastRunAt) workerAgeSec = Math.round((Date.now() - hb.lastRunAt.getTime()) / 1000);
  }

  const workerOk = workerAgeSec !== null && workerAgeSec < WORKER_STALE_SEC;
  const ok = dbOk && workerOk;

  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      db: dbOk ? "ok" : "down",
      worker: workerOk ? "ok" : "down",
      workerLastSeenSec: workerAgeSec,
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
