import { EMAIL_CATEGORIES, RETENTION } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { DAY_SECONDS, defineModel, type Lean } from "../model-utils";

/** Every email attempt. The Brevo daily quota counter is computed from `day`. */
const emailLogSchema = new Schema(
  {
    sentAt: { type: Date, default: Date.now },
    /** YYYY-MM-DD in the configured timezone (quota resets at local midnight). */
    day: { type: String, required: true },
    category: { type: String, enum: EMAIL_CATEGORIES, required: true },
    to: { type: [String], default: [] },
    subject: { type: String, default: "" },
    provider: { type: String, default: "brevo" },
    status: { type: String, enum: ["sent", "failed", "skipped_quota"], required: true },
    messageId: String,
    error: String,
  },
  { collection: "emailLog", versionKey: false },
);

emailLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: RETENTION.emailLogDays * DAY_SECONDS });
emailLogSchema.index({ day: 1, status: 1, category: 1 });

export type EmailLogDoc = InferSchemaType<typeof emailLogSchema>;
export type EmailLogLean = Lean<EmailLogDoc>;

export const EmailLog = defineModel("EmailLog", () => model("EmailLog", emailLogSchema));
