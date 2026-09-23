import { Cron } from "croner";
import { ACTIVE_CHECK_TYPES } from "@siteguard/core";
import { connectDb, disconnectDb, ensureIndexes, getSettings } from "@siteguard/db";
import { createNotifyContext, dispatchPendingAlerts, emailStatus, notifyConfigFromEnv, telegramStatus } from "@siteguard/notify";
import { env } from "./env";
import { logger } from "./logger";
import { checkStability, sendReminders } from "./incidents/engine";
import { pingExternalHeartbeat, writeHeartbeat } from "./jobs/heartbeat";
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
