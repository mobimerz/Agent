import { Cron } from "croner";
import { ACTIVE_CHECK_TYPES } from "@siteguard/core";
import { connectDb, disconnectDb, ensureIndexes, getSettings } from "@siteguard/db";
import { env } from "./env";
import { logger } from "./logger";
import { pingExternalHeartbeat, writeHeartbeat } from "./jobs/heartbeat";
import { Dispatcher, releaseStaleLocks } from "./scheduler/dispatcher";
import { reconcileJobs } from "./scheduler/reconcile";
import { WORKER_ID } from "./worker-id";

const crons: Cron[] = [];
const dispatcher = new Dispatcher(logger);

/** Wrap a job so one failure is logged and never crashes the process. */
function safe(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      logger.error({ err, job: name }, "job failed");
    }
  };
}

async function main() {
  logger.info({ workerId: WORKER_ID, tz: env.TIMEZONE }, "worker starting");
  await connectDb(env.MONGODB_URI);
  const dropped = await ensureIndexes();
  const droppedCount = Object.values(dropped).flat().length;
  if (droppedCount) logger.warn({ dropped }, "dropped stale indexes");
  await getSettings(); // creates the settings singleton with defaults on first boot
  logger.info("database ready");

  const released = await releaseStaleLocks();
  if (released) logger.info({ released }, "released locks from a previous run");
  await safe("reconcile", () => reconcileJobs(logger))();

  await safe("heartbeat", writeHeartbeat)();
  crons.push(
    new Cron("*/1 * * * *", { name: "heartbeat", protect: true }, safe("heartbeat", writeHeartbeat)),
    new Cron("*/5 * * * *", { name: "heartbeat-ping", protect: true }, safe("heartbeat-ping", () => pingExternalHeartbeat(logger))),
    new Cron("*/5 * * * *", { name: "reconcile", protect: true }, safe("reconcile", () => reconcileJobs(logger))),
  );
  await pingExternalHeartbeat(logger);

  dispatcher.start();
  logger.info({ checks: ACTIVE_CHECK_TYPES }, "worker running");
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  for (const c of crons) c.stop();
  await dispatcher.stop().catch((err: unknown) => logger.error({ err }, "error stopping dispatcher"));
  await disconnectDb().catch((err: unknown) => logger.error({ err }, "error closing db"));
  logger.info("bye");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));
process.on("uncaughtException", (err) => {
  // State is unknown after this; exit and let Docker (restart: unless-stopped) bring us back.
  logger.fatal({ err }, "uncaught exception");
  process.exit(1);
});

main().catch((err: unknown) => {
  logger.fatal({ err }, "worker failed to start");
  process.exit(1);
});
