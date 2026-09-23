import { hostname } from "node:os";

/** Identifies this worker process in job locks. */
export const WORKER_ID = `${hostname()}:${process.pid}`;
