import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { admin } from "better-auth/plugins/admin";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { getMongoClient } from "@siteguard/db";

export const MIN_PASSWORD_LENGTH = 10;

interface AuthConfig {
  mongodbUri: string;
  secret: string;
  baseURL: string;
  extraPlugins?: BetterAuthPlugin[];
}

/**
 * Shared Better Auth config. Used by the Next.js app (lib/auth.ts, which adds
 * the nextCookies plugin) and by CLI scripts such as create-admin.
 * Uses the same MongoClient as Mongoose — one connection pool per process.
 */
export function createAuth({ mongodbUri, secret, baseURL, extraPlugins = [] }: AuthConfig) {
  const client = getMongoClient(mongodbUri);

  return betterAuth({
    appName: "SiteGuard",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    database: mongodbAdapter(client.db(), { client }),
    emailAndPassword: {
      enabled: true,
      // Invite-only: accounts are created by admins (auth.api.createUser) or the create-admin script.
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: { enabled: true, window: 60, max: 100, customRules: { "/sign-in/email": { window: 60, max: 5 } } },
    advanced: {
      // Behind Caddy: take the client IP from X-Forwarded-For for rate limiting.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    telemetry: { enabled: false },
    plugins: [
      admin({
        defaultRole: "member",
        adminRoles: ["admin"],
        roles: { admin: adminAc, member: userAc },
      }),
      ...extraPlugins,
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
