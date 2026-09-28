import { afterAll, describe, expect, it } from "vitest";
import type { HeaderChecklistItem, HeaderItemId } from "@siteguard/core";
import { evaluateHeaders, findMixedContent, headerGrade, headersCheck } from "../src/checks/headers";
import { classify } from "../src/incidents/engine";
import { makeCtx, makeSite, startServer } from "./helpers";

const GOOD = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=()",
};

const byId = (items: HeaderChecklistItem[]) => (id: HeaderItemId) => items.find((i) => i.id === id)!;

describe("evaluateHeaders", () => {
  it("a well-configured https site passes everything → grade A", () => {
    const items = evaluateHeaders(new Headers(GOOD), "<html><img src='/a.png'></html>", true);
    expect(items.every((i) => i.status === "pass")).toBe(true);
    expect(headerGrade(items)).toEqual({ score: 100, grade: "A" });
  });

  it("flags missing headers with the right level", () => {
    const get = byId(evaluateHeaders(new Headers({ server: "Apache/2.4.41 (Ubuntu)", "x-powered-by": "PHP/7.4.3" }), "", true));
    expect(get("hsts").status).toBe("warn");
    expect(get("frame_options").status).toBe("warn");
    expect(get("content_type_options").status).toBe("warn");
    expect(get("csp").status).toBe("info");
    expect(get("server_disclosure")).toMatchObject({ status: "info", detail: "Server: Apache/2.4.41 (Ubuntu) · X-Powered-By: PHP/7.4.3" });
  });

  it("weak HSTS and X-Frame-Options via CSP frame-ancestors", () => {
    const get = byId(evaluateHeaders(new Headers({ ...GOOD, "strict-transport-security": "max-age=300" }), "", true));
    expect(get("hsts").status).toBe("warn");
    expect(get("frame_options")).toMatchObject({ status: "pass", detail: "CSP frame-ancestors" });
  });

  it("http-only sites: HSTS and mixed content are not applicable", () => {
    const get = byId(evaluateHeaders(new Headers(), "<script src='http://x.com/a.js'></script>", false));
    expect(get("hsts").status).toBe("na");
    expect(get("mixed_content").status).toBe("na");
  });
});

describe("findMixedContent", () => {
  it("separates active (blocked) from passive resources and ignores comments/links", () => {
    const html = `<script src="http://cdn.x.com/app.js"></script>
      <link rel="stylesheet" href="http://cdn.x.com/s.css"><link rel="canonical" href="http://x.com/">
      <img src="http://x.com/logo.png"><a href="http://other.com">link</a>
      <!-- <script src="http://old.com/a.js"></script> -->`;
    expect(findMixedContent(html)).toEqual({ active: ["http://cdn.x.com/app.js", "http://cdn.x.com/s.css"], passive: ["http://x.com/logo.png"] });
  });
});

describe("alerting", () => {
  it("missing headers never open an incident; mixed content does (Telegram, 1 run)", () => {
    expect(classify("headers", { status: "WARN", reason: "headers_missing" })).toBeNull();
    expect(classify("headers", { status: "WARN", reason: "mixed_content" })).toMatchObject({ severity: "WARNING", email: false, telegram: true, confirmRuns: 1 });
  });
});

describe("headers check", () => {
  const servers: Awaited<ReturnType<typeof startServer>>[] = [];
  afterAll(() => Promise.all(servers.map((s) => s.close())));

  it("reports missing headers as WARN with a grade (http target → HSTS n/a)", async () => {
    const srv = await startServer({ "/": (_q, r) => r.writeHead(200, { "content-type": "text/html", "x-content-type-options": "nosniff" }).end("<html>hi</html>") });
    servers.push(srv);
    const r = await headersCheck.run(makeSite(`${srv.url}/`), makeCtx());
    expect(r).toMatchObject({ status: "WARN", reason: "headers_missing" });
    expect(r.message).toMatch(/^Grade [A-F]/);
    expect(r.message).toContain("Clickjacking protection");
  });

  it("unreachable page → UNKNOWN", async () => {
    const srv = await startServer({ "/": (_q, r) => r.writeHead(500).end("boom") });
    servers.push(srv);
    expect((await headersCheck.run(makeSite(`${srv.url}/`), makeCtx())).status).toBe("UNKNOWN");
  });
});
