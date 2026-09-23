/**
 * Worker watchdog, started once per web server from instrumentation.ts.
 * (No "server-only" import: instrumentation isn't a React server module.)
 */
import { parseEnv, webEnvSchema } from "@siteguard/core/env";
import { connectDb, getSettings } from "@siteguard/db";
import { createNotifyContext, notifyConfigFromEnv, runWorkerWatchdog } from "@siteguard/notify";

const g = globalThis as typeof globalThis & { __siteguardWatchdog?: NodeJS.Timeout };

export function startWorkerWatchdog(intervalMs = 60_000) {
  if (g.__siteguardWatchdog) return; // dev hot reload / double register
  let env;
  try {
    env = parseEnv(webEnvSchema);
  } catch (err) {
    console.error("[watchdog] not started — invalid env:", (err as Error).message);
    return;
  }
  const config = notifyConfigFromEnv(env);
  const processStartedAt = new Date();
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await connectDb(env.MONGODB_URI);
      const ctx = await createNotifyContext(config, { settings: await getSettings() });
      const res = await runWorkerWatchdog(ctx, { processStartedAt });
      if (res.state === "offline_alerted") console.warn("[watchdog] worker offline — alert sent");
      if (res.state === "back_online") console.info("[watchdog] worker back online");
    } catch (err) {
      console.error("[watchdog] tick failed:", (err as Error).message);
    } finally {
      running = false;
    }
  };

  g.__siteguardWatchdog = setInterval(tick, intervalMs);
  g.__siteguardWatchdog.unref();
}
