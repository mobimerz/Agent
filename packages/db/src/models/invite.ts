import { ROLES } from "@siteguard/core";
import { Schema, model, type InferSchemaType } from "mongoose";
import { defineModel, type Lean } from "../model-utils";

/**
 * Admin-issued invitation. Only the SHA-256 of the token is stored; the raw
 * token exists only in the link shown to the admin once.
 */
const inviteSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES, default: "member" },
    tokenHash: { type: String, required: true },
    invitedBy: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
    revokedAt: Date,
  },
  { timestamps: true, collection: "invites" },
);

inviteSchema.index({ tokenHash: 1 }, { unique: true });
inviteSchema.index({ email: 1, createdAt: -1 });
// Remove expired/used invites a day after expiry.
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export type InviteDoc = InferSchemaType<typeof inviteSchema>;
export type InviteLean = Lean<InviteDoc>;

export const Invite = defineModel("Invite", () => model("Invite", inviteSchema));
