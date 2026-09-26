import type { CheckType } from "@siteguard/core";
import { contentCheck } from "./content";
import { dnsCheck } from "./dns";
import { domainCheck } from "./domain";
import { pagespeedCheck } from "./pagespeed";
import { seoCheck } from "./seo";
import { sslCheck } from "./ssl";
import type { CheckModule } from "./types";
import { uptimeCheck } from "./uptime";

/** Registered check modules. Must stay in sync with ACTIVE_CHECK_TYPES in @siteguard/core. */
export const CHECKS: Partial<Record<CheckType, CheckModule>> = {
  uptime: uptimeCheck,
  content: contentCheck,
  ssl: sslCheck,
  domain: domainCheck,
  dns: dnsCheck,
  pagespeed: pagespeedCheck,
  seo: seoCheck,
};

export type { CheckModule, CheckContext, CheckRunResult } from "./types";
