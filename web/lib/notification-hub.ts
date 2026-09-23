import "server-only";
import { EventEmitter } from "node:events";
import { Notification } from "@siteguard/db";
import { db } from "./db";

export interface NotificationPayload {
  id: string;
  type: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
}

interface Hub {
  emitter: EventEmitter;
  started: boolean;
  stream?: { close: () => Promise<void> };
}

// One Change Stream per server process, fanned out to every SSE client
// (not one stream per browser tab). Survives dev hot reload via globalThis.
const g = globalThis as typeof globalThis & { __siteguardHub?: Hub };
const hub: Hub = (g.__siteguardHub ??= { emitter: new EventEmitter().setMaxListeners(1000), started: false });

async function start() {
  if (hub.started) return;
  hub.started = true;
  await db();
  const watch = () => {
    const stream = Notification.watch([{ $match: { operationType: "insert" } }], { fullDocument: "default" });
    hub.stream = stream;
    stream.on("change", (change: { fullDocument?: Record<string, unknown> }) => {
      const d = change.fullDocument;
      if (!d || d.userId) return; // broadcast notifications only (per-user ones: future)
      const payload: NotificationPayload = {
        id: String(d._id),
        type: String(d.type),
        severity: d.severity as NotificationPayload["severity"],
        title: String(d.title),
        body: String(d.body ?? ""),
        link: (d.link as string) ?? null,
        createdAt: new Date(d.createdAt as Date).toISOString(),
      };
      hub.emitter.emit("notification", payload);
    });
    stream.on("error", (err: Error) => {
      console.error("[notifications] change stream error, restarting in 5 s:", err.message);
      void stream.close().catch(() => {});
      setTimeout(watch, 5000);
    });
  };
  watch();
}

export function subscribe(listener: (n: NotificationPayload) => void): () => void {
  void start().catch((err: unknown) => {
    hub.started = false;
    console.error("[notifications] could not start change stream:", (err as Error).message);
  });
  hub.emitter.on("notification", listener);
  return () => hub.emitter.off("notification", listener);
}

export async function unreadCount(userId: string): Promise<number> {
  await db();
  return Notification.countDocuments({ userId: null, readBy: { $ne: userId } });
}
