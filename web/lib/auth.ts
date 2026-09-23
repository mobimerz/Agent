import "server-only";
import { nextCookies } from "better-auth/next-js";
import { createAuth } from "./auth-config";
import { env } from "./env";

const g = globalThis as typeof globalThis & { __siteguardAuth?: ReturnType<typeof build> };

function build() {
  return createAuth({
    mongodbUri: env.MONGODB_URI,
    secret: env.AUTH_SECRET,
    baseURL: env.APP_URL,
    // Must be last: lets server actions set auth cookies.
    extraPlugins: [nextCookies()],
  });
}

export const auth = (g.__siteguardAuth ??= build());

export type Session = typeof auth.$Infer.Session;
