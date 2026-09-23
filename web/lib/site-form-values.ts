import { CHECK_TYPES, type CheckType } from "@siteguard/core";
import type { SiteLean } from "@siteguard/db";
import type { SiteFormValues } from "@/components/sites/site-form";

/** Map a stored site (or nothing, for "new") to form values. */
export function toFormValues(site?: SiteLean | null): SiteFormValues {
  const checks = Object.fromEntries(
    CHECK_TYPES.map((t) => {
      const c = site?.checks?.[t];
      const enabled = c?.enabled ?? t !== "form"; // browser form check is opt-in
      return [t, { enabled, intervalMin: c?.intervalSec ? String(c.intervalSec / 60) : "" }];
    }),
  ) as Record<CheckType, { enabled: boolean; intervalMin: string }>;

  return {
    name: site?.name ?? "",
    url: site?.url ?? "",
    clientName: site?.clientName ?? "",
    clientEmail: site?.clientEmail ?? "",
    tags: (site?.tags ?? []).join(", "),
    framework: site?.framework ?? "",
    notes: site?.notes ?? "",
    checks,
    responseTimeWarnMs: site?.thresholds?.responseTimeWarnMs ? String(site.thresholds.responseTimeWarnMs) : "",
    importantPages: (site?.importantPages ?? []).join("\n"),
    requiredKeyword: site?.content?.requiredKeyword ?? "",
    extraSpamWords: (site?.content?.extraSpamWords ?? []).join(", "),
    formPageUrl: site?.form?.pageUrl ?? "",
    formSelector: site?.form?.selector ?? "form",
    formTestSubmission: site?.form?.testSubmission ?? false,
  };
}
