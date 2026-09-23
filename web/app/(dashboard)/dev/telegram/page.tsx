import { mongoose, Outbox } from "@siteguard/db";
import { telegramStatus } from "@siteguard/notify";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { notifyContext } from "@/lib/notify";
import { requireAdmin } from "@/lib/session";
import { PreviewShell } from "../preview-shell";

export const metadata = { title: "Telegram previews" };

/** Telegram-like chat bubble; the message HTML is shown in a sandboxed iframe. */
function bubbleDoc(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    body{margin:0;padding:16px;background:#8fb4d9 linear-gradient(135deg,#a8c8e8,#7fa7cf);font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    .b{max-width:420px;background:#fff;border-radius:14px 14px 14px 4px;padding:8px 12px;box-shadow:0 1px 2px rgba(0,0,0,.2);white-space:pre-wrap;word-wrap:break-word;color:#000}
    a{color:#168acd;text-decoration:none} code,pre{font-family:ui-monospace,monospace}
    .n{font-weight:600;color:#3d8ecb;font-size:13px;margin-bottom:2px}
  </style></head><body><div class="b"><div class="n">SiteGuard Bot</div>${html}</div></body></html>`;
}

export default async function TelegramPreviewsPage({ searchParams }: PageProps<"/dev/telegram">) {
  await requireAdmin();
  await db();
  const sp = await searchParams;
  const ctx = await notifyContext();
  const items = await Outbox.find({ channel: "telegram" }, { request: 0 }).sort({ createdAt: -1 }).limit(100).lean();
  const wanted = typeof sp.id === "string" && mongoose.isValidObjectId(sp.id) ? sp.id : items[0] && String(items[0]._id);
  const selected = wanted ? await Outbox.findOne({ _id: wanted, channel: "telegram" }).lean() : null;

  return (
    <PreviewShell
      kind="telegram"
      live={telegramStatus(ctx.config, ctx.settings).mode === "live"}
      selectedId={selected ? String(selected._id) : undefined}
      items={items.map((m) => ({
        id: String(m._id),
        title: (m.text.split("\n")[0] ?? "").replace(/<[^>]+>/g, ""),
        subtitle: `chat ${m.to.join(", ")}`,
        category: m.category,
        createdAt: m.createdAt.toISOString(),
      }))}
    >
      {selected && (
        <div className="grid gap-4">
          <div className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
            To chat(s): <span className="font-mono">{selected.to.join(", ")}</span> · {formatDateTime(selected.createdAt)} · {selected.text.length}/4096 chars
          </div>
          <iframe title="Telegram preview" srcDoc={bubbleDoc(selected.text)} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="h-80 w-full rounded-lg border" />
          <div className="rounded-lg border p-3 text-xs">
            <div className="mb-2 font-medium">Exact text (parse_mode: HTML)</div>
            <pre className="whitespace-pre-wrap [overflow-wrap:anywhere]">{selected.text}</pre>
          </div>
          <details className="rounded-lg border p-3 text-xs">
            <summary className="cursor-pointer font-medium">Telegram API request that would be sent</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere]">{JSON.stringify(selected.request, null, 2)}</pre>
          </details>
        </div>
      )}
    </PreviewShell>
  );
}
