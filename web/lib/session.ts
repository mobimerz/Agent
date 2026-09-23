import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@siteguard/core";
import { auth, type Session } from "./auth";

/** Per-request cached session lookup. */
export const getSession = cache(async (): Promise<Session | null> => {
  return auth.api.getSession({ headers: await headers() });
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export function roleOf(session: Session): Role {
  return session.user.role === "admin" ? "admin" : "member";
}

export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (roleOf(session) !== "admin") redirect("/");
  return session;
}
