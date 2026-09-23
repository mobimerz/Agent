import { ALERT_TYPES, CHECK_TYPES, DELIVERY_STATES, SEVERITIES } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { DAY_SECONDS, defineModel, type Lean } from "../model-utils";

/**
 * Outgoing alert, fanned out to email and Telegram by the worker's alert
 * dispatcher (which applies grouping, digest mode and the Brevo quota).
 * In-app notifications are written immediately and don't go through here.
 */
const alertEventSchema = new Schema(
  {
    type: { type: String, enum: ALERT_TYPES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    siteId: { type: Schema.Types.ObjectId, ref: "Site" },
    incidentId: { type: Schema.Types.ObjectId, ref: "Incident" },
    checkType: { type: String, enum: [...CHECK_TYPES, null], default: null },
    /** Snapshot used to render the message (site name, reason, times, link…). */
    data: { type: Schema.Types.Mixed, required: true },
    /** Hack/spam and worker-offline alerts skip grouping/digest. */
    priority: { type: Boolean, default: false },
    channels: {
      email: { type: String, enum: DELIVERY_STATES, default: "pending" },
      telegram: { type: String, enum: DELIVERY_STATES, default: "pending" },
    },
    deliveryErrors: {
      email: String,
      telegram: String,
    },
    processedAt: Date,
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "alertEvents", versionKey: false },
);

alertEventSchema.index({ "channels.email": 1, createdAt: 1 });
alertEventSchema.index({ "channels.telegram": 1, createdAt: 1 });
alertEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * DAY_SECONDS });

export type AlertEventDoc = InferSchemaType<typeof alertEventSchema>;
export type AlertEventLean = Lean<AlertEventDoc>;

export const AlertEvent = defineModel("AlertEvent", () => model("AlertEvent", alertEventSchema));
