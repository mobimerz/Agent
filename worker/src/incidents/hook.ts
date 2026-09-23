import type { SettingsDoc } from "@siteguard/db";
import type { NotifyConfig } from "@siteguard/notify";
import type { Logger } from "../logger";
import { processCheckEvent, type CheckEvent } from "./engine";

/** Single integration point between the check runner and the incident engine. */
export async function onCheckResult(ev: CheckEvent, deps: { settings: SettingsDoc; config: NotifyConfig; log: Logger }): Promise<void> {
  await processCheckEvent(ev, deps);
}
