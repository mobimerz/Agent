import mongoose from "mongoose";
import { connectDb } from "./connection";
import { CheckResult } from "./models/check-result";
import { EmailLog } from "./models/email-log";
import { Incident } from "./models/incident";
import { Invite } from "./models/invite";
import { JobState } from "./models/job-state";
import { MaintenanceWindow } from "./models/maintenance-window";
import { Notification } from "./models/notification";
import { Report } from "./models/report";
import { Settings } from "./models/settings";
import { Site } from "./models/site";
import { UptimeHourly } from "./models/uptime-hourly";

const ALL_MODELS = [
  Site,
  CheckResult,
  UptimeHourly,
  Incident,
  Notification,
  Report,
  Settings,
  JobState,
  EmailLog,
  MaintenanceWindow,
  Invite,
];

/**
 * Create collections (incl. the time-series one, which must exist before any
 * insert) and bring indexes in line with the schemas. Idempotent; run on
 * worker start and via `pnpm db:indexes`.
 */
export async function ensureIndexes(): Promise<Record<string, string[]>> {
  await connectDb();
  const report: Record<string, string[]> = {};
  for (const m of ALL_MODELS) {
    await m.createCollection().catch((err: { codeName?: string }) => {
      if (err.codeName !== "NamespaceExists") throw err;
    });
    const dropped = await m.syncIndexes();
    report[m.collection.collectionName] = dropped;
  }
  return report;
}

export async function listIndexes(): Promise<Record<string, string[]>> {
  await connectDb();
  const out: Record<string, string[]> = {};
  for (const m of mongoose.modelNames().map((n) => mongoose.model(n))) {
    const idx = await m.collection.indexes();
    out[m.collection.collectionName] = idx.map((i) => i.name ?? "");
  }
  return out;
}
