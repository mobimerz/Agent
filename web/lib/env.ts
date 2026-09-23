import "server-only";
import { parseEnv, webEnvSchema, type WebEnv } from "@siteguard/core/env";

/**
 * `next build` evaluates route modules while collecting page data, including
 * inside the Docker build where real secrets are absent. Use inert placeholders
 * only for that phase; at runtime the real env is validated strictly.
 */
const isBuild = process.env.NEXT_PHASE === "phase-production-build";

export const env: WebEnv = isBuild
  ? webEnvSchema.parse({
      ...process.env,
      MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://build-placeholder:27017/siteguard",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "build-placeholder-secret-not-used-at-runtime",
    })
  : parseEnv(webEnvSchema);
