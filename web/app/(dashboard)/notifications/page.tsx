import { BellIcon } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";

export const metadata = { title: "Notifications" };

export default function Page() {
  return (
    <>
      <PageHeader title="Notifications" description="In-app alerts and reports." />
      <EmptyState icon={<BellIcon />} title="Coming in Phase 3">
        Real-time notifications via MongoDB Change Streams and Server-Sent Events.
      </EmptyState>
    </>
  );
}
