import { notFound } from "next/navigation";
import { DEFAULT_INTERVALS, type CheckType } from "@siteguard/core";
import { getSettings } from "@siteguard/db";
import { PageHeader } from "@/components/page-header";
import { SiteForm } from "@/components/sites/site-form";
import { getSite } from "@/lib/queries/sites";
import { requireSession } from "@/lib/session";
import { toFormValues } from "@/lib/site-form-values";

export const metadata = { title: "Edit site" };

export default async function EditSitePage({ params }: PageProps<"/sites/[id]/edit">) {
  await requireSession();
  const { id } = await params;
  const site = await getSite(id);
  if (!site) notFound();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Edit ${site.name}`} description={site.url} />
      <SiteForm mode="edit" siteId={id} initial={toFormValues(site)} defaultIntervals={{ ...DEFAULT_INTERVALS, ...(settings.intervals as Record<CheckType, number>) }} />
    </div>
  );
}
