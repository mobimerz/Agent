import PQueue from "p-queue";
import { PSI } from "@siteguard/core";
import type { QueueName } from "../checks/types";
import { env } from "../env";

/** Concurrency limits sized for the 2-OCPU / 12 GB free VM. */
export const queues: Record<QueueName, PQueue> = {
  http: new PQueue({ concurrency: 10 }),
  browser: new PQueue({ concurrency: 1 }),
  // Keyless PSI has a tiny shared quota: strictly one site at a time.
  psi: new PQueue({ concurrency: env.PSI_API_KEY ? PSI.concurrencyWithKey : PSI.concurrencyNoKey }),
};

/**
 * How many more jobs to claim: keep at most one extra "wave" queued behind the
 * running ones — except PSI, whose runs take minutes: a queued PSI job could
 * outlive its 10-min lock and be claimed twice.
 */
export function freeSlots(q: PQueue): number {
  const waves = q === queues.psi ? 1 : 2;
  return Math.max(0, q.concurrency * waves - q.size - q.pending);
}
