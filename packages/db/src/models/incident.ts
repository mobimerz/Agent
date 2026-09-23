import { CHECK_TYPES, INCIDENT_STATUSES, SEVERITIES } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { defineModel, type Lean } from "../model-utils";

const noteSchema = new Schema(
  {
    userId: { type: String, required: true },
    userName: String,
    text: { type: String, required: true, maxlength: 2000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const incidentSchema = new Schema(
  {
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true },
    checkType: { type: String, enum: CHECK_TYPES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: "OPEN" },
    /**
     * true while OPEN or ACKNOWLEDGED. Backs the unique partial index that
     * guarantees at most ONE open incident per site + check type.
     */
    isOpen: { type: Boolean, default: true },
    title: { type: String, required: true },
    message: { type: String, default: "" },
    target: String,
    startedAt: { type: Date, required: true },
    acknowledgedAt: Date,
    acknowledgedBy: String,
    resolvedAt: Date,
    durationSec: Number,
    lastRemindedAt: Date,
    remindersSent: { type: Number, default: 0 },
    lastMetrics: Schema.Types.Mixed,
    notes: { type: [noteSchema], default: [] },
  },
  { timestamps: true, collection: "incidents" },
);

incidentSchema.index(
  { siteId: 1, checkType: 1 },
  { unique: true, partialFilterExpression: { isOpen: true }, name: "one_open_incident_per_site_check" },
);
incidentSchema.index({ siteId: 1, status: 1, startedAt: -1 });
incidentSchema.index({ status: 1, severity: 1, startedAt: -1 });
incidentSchema.index({ startedAt: -1 });

incidentSchema.pre("save", function () {
  this.isOpen = this.status !== "RESOLVED";
});

export type IncidentDoc = InferSchemaType<typeof incidentSchema>;
export type IncidentLean = Lean<IncidentDoc>;

export const Incident = defineModel("Incident", () => model("Incident", incidentSchema));
