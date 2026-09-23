import PQueue from "p-queue";
import type { QueueName } from "../checks/types";

/** Concurrency limits sized for the 2-OCPU / 12 GB free VM. */
export const queues: Record<QueueName, PQueue> = {
  http: new PQueue({ concurrency: 10 }),
  browser: new PQueue({ concurrency: 1 }),
  psi: new PQueue({ concurrency: 2 }),
};

/** How many more jobs to claim: keep at most one extra "wave" queued behind the running ones. */
export function freeSlots(q: PQueue): number {
  return Math.max(0, q.concurrency * 2 - q.size - q.pending);
}
