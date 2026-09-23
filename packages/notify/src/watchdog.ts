import { DEFAULTS, formatAlertTime, formatDuration, type AlertData } from "@siteguard/core";
import { JobState, jobKeys } from "@siteguard/db";
import { deliverAlertNow, queueAlert } from "./alerts";
import type { NotifyContext } from "./context";

const WATCHDOG_KEY = "global:watchdog";

export interface WatchdogResult {
  state: "ok" | "offline_alerted" | "offline_already_alerted" | "back_online";
  lastSeen: Date | null;
}

/**
 * Runs in the WEB process (the worker can't report its own death).
 * If the worker heartbeat is older than `watchdogStaleMin` (15), raise ONE
 * CRITICAL alert and deliver it directly from here — in-app + Telegram + email.
 * When the heartbeat returns, announce "back online" once.
 */
export async function runWorkerWatchdog(ctx: NotifyContext, opts: { processStartedAt: Date }): Promise<WatchdogResult> {
  const now = ctx.now();
  const staleMin = ctx.settings.alerts?.watchdogStaleMin ?? DEFAULTS.watchdogStaleMin;
  const hb = await JobState.findOne({ key: jobKeys.heartbeat }, { lastRunAt: 1 }).lean();
  const lastSeen = hb?.lastRunAt ?? null;
  // Never saw a heartbeat → measure from when this web process started (fresh installs).
  const reference = lastSeen ?? opts.processStartedAt;
  const stale = now.getTime() - reference.getTime() > staleMin * 60_000;

  const state = await JobState.findOne({ key: WATCHDOG_KEY }).lean();
  const alertedAt = (state?.data as { offlineAlertedAt?: Date } | undefined)?.offlineAlertedAt ?? null;

  const base: Omit<AlertData, "type" | "severity" | "title" | "message"> = {
    link: `${ctx.config.appUrl}/`,
    extra: [{ label: "Last heartbeat", value: lastSeen ? formatAlertTime(lastSeen, ctx.config.timeZone) : "never" }],
  };

  if (stale && !alertedAt) {
    const down = Math.round((now.getTime() - reference.getTime()) / 1000);
    const event = await queueAlert({
      data: {
        ...base,
        type: "worker_offline",
        severity: "CRITICAL",
        title: "Monitoring worker is offline",
        message: `No heartbeat for ${formatDuration(down)} — no checks are running and no site alerts will be sent until it is back.`,
        startedAt: reference.toISOString(),
      },
      channels: { email: true, telegram: true, inApp: true },
      priority: true,
    });
    // Deliver immediately from the web process — the worker's dispatcher is dead.
    await deliverAlertNow(ctx, event.toObject());
    await JobState.updateOne({ key: WATCHDOG_KEY }, { $set: { kind: "global", data: { offlineAlertedAt: now } } }, { upsert: true });
    return { state: "offline_alerted", lastSeen };
  }

  if (stale) return { state: "offline_already_alerted", lastSeen };

  if (alertedAt) {
    const outage = Math.round((now.getTime() - new Date(alertedAt).getTime()) / 1000);
    // Worker is back: its own dispatcher will deliver this within seconds.
    await queueAlert({
      data: { ...base, type: "worker_online", severity: "INFO", title: "Monitoring worker is back online", message: "Checks and alerts have resumed.", durationSec: outage },
      channels: { email: false, telegram: true, inApp: true },
    });
    await JobState.updateOne({ key: WATCHDOG_KEY }, { $set: { data: { offlineAlertedAt: null } } });
    return { state: "back_online", lastSeen };
  }
  return { state: "ok", lastSeen };
}
