import { GlobeIcon } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";

export const metadata = { title: "Sites" };

export default function Page() {
  return (
    <>
      <PageHeader title="Sites" description="All monitored client websites." />
      <EmptyState icon={<GlobeIcon />} title="Coming in Phase 2">
        Add, edit, pause and bulk-import websites.
      </EmptyState>
    </>
  );
}
