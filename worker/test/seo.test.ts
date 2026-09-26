import { afterAll, describe, expect, it } from "vitest";
import type { SeoChecklistItem, SeoItemId } from "@siteguard/core";
import { headerNoindex, parseRobots, seoCheck, validateSitemapXml } from "../src/checks/seo";
import { makeCtx, makeSite, startServer, type Handler } from "./helpers";

function page(opts: { robots?: string; canonical?: string; title?: string; h1?: number; lang?: boolean } = {}) {
  const { robots, canonical, title = "Acme Dental Clinic – Best Dentist in Pune", h1 = 1, lang = true } = opts;
  return `<!doctype html><html${lang ? ' lang="en"' : ""}><head>
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Family and cosmetic dentistry in Pune. Book an appointment online.">
  ${robots ? `<meta name='robots' content='${robots}' />` : ""}
  ${canonical ? `<link rel="canonical" href="${canonical}">` : ""}
  <!-- <meta name="robots" content="noindex"> commented out: must be ignored -->
  </head><body>${"<h1>Welcome</h1>".repeat(h1)}</body></html>`;
}

const html = (body: string, headers: Record<string, string> = {}): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(body);
};
const text = (body: string, type = "text/plain", status = 200): Handler => (_req, res) => {
  res.writeHead(status, { "content-type": type });
  res.end(body);
};

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://acme.example/</loc></url><url><loc>https://acme.example/contact</loc></url></urlset>`;

/** One server per scenario so robots.txt / sitemap can differ. */
async function site(routes: Record<string, Handler>, importantPages: string[] = []) {
  const srv = await startServer({
    "/robots.txt": text("User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: /sitemap.xml\n"),
    "/sitemap.xml": text(SITEMAP, "application/xml"),
    ...routes,
  });
  servers.push(srv);
  const r = await seoCheck.run(makeSite(`${srv.url}/`, { importantPages }), makeCtx());
  const items = new Map(((r.details?.checklist as SeoChecklistItem[]) ?? []).map((i) => [i.id, i]));
  return { r, item: (id: SeoItemId) => items.get(id)! };
}

