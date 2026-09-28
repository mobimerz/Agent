import { RETENTION } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { DAY_SECONDS, defineModel, type Lean } from "../model-utils";

/** Hourly uptime rollup, kept for a year (raw checkResults expire after 30 days). */
const uptimeHourlySchema = new Schema(
  {
    siteId: { type: Schema.Types.ObjectId, required: true },
    /** Start of the hour (UTC). */
    hour: { type: Date, required: true },
    total: { type: Number, default: 0 },
    up: { type: Number, default: 0 },
    down: { type: Number, default: 0 },
    /** WARN results (slow, blocked, important page failing) — up, but degraded. */
    warn: { type: Number, default: 0 },
    avgResponseMs: Number,
    p95ResponseMs: Number,
    minResponseMs: Number,
    maxResponseMs: Number,
  },
  { collection: "uptimeHourly", versionKey: false },
);

uptimeHourlySchema.index({ siteId: 1, hour: 1 }, { unique: true });
uptimeHourlySchema.index({ hour: 1 }, { expireAfterSeconds: RETENTION.uptimeHourlyDays * DAY_SECONDS });

export type UptimeHourlyDoc = InferSchemaType<typeof uptimeHourlySchema>;
export type UptimeHourlyLean = Lean<UptimeHourlyDoc>;

export const UptimeHourly = defineModel("UptimeHourly", () => model("UptimeHourly", uptimeHourlySchema));
