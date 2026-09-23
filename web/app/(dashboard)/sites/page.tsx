import Link from "next/link";
import { PlusIcon, UploadIcon } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/page-header";
import { SitesFilters } from "@/components/sites/sites-filters";
import { SitesTable } from "@/components/sites/sites-table";
import { Button } from "@/components/ui/button";
import { getFilterOptions, listSites, parseSiteFilters } from "@/lib/queries/sites";
import { requireSession, roleOf } from "@/lib/session";

export const metadata = { title: "Sites" };

export default async function SitesPage({ searchParams }: PageProps<"/sites">) {
  const session = await requireSession();
  const filters = parseSiteFilters(await searchParams);
  const [rows, options] = await Promise.all([listSites(filters), getFilterOptions()]);

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Sites"
        description={`${rows.length} site${rows.length === 1 ? "" : "s"}${filters.q || filters.client || filters.tag || filters.status ? " matching filters" : ""}`}
        actions={
          <>
            {roleOf(session) === "admin" && (
              <Button variant="outline" asChild>
                <Link href="/sites/import">
                  <UploadIcon /> Import CSV
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/sites/new">
                <PlusIcon /> Add site
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-4">
        <SitesFilters clients={options.clients} tags={options.tags} />
      </div>
      <SitesTable rows={rows} filters={filters} basePath="/sites" />
    </>
  );
}