const servers: Awaited<ReturnType<typeof startServer>>[] = [];
afterAll(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

describe("seo check", () => {
  it("healthy site passes every item", async () => {
    const { r, item } = await site({ "/": html(page()), "/contact": html(page({ title: "Contact Acme Dental Clinic" })) }, ["/contact"]);
    expect(r.status).toBe("OK");
    expect(item("sitemap_in_robots").status).toBe("pass");
    expect(item("sitemap_valid")).toMatchObject({ status: "pass" });
    expect(item("sitemap_valid").detail).toContain("2 URLs");
    expect(r.metrics).toMatchObject({ failCount: 0, warnCount: 0, pagesChecked: 2 });
  });

  it("noindex robots meta tag (WordPress 'Discourage search engines') → FAIL", async () => {
    const { r, item } = await site({ "/": html(page({ robots: "noindex, nofollow" })) });
    expect(r).toMatchObject({ status: "FAIL", reason: "noindex" });
    expect(item("noindex_meta")).toMatchObject({ status: "fail", pages: ["/"] });
  });

  it("X-Robots-Tag noindex header → FAIL, also on an important page only", async () => {
    const { r, item } = await site(
      { "/": html(page()), "/services": html(page({ title: "Our Dental Services" }), { "x-robots-tag": "noindex" }) },
      ["/services"],
    );
    expect(r).toMatchObject({ status: "FAIL", reason: "noindex" });
    expect(item("noindex_header")).toMatchObject({ status: "fail", pages: ["/services"] });
    expect(item("noindex_meta").status).toBe("pass");
    expect(r.message).toContain("/services");
  });

  it("robots.txt blocking everything for User-agent: * → FAIL", async () => {
    const { r, item } = await site({ "/": html(page()), "/robots.txt": text("User-agent: *\nDisallow: /\n") });
    expect(r).toMatchObject({ status: "FAIL", reason: "robots_blocked" });
    expect(item("robots_block_all").status).toBe("fail");
    expect(item("sitemap_in_robots").status).toBe("warn");
  });

  it("canonical pointing to a staging / other domain → FAIL", async () => {
    const { r, item } = await site({ "/": html(page({ canonical: "https://staging.acme-dental.com/" })) });
    expect(r).toMatchObject({ status: "FAIL", reason: "canonical_mismatch" });
    expect(item("canonical")).toMatchObject({ status: "fail", detail: "https://staging.acme-dental.com/" });
  });

  it("an important page redirecting to another host is judged by its own final host", async () => {
    // Like www.wikipedia.org/wiki/Main_Page → en.wikipedia.org (canonical = en.wikipedia.org): not a mismatch.
    const { item, r } = await site(
      {
        "/": html(page()),
        // 127.0.0.1 → localhost: a different hostname, like www → en.
        "/moved": (req, res) => res.writeHead(301, { location: `http://localhost:${req.headers.host!.split(":")[1]}/final` }).end(),
        "/final": (req, res) => {
          res.writeHead(200, { "content-type": "text/html" });
          res.end(page({ canonical: `http://${req.headers.host}/final` }));
        },
      },
      ["/moved"],
    );
    expect(((r.details!.pages as { finalUrl?: string }[])[1]!.finalUrl ?? "")).toContain("localhost");
    expect(item("canonical").status).toBe("pass");
  });

  it("relative canonical on the same host passes", async () => {
    const { item } = await site({ "/": html(page({ canonical: "/" })) });
    expect(item("canonical").status).toBe("pass");
  });

  it("sitemap not in robots.txt / invalid XML / HTML instead of XML → WARN", async () => {
    const a = await site({ "/": html(page()), "/robots.txt": text("User-agent: *\nDisallow:\n") });
    expect(a.r).toMatchObject({ status: "WARN", reason: "seo_issues" });
    expect(a.item("sitemap_in_robots").status).toBe("warn");
    expect(a.item("sitemap_valid").status).toBe("pass"); // found at /sitemap.xml

    const b = await site({ "/": html(page()), "/sitemap.xml": text("<urlset><url><loc>x</loc></url>", "application/xml") });
    expect(b.item("sitemap_valid").status).toBe("warn");
    expect(b.item("sitemap_valid").detail).toContain("Invalid XML");

    const c = await site({ "/": html(page()), "/sitemap.xml": html(page()) });
    expect(c.item("sitemap_valid").detail).toContain("HTML page instead of XML");
  });

  it("missing robots.txt is informational only", async () => {
    const { item } = await site({ "/": html(page()), "/robots.txt": text("not found", "text/plain", 404) });
    expect(item("robots_txt").status).toBe("info");
    expect(item("robots_block_all").status).toBe("na");
  });

  it("homepage unreachable → UNKNOWN (uptime owns availability)", async () => {
    const { r } = await site({ "/": text("boom", "text/html", 500) });
    expect(r).toMatchObject({ status: "UNKNOWN", reason: "unreachable" });
  });
});

describe("parsers", () => {
  it("parseRobots handles groups, comments and Allow: /", () => {
    expect(parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:\n", "https://x").blocksAll).toBe(false);
    expect(parseRobots("User-agent: Bingbot\nUser-agent: *\nDisallow: / # staging\n", "https://x").blocksAll).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow: /\nAllow: /\n", "https://x").blocksAll).toBe(false);
    expect(parseRobots("Sitemap: https://x/sitemap_index.xml\n", "https://x").sitemaps).toEqual(["https://x/sitemap_index.xml"]);
  });

  it("headerNoindex only counts Google / all bots", () => {
    expect(headerNoindex("noindex, nofollow")).toBe(true);
    expect(headerNoindex("googlebot: noindex")).toBe(true);
    expect(headerNoindex("otherbot: noindex")).toBe(false);
    expect(headerNoindex("unavailable_after: 25 Jun 2030 15:00:00 PST")).toBe(false);
    expect(headerNoindex(null)).toBe(false);
  });

  it("validateSitemapXml accepts urlset and sitemapindex", () => {
    expect(validateSitemapXml(SITEMAP)).toMatchObject({ valid: true, kind: "urlset", entries: 2 });
    expect(validateSitemapXml('<?xml version="1.0"?><sitemapindex><sitemap><loc>a</loc></sitemap></sitemapindex>')).toMatchObject({ valid: true, kind: "sitemapindex", entries: 1 });
    expect(validateSitemapXml("<rss></rss>").valid).toBe(false);
  });
});
