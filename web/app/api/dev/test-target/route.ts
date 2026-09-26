/**
 * DEV-ONLY simulation target for local testing of checks. Returns 404 in production.
 *
 *   /api/dev/test-target?status=500               → HTTP 500
 *   /api/dev/test-target?delay=5000               → respond after 5 s (slow / timeout; max 60 s)
 *   /api/dev/test-target?body=Hello               → custom body text (e.g. to drop a keyword)
 *   /api/dev/test-target?spam=1                   → defaced page ("Hacked by …", casino spam)
 *   /api/dev/test-target?block=cloudflare         → Cloudflare challenge (403 + cf-mitigated)
 *   /api/dev/test-target?redirect=3               → 3 redirects then 200 (redirect=9 → loop error)
 *   /api/dev/test-target?size=200                 → pad the page to ~200 KB
 *   /api/dev/test-target?noindex=meta             → robots meta noindex (WordPress "Discourage search engines")
 *   /api/dev/test-target?noindex=header           → X-Robots-Tag: noindex header
 *   /api/dev/test-target?canonical=https://staging.example.com/ → canonical pointing to another domain
 */
export const dynamic = "force-dynamic";

const DEFAULT_BODY = "Welcome to the SiteGuard Test Target. Book Appointment today.";

function page(title: string, body: string, head = "") {
  return `<!doctype html><html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Local page used to simulate SiteGuard checks.">${head}</head><body><h1>${title}</h1><p>${body}</p></body></html>`;
}

async function handle(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const q = url.searchParams;
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);

  const delay = Math.min(Number(q.get("delay") ?? 0) || 0, 60_000);
  if (delay > 0) await new Promise((r) => setTimeout(r, delay));

  const redirect = Number(q.get("redirect") ?? 0) || 0;
  if (redirect > 0) {
    const next = new URL(url);
    if (redirect >= 9) next.searchParams.set("redirect", String(redirect)); // loop forever
    else if (redirect === 1) next.searchParams.delete("redirect");
    else next.searchParams.set("redirect", String(redirect - 1));
    return new Response(null, { status: 302, headers: { location: next.pathname + next.search } });
  }

  if (q.get("block") === "cloudflare") {
    return new Response(
      '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-platform"></div><noscript>Enable JavaScript and cookies to continue</noscript></body></html>',
      { status: 403, headers: { "content-type": "text/html", server: "cloudflare", "cf-mitigated": "challenge" } },
    );
  }

  const status = Math.min(Math.max(Number(q.get("status") ?? 200) || 200, 100), 599);
  const noindex = q.get("noindex");
  const canonical = q.get("canonical");
  const head = [
    noindex === "meta" ? `<meta name='robots' content='noindex, nofollow' />` : "",
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : "",
  ].join("");
  let html = q.get("spam")
    ? page("Hacked by Anonymous", "Best online casino bonuses! Buy viagra cheap. Slot gacor hari ini.", head)
    : page(status >= 400 ? `Error ${status}` : "SiteGuard Test Target", esc(q.get("body") ?? DEFAULT_BODY), head);

  const sizeKb = Math.min(Number(q.get("size") ?? 0) || 0, 5000);
  if (sizeKb > 0) html = html.replace("</body>", `<!-- ${"x".repeat(sizeKb * 1024)} --></body>`);

  const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
  if (noindex === "header") headers["x-robots-tag"] = "noindex";
  return new Response(html, { status, headers });
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
