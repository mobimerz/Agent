import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { DEFAULTS, DEFAULT_TIMEZONE } from "./constants";

/**
 * Load the single repo-root `.env` (if present) into process.env without
 * overriding values that are already set (docker-compose env wins).
 */
export function loadRootEnv(startDir = process.cwd()): string | undefined {
  let dir = resolve(startDir);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      const file = join(dir, ".env");
      if (existsSync(file)) process.loadEnvFile(file);
      return file;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());

const emailList = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  z.array(z.email()),
);

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  MONGODB_URI: z.string().startsWith("mongodb"),
  TIMEZONE: z.string().default(DEFAULT_TIMEZONE),
  APP_URL: z.url().default("http://localhost:3000"),
  BREVO_API_KEY: optionalString,
  ALERT_FROM_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
  ALERT_FROM_NAME: z.string().default("SiteGuard"),
  ALERT_TO_EMAILS: emailList,
  EMAIL_DAILY_LIMIT: z.coerce.number().int().positive().default(DEFAULTS.emailDailyLimit),
  EMAIL_RESERVED_FOR_REPORTS: z.coerce.number().int().min(0).default(DEFAULTS.emailReservedForReports),
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,
});

export const webEnvSchema = baseSchema.extend({
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
});

export const workerEnvSchema = baseSchema.extend({
  PSI_API_KEY: optionalString,
  HEARTBEAT_PING_URL: optionalUrl,
  SCREENSHOT_DIR: z.string().default("./.dev-data/screenshots"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
