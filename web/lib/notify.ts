import "server-only";
import { getSettings } from "@siteguard/db";
import { createNotifyContext, notifyConfigFromEnv } from "@siteguard/notify";
import { db } from "./db";
import { env } from "./env";

export const notifyConfig = notifyConfigFromEnv(env);

/** Fresh context per call (settings may have changed). Never throws on missing keys. */
export async function notifyContext() {
  await db();
  return createNotifyContext(notifyConfig, { settings: await getSettings() });
}
