import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractLinks, linksCheck, type BrokenLink } from "../src/checks/links";
import { makeCtx, makeSite, startServer, type Handler } from "./helpers";

const html = (body: string): Handler => (_q, r) => r.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><body>${body}</body></html>`);
const status = (code: number): Handler => (_q, r) => r.writeHead(code, { "content-type": "text/html" }).end(`HTTP ${code}`);

let site: Awaited<ReturnType<typeof startServer>>;
let other: Awaited<ReturnType<typeof startServer>>;
const hits: string[] = [];

beforeAll(async () => {
  // "External" site = a second server reached via "localhost" (a different host than 127.0.0.1).
  other = await startServer({ "/ok": html("fine"), "/gone": status(404), "/forbidden": status(403) });
  const ext = other.url.replace("127.0.0.1", "localhost");
  site = await startServer({
    "/": html(`
      <a href="/about">About</a> <a href="/services">Services</a> <a href="/missing-page">Old page</a>
      <a href="mailto:x@y.com">mail</a> <a href="tel:123">call</a> <a href="#top">top</a>
      <a href="/wp-admin/">admin</a> <a href="/?add-to-cart=12">buy</a>
      <img src="/img/logo.png"> <img src="/img/deleted.jpg">
      <script src="/js/app.js"></script>
      <a href="${ext}/ok">partner</a> <a href="${ext}/gone">dead partner</a> <a href="${ext}/forbidden">walled</a>`),
    "/about": html(`<a href="/">Home</a> <a href="/team">Team</a>`),
    "/services": html(`<a href="/services/broken">Broken service</a>`),
    "/team": html("team"),
    "/services/broken": status(500),
    "/img/logo.png": (_q, r) => r.writeHead(200, { "content-type": "image/png" }).end("png"),
    "/js/app.js": (_q, r) => r.writeHead(200, { "content-type": "text/javascript" }).end("1"),
    "/wp-admin/": (q, r) => {
      hits.push(q.url ?? "");
      r.end("admin");
    },
  });
});
afterAll(async () => {
  await site.close();
  await other.close();
});

describe("extractLinks", () => {
  it("finds links/images/scripts/styles, skips mailto/tel/#/admin/cart, marks internal", () => {
    const links = extractLinks(
      `<a href="/a">a</a><a href="https://ext.com/x">x</a><a href="mailto:m@x">m</a><a href="#s">s</a><a href="/wp-admin/">w</a>
       <a href="/file.pdf">pdf</a><img src="/i.png"><link rel="stylesheet" href="/s.css"><script src="/j.js"></script>`,
      "https://acme.com/",
      "acme.com",
    );
    expect(links.map((l) => `${l.kind}:${l.internal ? "in" : "ext"}:${new URL(l.url).pathname}`)).toEqual([
      "page:in:/a",
      "link:ext:/x",
      "link:in:/file.pdf",
      "image:in:/i.png",
      "script:in:/j.js",
      "style:in:/s.css",
    ]);
  });
});

describe("HTML entities in URLs", () => {
  it("decodes &amp; / numeric entities before requesting (WordPress writes ?a=1&amp;b=2)", () => {
    const [l] = extractLinks(`<a href="/shop?cat=1&amp;page=2&#38;x=%20">s</a>`, "https://acme.com/", "acme.com");
    expect(l!.url).toBe("https://acme.com/shop?cat=1&page=2&x=%20");
  });
});

describe("links check", () => {
  it("crawls the site and reports broken internal + external links, not bot/auth walls", async () => {
    const r = await linksCheck.run(makeSite(`${site.url}/`), makeCtx());
    expect(r).toMatchObject({ status: "WARN", reason: "broken_links" });
    const broken = (r.details!.broken as BrokenLink[]).map((b) => `${b.internal ? "in" : "ext"} ${new URL(b.url).pathname} ${b.status}`);
    expect(broken).toEqual(["in /img/deleted.jpg 404", "in /missing-page 404", "in /services/broken 500", "ext /gone 404"]);
    // Found on the page that links to it.
    const svc = (r.details!.broken as BrokenLink[]).find((b) => b.url.endsWith("/services/broken"))!;
    expect(svc.foundOn[0]).toContain("/services");
    expect(r.metrics).toMatchObject({ brokenInternal: 3, brokenExternal: 1, unverified: 1 });
    expect(r.metrics.pagesCrawled).toBeGreaterThanOrEqual(5);
    expect(hits).toEqual([]); // never GETs admin / add-to-cart URLs
  });

  it("respects the page limit", async () => {
    const r = await linksCheck.run(makeSite(`${site.url}/`, { links: { maxPages: 2 } } as never), makeCtx());
    expect(r.metrics.pagesCrawled).toBe(2);
  });

  it("clean site → OK", async () => {
    const clean = await startServer({ "/": html(`<a href="/a">a</a>`), "/a": html("a") });
    const r = await linksCheck.run(makeSite(`${clean.url}/`), makeCtx());
    await clean.close();
    expect(r.status).toBe("OK");
  });
});
