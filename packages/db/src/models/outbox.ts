import { EMAIL_CATEGORIES } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { DAY_SECONDS, defineModel, type Lean } from "../model-utils";

/**
 * Every message produced while a channel is in PREVIEW (dry-run) mode: the
 * exact rendered email HTML / Telegram text that WOULD have been sent.
 * Viewable at /dev/emails and /dev/telegram. Real sends only go to emailLog.
 */
const outboxSchema = new Schema(
  {
    channel: { type: String, enum: ["email", "telegram"], required: true },
    category: { type: String, enum: EMAIL_CATEGORIES, required: true },
    to: { type: [String], default: [] },
    subject: String,
    html: String,
    text: { type: String, default: "" },
    /** Exact JSON body the real API call would have used (secrets excluded). */
    request: Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "outbox", versionKey: false },
);

outboxSchema.index({ channel: 1, createdAt: -1 });
outboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * DAY_SECONDS });

export type OutboxDoc = InferSchemaType<typeof outboxSchema>;
export type OutboxLean = Lean<OutboxDoc>;

export const Outbox = defineModel("Outbox", () => model("Outbox", outboxSchema));
