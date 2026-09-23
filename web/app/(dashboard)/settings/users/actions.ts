"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RETENTION, ROLES } from "@siteguard/core";
import { Invite, mongoose } from "@siteguard/db";
import { db } from "@/lib/db";
import { sendInviteEmail } from "@siteguard/notify";
import { env } from "@/lib/env";
import { inviteUrl, newInviteToken } from "@/lib/invites";
import { notifyContext } from "@/lib/notify";
import { requireAdmin } from "@/lib/session";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const createInviteSchema = z.object({
  email: z.email("Enter a valid email").transform((v) => v.trim().toLowerCase()),
  role: z.enum(ROLES),
});

export async function createInvite(input: { email: string; role: string }): Promise<ActionResult<{ url: string }>> {
  const session = await requireAdmin();
  const parsed = createInviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { email, role } = parsed.data;

  await db();
  const existingUser = await mongoose.connection.db!.collection("user").findOne({ email }, { projection: { _id: 1 } });
  if (existingUser) return { ok: false, error: "A user with this email already exists." };

  // One live invite per email: revoke older pending ones.
  await Invite.updateMany(
    { email, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { revokedAt: new Date() } },
  );

  const { token, tokenHash } = newInviteToken();
  await Invite.create({
    email,
    role,
    tokenHash,
    invitedBy: session.user.id,
    expiresAt: new Date(Date.now() + RETENTION.inviteDays * 24 * 60 * 60 * 1000),
  });

  revalidatePath("/settings/users");
  return { ok: true, data: { url: inviteUrl(token) } };
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  await requireAdmin();
  if (!mongoose.isValidObjectId(inviteId)) return { ok: false, error: "Invalid invite" };
  await db();
  await Invite.updateOne({ _id: inviteId, acceptedAt: null }, { $set: { revokedAt: new Date() } });
  revalidatePath("/settings/users");
  return { ok: true, data: undefined };
}

/** Optional: email the invite link (uses 1 Brevo email; in preview mode it is only rendered). */
export async function emailInvite(input: { email: string; url: string; role: string }): Promise<ActionResult<{ state: string; previewId?: string }>> {
  const session = await requireAdmin();
  const email = z.email().safeParse(input.email.trim().toLowerCase());
  if (!email.success) return { ok: false, error: "Invalid email" };
  // Only accept links this app generated.
  if (!input.url.startsWith(new URL("/invite/", env.APP_URL).toString())) return { ok: false, error: "Invalid invite link" };
  const res = await sendInviteEmail(await notifyContext(), {
    to: email.data,
    inviteUrl: input.url,
    invitedBy: session.user.name,
    role: input.role,
    expiresInDays: RETENTION.inviteDays,
  });
  if (res.state === "failed" || res.state === "skipped") return { ok: false, error: [res.error?.message, res.error?.hint].filter(Boolean).join(" — ") };
  return { ok: true, data: { state: res.state, previewId: res.previewId } };
}
