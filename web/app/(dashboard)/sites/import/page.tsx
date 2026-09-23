import { DownloadIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CSV_COLUMNS, CSV_MAX_ROWS } from "@/lib/csv-import";
import { requireAdmin } from "@/lib/session";
import { ImportClient } from "./import-client";

export const metadata = { title: "Import sites" };

const COLUMN_HELP: Record<(typeof CSV_COLUMNS)[number], string> = {
  name: "Display name (optional — derived from the domain if empty)",
  url: "Required. https:// is added if missing",
  clientName: "Client / company name",
  clientEmail: "Client contact email",
  tags: "Separated by ; or |  e.g. healthcare;wordpress",
  framework: "nextjs, react, wordpress, html, laravel, shopify, other",
  notes: "Free text (quote it if it contains commas)",
  requiredKeyword: "Text that must appear on the homepage",
  importantPages: "Paths separated by ;  e.g. /contact;/services",
  responseTimeWarnMs: "Slow threshold in ms (default 3000)",
};

export default async function ImportSitesPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Import sites from CSV"
        description={`Up to ${CSV_MAX_ROWS} rows. You'll see a preview before anything is saved.`}
        actions={
          <Button variant="outline" asChild>
            <a href="/api/sites/template" download>
              <DownloadIcon /> Download template
            </a>
          </Button>
        }
      />
      <div className="grid gap-6">
        <ImportClient />
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Columns</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
              {CSV_COLUMNS.map((c) => (
                <div key={c} className="contents">
                  <dt className="font-mono text-xs">{c}</dt>
                  <dd className="text-muted-foreground mb-1 text-xs sm:mb-0">{COLUMN_HELP[c]}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground mt-3 text-xs">Headers are matched loosely (e.g. “Website”, “Client Name”). Duplicates are detected by normalized URL, against existing sites and within the file.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
