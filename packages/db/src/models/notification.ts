import { NOTIFICATION_TYPES, RETENTION, SEVERITIES } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { DAY_SECONDS, defineModel, type Lean } from "../model-utils";

/**
 * In-app notifications. `userId` null = broadcast to every user (the normal
 * case for alerts); per-user read state lives in `readBy`.
 * The web app watches this collection with a Change Stream → SSE.
 */
const notificationSchema = new Schema(
  {
    userId: { type: String, default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    severity: { type: String, enum: SEVERITIES, default: "INFO" },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: String,
    siteId: { type: Schema.Types.ObjectId, ref: "Site" },
    incidentId: { type: Schema.Types.ObjectId, ref: "Incident" },
    readBy: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "notifications", versionKey: false },
);

notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION.notificationsDays * DAY_SECONDS });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ readBy: 1, createdAt: -1 });

export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
export type NotificationLean = Lean<NotificationDoc>;

export const Notification = defineModel("Notification", () => model("Notification", notificationSchema));
