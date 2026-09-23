import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentCheck, visibleText } from "../src/checks/content";
import { makeCtx, makeSite, startServer } from "./helpers";

let srv: Awaited<ReturnType<typeof startServer>>;
let page = "";

beforeAll(async () => {
  srv = await startServer({
    "/": (_req, res) => res.end(page),
    "/down": (_req, res) => {
      res.statusCode = 503;
      res.end("");
    },
  });
});
afterAll(async () => {
  await srv.close();
});

const html = (body: string) => `<html><head><title>Acme Dental</title><script>var x="viagra";</script></head><body>${body}</body></html>`;

describe("visibleText", () => {
  it("drops scripts, styles and tags", () => {
    expect(visibleText('<style>.a{}</style><p>Hi&nbsp;<b>there</b></p><script>evil()</script>')).toBe("Hi there");
  });
});

describe("content check", () => {
  it("OK when keyword is present (spam words inside <script> are ignored)", async () => {
    page = html("<h1>Welcome to Acme Dental</h1>");
    const r = await contentCheck.run(makeSite(srv.url, { content: { requiredKeyword: "acme dental", extraSpamWords: [] } } as never), makeCtx());
    expect(r).toMatchObject({ status: "OK", reason: "ok" });
    expect(r.jobData?.sizeBaseline).toBe(Buffer.byteLength(page));
  });

  it("FAIL keyword_missing", async () => {
    page = html("<h1>Under construction</h1>");
    const r = await contentCheck.run(makeSite(srv.url, { content: { requiredKeyword: "Book appointment", extraSpamWords: [] } } as never), makeCtx());
    expect(r).toMatchObject({ status: "FAIL", reason: "keyword_missing" });
  });

  it("FAIL spam_detected for defacement", async () => {
    page = html("<h1>Hacked by XYZ</h1><div style='display:none'>best online casino</div>");
    const r = await contentCheck.run(makeSite(srv.url), makeCtx());
    expect(r).toMatchObject({ status: "FAIL", reason: "spam_detected" });
    expect(r.details?.spamFound).toEqual(expect.arrayContaining(["hacked by", "online casino"]));
  });

  it("WARN size_changed vs baseline", async () => {
    page = html("<p>tiny</p>");
    const r = await contentCheck.run(makeSite(srv.url), makeCtx({ jobData: { sizeBaseline: 100_000 } }));
    expect(r).toMatchObject({ status: "WARN", reason: "size_changed" });
    expect(r.metrics.sizeChangePct).toBeLessThan(-50);
  });

  it("UNKNOWN (no double alert) when the page is down", async () => {
    const r = await contentCheck.run(makeSite(`${srv.url}/down`), makeCtx());
    expect(r).toMatchObject({ status: "UNKNOWN", reason: "unreachable" });
  });
});
