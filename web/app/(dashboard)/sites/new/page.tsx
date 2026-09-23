import { DEFAULT_INTERVALS, type CheckType } from "@siteguard/core";
import { getSettings } from "@siteguard/db";
import { PageHeader } from "@/components/page-header";
import { SiteForm } from "@/components/sites/site-form";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { toFormValues } from "@/lib/site-form-values";

export const metadata = { title: "Add site" };

export default async function NewSitePage() {
  await requireSession();
  await db();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add site" description="Monitoring starts automatically after saving." />
      <SiteForm mode="create" initial={toFormValues()} defaultIntervals={{ ...DEFAULT_INTERVALS, ...(settings.intervals as Record<CheckType, number>) }} />
    </div>
  );
}
