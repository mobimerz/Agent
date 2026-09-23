import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Invite, type InviteLean } from "@siteguard/db";
import { db } from "./db";
import { env } from "./env";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function newInviteToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export const inviteUrl = (token: string) => new URL(`/invite/${token}`, env.APP_URL).toString();

export type InviteState = "valid" | "expired" | "used" | "revoked" | "not_found";

export function inviteState(invite: Pick<InviteLean, "expiresAt" | "acceptedAt" | "revokedAt"> | null): InviteState {
  if (!invite) return "not_found";
  if (invite.revokedAt) return "revoked";
  if (invite.acceptedAt) return "used";
  if (invite.expiresAt.getTime() < Date.now()) return "expired";
  return "valid";
}

export async function findInviteByToken(token: string) {
  await db();
  const invite = await Invite.findOne({ tokenHash: hashToken(token) }).lean();
  return { invite, state: inviteState(invite) };
}
