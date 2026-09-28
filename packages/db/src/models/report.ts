import { REPORT_KINDS } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { defineModel, type Lean } from "../model-utils";

/** Snapshot of each morning/night report, so the next one can show "changes since last report". */
const reportSchema = new Schema(
  {
    kind: { type: String, enum: REPORT_KINDS, required: true },
    /** YYYY-MM-DD in the configured timezone. */
    date: { type: String, required: true },
    generatedAt: { type: Date, default: Date.now },
    /** Window the report covers: since the previous report (or 12 h). */
    periodStart: Date,
    periodEnd: Date,
    /** Generated on demand ("Send report now") rather than on schedule. */
    manual: { type: Boolean, default: false },
    /** Changes since the previous report (went down, recovered, new expiries…). */
    changes: { type: [Schema.Types.Mixed], default: [] },
    /** Incidents opened / resolved in the period. */
    incidents: { type: Schema.Types.Mixed, default: {} },
    summary: {
      total: Number,
      up: Number,
      down: Number,
      degraded: Number,
      openIncidents: Number,
      paused: Number,
      blocked: Number,
      avgUptime: Number,
      headline: String,
    },
    sites: { type: [Schema.Types.Mixed], default: [] },
    delivery: {
      email: { type: String, enum: ["sent", "preview", "failed", "skipped", null], default: null },
      telegram: { type: String, enum: ["sent", "preview", "failed", "skipped", null], default: null },
      inApp: { type: Boolean, default: false },
    },
  },
  { collection: "reports", versionKey: false },
);

// One scheduled report per kind and day; manual ones are extra.
reportSchema.index({ kind: 1, date: 1 }, { unique: true, partialFilterExpression: { manual: false }, name: "one_scheduled_report_per_day" });
reportSchema.index({ generatedAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60, name: "reports_ttl_1y" });
reportSchema.index({ generatedAt: -1 });

export type ReportDoc = InferSchemaType<typeof reportSchema>;
export type ReportLean = Lean<ReportDoc>;

export const Report = defineModel("Report", () => model("Report", reportSchema));
