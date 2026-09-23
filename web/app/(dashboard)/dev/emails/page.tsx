import { mongoose, Outbox } from "@siteguard/db";
import { emailStatus } from "@siteguard/notify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { notifyContext } from "@/lib/notify";
import { requireAdmin } from "@/lib/session";
import { PreviewShell } from "../preview-shell";

export const metadata = { title: "Email previews" };

const withBlankTargets = (html: string) => html.replace("<head>", '<head><base target="_blank">');

export default async function EmailPreviewsPage({ searchParams }: PageProps<"/dev/emails">) {
  await requireAdmin();
  await db();
  const sp = await searchParams;
  const ctx = await notifyContext();
  const items = await Outbox.find({ channel: "email" }, { html: 0, request: 0 }).sort({ createdAt: -1 }).limit(100).lean();
  const wanted = typeof sp.id === "string" && mongoose.isValidObjectId(sp.id) ? sp.id : items[0] && String(items[0]._id);
  const selected = wanted ? await Outbox.findOne({ _id: wanted, channel: "email" }).lean() : null;

  return (
    <PreviewShell
      kind="emails"
      live={emailStatus(ctx.config, ctx.settings).mode === "live"}
      selectedId={selected ? String(selected._id) : undefined}
      items={items.map((m) => ({ id: String(m._id), title: m.subject ?? "(no subject)", subtitle: m.to.join(", "), category: m.category, createdAt: m.createdAt.toISOString() }))}
    >
      {selected && (
        <div className="grid gap-4">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="text-base break-words">{selected.subject}</CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground grid gap-0.5 text-xs">
              <div>To: {selected.to.join(", ")}</div>
              <div>Rendered: {formatDateTime(selected.createdAt)} · category: {selected.category}</div>
            </CardContent>
          </Card>
          {/* Sandboxed: scripts never run; links open in a new tab. */}
          <iframe title="Email preview" srcDoc={withBlankTargets(selected.html ?? "")} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="h-[640px] w-full rounded-lg border bg-white" />
          <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium">Plain-text version</summary>
            <pre className="mt-2 break-words whitespace-pre-wrap">{selected.text}</pre>
          </details>
          <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium">Brevo API request that would be sent</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(selected.request, null, 2)}</pre>
          </details>
        </div>
      )}
    </PreviewShell>
  );
}
