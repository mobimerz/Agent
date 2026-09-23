import type { CheckType } from "@siteguard/core";
import { contentCheck } from "./content";
import type { CheckModule } from "./types";
import { uptimeCheck } from "./uptime";

/** Registered check modules. Must stay in sync with ACTIVE_CHECK_TYPES in @siteguard/core. */
export const CHECKS: Partial<Record<CheckType, CheckModule>> = {
  uptime: uptimeCheck,
  content: contentCheck,
};

export type { CheckModule, CheckContext, CheckRunResult } from "./types";
