import { HEADER_ITEM_DEFS, type HeaderChecklistItem } from "@siteguard/core";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatShort } from "@/lib/format";
import type { Screenshot } from "@/lib/queries/checks";
import type { ResultRow } from "@/lib/queries/sites";
import { cn } from "@/lib/utils";
import { RecentResultsTable } from "./check-results";
import { Empty, ITEM_ICON, Verdict } from "./phase4-panels";

const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};

// ─── Broken links ───────────────────────────────────────────────────

interface Broken {
  url: string;
  kind: string;
  internal: boolean;
  status: number | null;
  error?: string;
  foundOn: string[];
}

export function LinksPanel({ latest, history }: { latest: ResultRow | null; history: ResultRow[] }) {
  if (!latest) return <Empty>No link crawl yet. It runs weekly (up to 50 pages); use “Run links check” to start one now.</Empty>;
  const d = (latest.details ?? {}) as { broken?: Broken[]; redirects?: { url: string; to: string; hops: number }[]; truncated?: boolean; maxPages?: number };
  const m = latest.metrics as Record<string, number>;
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-3 pt-6">
          <Verdict result={latest} />
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[
              ["Pages crawled", m.pagesCrawled],
              ["URLs checked", m.urlsChecked],
              ["Broken on site", m.brokenInternal],
              ["Broken external", m.brokenExternal],
              ["Couldn't verify", m.unverified],
            ].map(([label, v]) => (
              <div key={label as string}>
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="font-medium tabular-nums">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-xs">
            “Couldn&apos;t verify” = other sites that block bots or need a login (403/429) — not counted as broken. Admin, logout and cart URLs are never visited.
            {d.truncated ? " URL limit reached — very large site, not every link was checked." : ""}
          </p>
        </CardContent>
      </Card>

      {d.broken && d.broken.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Broken links ({d.broken.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="hidden md:table-cell">Found on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.broken.map((b) => (
                  <TableRow key={b.url}>
                    <TableCell className="max-w-md font-mono text-xs break-all">
                      <Badge variant={b.internal ? "destructive" : "outline"} className="mr-1.5 text-[10px]">
                        {b.internal ? "site" : "external"} · {b.kind}
                      </Badge>
                      {b.internal ? path(b.url) : b.url}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">{b.status ?? b.error}</TableCell>
                    <TableCell className="text-muted-foreground hidden font-mono text-xs md:table-cell">{b.foundOn.map(path).join(", ")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {d.redirects && d.redirects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Internal links that redirect</CardTitle>
            <CardDescription>Not errors — but linking to the final URL saves a hop for visitors and Google.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground grid gap-1 font-mono text-xs">
              {d.redirects.map((r) => (
                <li key={r.url} className="break-all">
                  {path(r.url)} → {r.to} ({r.hops} hop{r.hops > 1 ? "s" : ""})
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">History</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentResultsTable results={history} showResponse={false} />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Browser health + screenshots ───────────────────────────────────

interface Failed {
  url: string;
  type: string;
  status: number | null;
  error?: string;
  sameSite: boolean;
}

export function BrowserPanel({ latest, screenshots }: { latest: ResultRow | null; screenshots: Screenshot[] }) {
  const d = (latest?.details ?? {}) as { pageErrors?: string[]; consoleErrors?: string[]; failed?: Failed[] };
  const [current, ...older] = screenshots;
  return (
    <div className="grid gap-4">
      {!latest ? (
        <Empty>No browser check yet. It loads the page daily in real Chromium; use “Run browser check” to start one now.</Empty>
      ) : (
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <Verdict result={latest} />
          </CardContent>
        </Card>
      )}

      {current && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Latest screenshot {current.takenAt ? `· ${formatDateTime(current.takenAt)}` : ""}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <a href={current.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- auth-protected API image, not optimisable */}
              <img src={current.url} alt="Latest screenshot of the homepage (1366×768)" className="w-full rounded-md border" />
            </a>
            {older.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {older.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="grid gap-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- auth-protected API image */}
                    <img src={s.url} alt={`Screenshot ${s.takenAt ?? ""}`} className="rounded border" loading="lazy" />
                    <span className="text-muted-foreground text-[10px]">{s.takenAt ? formatShort(s.takenAt) : ""}</span>
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {latest && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">JavaScript errors</CardTitle>
            </CardHeader>
            <CardContent>
              {d.pageErrors?.length || d.consoleErrors?.length ? (
                <ul className="grid gap-1.5 font-mono text-xs">
                  {d.pageErrors?.map((e) => (
                    <li key={`p${e}`} className="text-destructive break-all">
                      Uncaught: {e}
                    </li>
                  ))}
                  {d.consoleErrors?.map((e) => (
                    <li key={`c${e}`} className="text-muted-foreground break-all">
                      console: {e}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">None.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Failed resources</CardTitle>
            </CardHeader>
            <CardContent>
              {d.failed?.length ? (
                <ul className="grid gap-1.5 font-mono text-xs">
                  {d.failed.map((f) => (
                    <li key={f.url} className={cn("break-all", f.sameSite && (f.type === "script" || f.type === "stylesheet") ? "text-destructive" : "text-muted-foreground")}>
                      {f.type} {f.status ?? f.error} — {f.sameSite ? path(f.url) : f.url}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">None.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Security headers ───────────────────────────────────────────────

export function SecurityPanel({ latest }: { latest: ResultRow | null }) {
  if (!latest) return <Empty>No security-headers check yet. It runs weekly; use “Run headers check” to start one now.</Empty>;
  const checklist = ((latest.details?.checklist as HeaderChecklistItem[] | undefined) ?? []).filter(Boolean);
  const grade = latest.metrics.grade as string | undefined;
  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          {grade && (
            <div className="grid size-14 place-items-center rounded-lg border text-2xl font-semibold" aria-label={`Grade ${grade}`}>
              {grade}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <Verdict result={latest} />
          </div>
        </CardContent>
      </Card>
      {checklist.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Security headers checklist</CardTitle>
            <CardDescription>Missing headers are shown in-app only; mixed content (which breaks the page) also alerts on Telegram.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {checklist.map((item) => {
                const def = HEADER_ITEM_DEFS[item.id];
                const s = ITEM_ICON[item.status];
                const Icon = s.icon;
                return (
                  <li key={item.id} className="flex gap-3 py-2.5">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", s.tone)} aria-hidden />
                    <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{def.label}</span>
                        <span className={cn("text-xs font-medium", s.tone)}>{s.label}</span>
                      </div>
                      {item.detail && <div className="text-muted-foreground font-mono text-xs break-all">{item.detail}</div>}
                      {item.status !== "pass" && item.status !== "na" && <p className="text-muted-foreground text-xs">How to fix: {def.fix}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Contact form ───────────────────────────────────────────────────

export function FormPanel({ enabled, config, latest, history }: { enabled: boolean; config: { pageUrl: string; selector: string; testSubmission: boolean; successText: string }; latest: ResultRow | null; history: ResultRow[] }) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Contact form check</CardTitle>
          <CardDescription>
            {!enabled
              ? "Off for this site. Turn on “Contact Form” under Edit → Checks and set the form page."
              : config.testSubmission
                ? "Test submission is ON: once a day the form is submitted with [SITEGUARD-TEST] data — the client receives these emails."
                : "Render check: the form, its fields and the submit button are checked daily. Nothing is submitted."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground text-xs">Form page</dt>
              <dd className="font-mono text-xs break-all">{config.pageUrl || "/ (homepage)"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Selector</dt>
              <dd className="font-mono text-xs">{config.selector || "form"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Test submission</dt>
              <dd>{config.testSubmission ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Success text</dt>
              <dd className="text-xs">{config.successText || "auto-detect"}</dd>
            </div>
          </dl>
          {latest ? <Verdict result={latest} /> : enabled && <p className="text-muted-foreground">Waiting for the first form check…</p>}
        </CardContent>
      </Card>
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">History</CardTitle>
          </CardHeader>
          <CardContent>
            <RecentResultsTable results={history} showResponse={false} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
