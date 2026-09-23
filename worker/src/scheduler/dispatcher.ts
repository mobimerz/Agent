import { hostname } from "node:os";
import { Cron } from "croner";
import type { CheckType } from "@siteguard/core";
import { JobState, type JobStateLean } from "@siteguard/db";
import { CHECKS } from "../checks";
import type { QueueName } from "../checks/types";
import type { Logger } from "../logger";
import { getSettingsCached } from "../settings-cache";
import { WORKER_ID } from "../worker-id";
import { freeSlots, queues } from "./queues";
import { runCheckJob } from "./runner";

/** A claimed job not finished within this window is considered abandoned and re-claimable. */
const LOCK_MS = 10 * 60_000;

function typesForQueue(queue: QueueName): CheckType[] {
  return Object.values(CHECKS)
    .filter((m) => m.queue === queue)
    .map((m) => m.type);
}

/** Atomically claim the most overdue job of the given types. */
export async function claimNextJob(types: CheckType[], now = new Date()): Promise<JobStateLean | null> {
  if (!types.length) return null;
  return JobState.findOneAndUpdate(
    { kind: "check", enabled: true, checkType: { $in: types }, nextRunAt: { $lte: now }, lockedUntil: { $lte: now } },
    { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS), lockedBy: WORKER_ID } },
    { sort: { nextRunAt: 1 }, returnDocument: "after" },
  ).lean();
}

/**
 * Release locks left by a previous process on this same host (container
 * restart / crash), so monitoring resumes immediately instead of after LOCK_MS.
 */
export async function releaseStaleLocks(): Promise<number> {
  const res = await JobState.updateMany(
    { lockedBy: { $regex: `^${hostname().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, $ne: WORKER_ID }, lockedUntil: { $gt: new Date() } },
    { $set: { lockedUntil: new Date(0), lockedBy: null } },
  );
  return res.modifiedCount;
}

export class Dispatcher {
  private cron: Cron | null = null;
  private ticking = false;

  constructor(private readonly log: Logger) {}

  start() {
    // Every 3 s: cheap indexed query; keeps "Run check now" snappy.
    this.cron = new Cron("*/3 * * * * *", { name: "dispatcher", protect: true }, () => this.tick());
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const settings = await getSettingsCached();
      for (const [name, queue] of Object.entries(queues) as [QueueName, (typeof queues)[QueueName]][]) {
        const types = typesForQueue(name);
        for (let free = freeSlots(queue); free > 0; free--) {
          const job = await claimNextJob(types);
          if (!job) break;
          void queue.add(() => runCheckJob(job, { settings, log: this.log }));
        }
      }
    } catch (err) {
      this.log.error({ err }, "dispatcher tick failed");
    } finally {
      this.ticking = false;
    }
  }

  /** Stop claiming, let running checks finish (bounded), release anything not started. */
  async stop(graceMs = 20_000): Promise<void> {
    this.cron?.stop();
    for (const q of Object.values(queues)) q.clear();
    await Promise.race([Promise.all(Object.values(queues).map((q) => q.onIdle())), new Promise((r) => setTimeout(r, graceMs))]);
    await JobState.updateMany({ lockedBy: WORKER_ID }, { $set: { lockedUntil: new Date(0), lockedBy: null } });
  }
}
