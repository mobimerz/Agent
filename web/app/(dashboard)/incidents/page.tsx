import { AlertTriangleIcon } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";

export const metadata = { title: "Incidents" };

export default function Page() {
  return (
    <>
      <PageHeader title="Incidents" description="Open and past incidents across all sites." />
      <EmptyState icon={<AlertTriangleIcon />} title="Coming in Phase 3">
        Confirmed failures become incidents you can acknowledge and annotate.
      </EmptyState>
    </>
  );
}
