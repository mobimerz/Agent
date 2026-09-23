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
    summary: {
      total: Number,
      up: Number,
      down: Number,
      degraded: Number,
      openIncidents: Number,
      headline: String,
    },
    sites: { type: [Schema.Types.Mixed], default: [] },
    delivery: {
      email: { type: String, enum: ["sent", "failed", "skipped", null], default: null },
      telegram: { type: String, enum: ["sent", "failed", "skipped", null], default: null },
      inApp: { type: Boolean, default: false },
    },
  },
  { collection: "reports", versionKey: false },
);

reportSchema.index({ kind: 1, date: 1 }, { unique: true });
reportSchema.index({ generatedAt: -1 });

export type ReportDoc = InferSchemaType<typeof reportSchema>;
export type ReportLean = Lean<ReportDoc>;

export const Report = defineModel("Report", () => model("Report", reportSchema));
