import { Cron } from "croner";
import { ACTIVE_CHECK_TYPES } from "@siteguard/core";
import { connectDb, disconnectDb, ensureIndexes, getSettings } from "@siteguard/db";
import { createNotifyContext, dispatchPendingAlerts, emailStatus, notifyConfigFromEnv, telegramStatus } from "@siteguard/notify";
import { env } from "./env";
import { logger } from "./logger";
import { checkStability, sendReminders } from "./incidents/engine";
import { runBackup } from "./jobs/backup";
import { pingExternalHeartbeat, writeHeartbeat } from "./jobs/heartbeat";
import { runRollup } from "./jobs/rollup";
import { reportTick } from "./reports";
import { closeBrowser } from "./lib/browser";
import { Dispatcher, releaseStaleLocks } from "./scheduler/dispatcher";
import { reconcileJobs } from "./scheduler/reconcile";
import { getSettingsCached } from "./settings-cache";
import { WORKER_ID } from "./worker-id";

const crons: Cron[] = [];
const notifyConfig = notifyConfigFromEnv(env);
const dispatcher = new Dispatcher(logger, notifyConfig);

async function deliverAlerts() {
  const ctx = await createNotifyContext(notifyConfig, { settings: await getSettingsCached(), log: logger.child({ mod: "alerts" }) });
  const n = await dispatchPendingAlerts(ctx);
  if (n.email || n.telegram) logger.debug(n, "alerts dispatched");
}

async function incidentHousekeeping() {
  const deps = { settings: await getSettingsCached(), config: notifyConfig, log: logger };
  const reminders = await sendReminders(deps);
  const stable = await checkStability(deps);
  if (reminders || stable) logger.info({ reminders, stable }, "incident housekeeping");
}

async function sendDueReports() {
  await reportTick({ settings: await getSettingsCached(), config: notifyConfig, log: logger });
}

async function rollup() {
  const r = await runRollup();
  if (r.backfilled) logger.info({ hours: r.hours }, "uptime rollups backfilled");
}

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

/**
 * `pnpm dev` starts db, web and worker together: the replica set may still be
 * electing its primary ("not primary") for a few seconds. Retry instead of dying.
 */
async function waitForWritableDb<T>(fn: () => Promise<T>, timeoutMs = 90_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { codeName?: string; name?: string };
      const transient = e.codeName === "NotWritablePrimary" || e.codeName === "NotPrimaryNoSecondaryOk" || e.name === "MongoServerSelectionError";
      if (!transient || Date.now() - started > timeoutMs) throw err;
      logger.info("waiting for MongoDB to become primary…");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  logger.info({ workerId: WORKER_ID, tz: env.TIMEZONE }, "worker starting");
  await connectDb(env.MONGODB_URI);
  const dropped = await waitForWritableDb(ensureIndexes);
  const droppedCount = Object.values(dropped).flat().length;
  if (droppedCount) logger.warn({ dropped }, "dropped stale indexes");
  const settings = await getSettings(); // creates the settings singleton with defaults on first boot
  logger.info("database ready");
  const email = emailStatus(notifyConfig, settings);
  const telegram = telegramStatus(notifyConfig, settings);
  // Missing keys are fine: channels just stay in preview mode.
  logger.info({ email: email.mode, telegram: telegram.mode }, email.mode === "live" && telegram.mode === "live" ? "alert channels live" : "alert channels in PREVIEW mode (see /dev/emails, /dev/telegram)");

  const released = await releaseStaleLocks();
  if (released) logger.info({ released }, "released locks from a previous run");
  await safe("reconcile", () => reconcileJobs(logger))();

  await safe("heartbeat", writeHeartbeat)();
  crons.push(
    new Cron("*/1 * * * *", { name: "heartbeat", protect: true }, safe("heartbeat", writeHeartbeat)),
    new Cron("*/5 * * * *", { name: "heartbeat-ping", protect: true }, safe("heartbeat-ping", () => pingExternalHeartbeat(logger))),
    new Cron("*/5 * * * *", { name: "reconcile", protect: true }, safe("reconcile", () => reconcileJobs(logger))),
    new Cron("*/15 * * * * *", { name: "alerts", protect: true }, safe("alerts", deliverAlerts)),
    new Cron("30 * * * * *", { name: "incident-housekeeping", protect: true }, safe("incident-housekeeping", incidentHousekeeping)),
    new Cron("10 * * * * *", { name: "reports", protect: true }, safe("reports", sendDueReports)),
    new Cron("5 * * * *", { name: "rollup", protect: true }, safe("rollup", rollup)),
    new Cron("30 2 * * *", { name: "backup", protect: true, timezone: env.TIMEZONE }, safe("backup", () => runBackup(logger))),
  );
  // First start backfills the hourly rollups from all raw results still in retention.
  void safe("rollup", rollup)();
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
  await closeBrowser();
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
