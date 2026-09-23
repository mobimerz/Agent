import { AppShell } from "@/components/layout/app-shell";
import { requireSession, roleOf } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <AppShell user={{ name: session.user.name, email: session.user.email, role: roleOf(session) }}>{children}</AppShell>
  );
}
