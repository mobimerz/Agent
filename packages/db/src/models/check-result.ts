import { CHECK_REASONS, CHECK_STATUSES, CHECK_TYPES, RETENTION } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { DAY_SECONDS, defineModel, type Lean } from "../model-utils";

/**
 * Time-series collection of every check run. Raw data expires after 30 days;
 * uptime is rolled up into `uptimeHourly` before that.
 * Store trimmed metrics only — never raw Lighthouse JSON.
 */
const checkResultSchema = new Schema(
  {
    checkedAt: { type: Date, required: true },
    meta: {
      type: new Schema(
        {
          siteId: { type: Schema.Types.ObjectId, required: true },
          checkType: { type: String, enum: CHECK_TYPES, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    status: { type: String, enum: CHECK_STATUSES, required: true },
    reason: { type: String, enum: CHECK_REASONS, default: "ok" },
    message: { type: String, default: "" },
    durationMs: Number,
    target: String,
    /** 0 = scheduled run, 1..n = confirmation re-check after a FAIL. */
    attempt: { type: Number, default: 0 },
    metrics: { type: Schema.Types.Mixed, default: {} },
    details: Schema.Types.Mixed,
  },
  {
    collection: "checkResults",
    versionKey: false,
    autoCreate: true,
    timeseries: { timeField: "checkedAt", metaField: "meta", granularity: "minutes" },
    expireAfterSeconds: RETENTION.checkResultsDays * DAY_SECONDS,
  },
);

// MongoDB auto-creates {meta, checkedAt}; this one serves "latest N for a site/type".
checkResultSchema.index({ "meta.siteId": 1, "meta.checkType": 1, checkedAt: -1 });

export type CheckResultDoc = InferSchemaType<typeof checkResultSchema>;
export type CheckResultLean = Lean<CheckResultDoc>;

export const CheckResult = defineModel("CheckResult", () => model("CheckResult", checkResultSchema));
