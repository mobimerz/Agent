import { CHECK_STATUSES, CHECK_TYPES } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { defineModel, type Lean } from "../model-utils";

/**
 * Scheduler state, one document per job:
 *   check:<siteId>:<checkType>   per-site check
 *   global:<name>                 reports, rollups, heartbeat…
 * The worker claims a due job atomically by setting `lockedUntil`, so a restart
 * (or a second worker) can't double-run it and a crashed run's lock simply expires.
 */
const jobStateSchema = new Schema(
  {
    key: { type: String, required: true },
    kind: { type: String, enum: ["check", "global"], required: true },
    siteId: { type: Schema.Types.ObjectId, ref: "Site" },
    checkType: { type: String, enum: [...CHECK_TYPES, null], default: null },
    intervalSec: Number,
    enabled: { type: Boolean, default: true },

    nextRunAt: { type: Date, default: () => new Date() },
    lastRunAt: Date,
    lastFinishedAt: Date,
    lastDurationMs: Number,
    lastStatus: { type: String, enum: [...CHECK_STATUSES, null], default: null },
    lastError: String,
    runCount: { type: Number, default: 0 },

    /** Confirmation logic: consecutive FAIL results (reset on OK/WARN). */
    consecutiveFails: { type: Number, default: 0 },

    lockedUntil: { type: Date, default: () => new Date(0) },
    lockedBy: String,

    /** Free-form per-job memory (e.g. DNS baseline, last page size). */
    data: Schema.Types.Mixed,
  },
  { timestamps: true, collection: "jobsState" },
);

jobStateSchema.index({ key: 1 }, { unique: true });
jobStateSchema.index({ enabled: 1, nextRunAt: 1, lockedUntil: 1 });
jobStateSchema.index({ siteId: 1 });

export type JobStateDoc = InferSchemaType<typeof jobStateSchema>;
export type JobStateLean = Lean<JobStateDoc>;

export const JobState = defineModel("JobState", () => model("JobState", jobStateSchema));

export const jobKeys = {
  check: (siteId: string, checkType: string) => `check:${siteId}:${checkType}`,
  global: (name: string) => `global:${name}`,
  heartbeat: "global:heartbeat",
};
