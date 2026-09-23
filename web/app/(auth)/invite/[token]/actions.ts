"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { Invite } from "@siteguard/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-config";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken, inviteState } from "@/lib/invites";

const acceptSchema = z
  .object({
    token: z.string().min(20),
    name: z.string().trim().min(1, "Name is required").max(80),
    password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`).max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export async function acceptInvite(input: z.input<typeof acceptSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { token, name, password } = parsed.data;

  await db();
  const tokenHash = hashToken(token);

  // Atomically claim the invite so the link can't be used twice concurrently.
  const invite = await Invite.findOneAndUpdate(
    { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { acceptedAt: new Date() } },
    { returnDocument: "after" },
  ).lean();

  if (!invite) {
    const current = await Invite.findOne({ tokenHash }).lean();
    const state = inviteState(current);
    return { ok: false, error: state === "used" ? "This invite was already used. Please sign in." : "This invite link is invalid or has expired." };
  }

  try {
    // No request headers → the admin plugin treats this as a trusted server call.
    await auth.api.createUser({ body: { email: invite.email, name, password, role: invite.role } });
  } catch (err) {
    await Invite.updateOne({ _id: invite._id }, { $set: { acceptedAt: null } });
    const message = err instanceof Error ? err.message : "Could not create account";
    return { ok: false, error: message };
  }

  // Sign in immediately; nextCookies() sets the session cookie on this response.
  await auth.api.signInEmail({ body: { email: invite.email, password }, headers: await headers() });
  return { ok: true };
}
