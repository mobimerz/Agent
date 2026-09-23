import { getSettings, type SettingsDoc } from "@siteguard/db";

const TTL_MS = 30_000;
let cached: { at: number; value: SettingsDoc } | null = null;

/** Settings change rarely; re-read at most every 30 s. */
export async function getSettingsCached(): Promise<SettingsDoc> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await getSettings();
  cached = { at: Date.now(), value };
  return value;
}

export function invalidateSettingsCache() {
  cached = null;
}
