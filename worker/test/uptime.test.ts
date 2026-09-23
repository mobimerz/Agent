import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyNetworkError, httpGet } from "../src/lib/http";
import { detectBotProtection } from "../src/lib/bot-protection";
import { uptimeCheck } from "../src/checks/uptime";
import { makeCtx, makeSite, startServer } from "./helpers";

let srv: Awaited<ReturnType<typeof startServer>>;
const methods: string[] = [];

beforeAll(async () => {
  srv = await startServer({
    "/ok": (req, res) => {
      methods.push(req.method ?? "");
      res.end("<html><title>Hello</title><body>Welcome</body></html>");
    },
    "/500": (_req, res) => {
      res.statusCode = 500;
      res.end("boom");
    },
    "/404": (_req, res) => {
      res.statusCode = 404;
      res.end("nope");
    },
    "/slow": (_req, res) => {
      setTimeout(() => res.end("late"), 400);
    },
    "/hang": () => {
      /* never responds */
    },
    "/r1": (_req, res) => {
      res.writeHead(301, { location: "/r2" }).end();
    },
    "/r2": (_req, res) => {
      res.writeHead(302, { location: "/ok" }).end();
    },
    "/loop": (_req, res) => {
      res.writeHead(302, { location: "/loop" }).end();
    },
    "/cf": (_req, res) => {
      res.writeHead(403, { server: "cloudflare", "cf-mitigated": "challenge" });
      res.end("<html><title>Just a moment...</title></html>");
    },
    "/cf503": (_req, res) => {
      res.writeHead(503, { server: "cloudflare" });
      res.end('<html><head><title>Just a moment...</title></head><body><div id="challenge-platform"></div></body></html>');
    },
    "/sucuri": (_req, res) => {
      res.writeHead(403);
      res.end("<h1>Access Denied - Sucuri Website Firewall</h1>");
    },
  });
});

afterAll(async () => {
  await srv.close();
});

describe("httpGet", () => {
  it("uses GET (not HEAD)", async () => {
    await httpGet(`${srv.url}/ok`);
    expect(methods.at(-1)).toBe("GET");
  });

  it("follows redirects and records the chain + final URL", async () => {
    const r = await httpGet(`${srv.url}/r1`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe(200);
    expect(r.finalUrl).toBe(`${srv.url}/ok`);
    expect(r.redirects.map((h) => h.status)).toEqual([301, 302]);
  });

  it("stops after 5 redirects", async () => {
    const r = await httpGet(`${srv.url}/loop`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("too_many_redirects");
    expect(r.redirects).toHaveLength(6);
  });

  it("classifies a timeout", async () => {
    const r = await httpGet(`${srv.url}/hang`, { timeoutMs: 300 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
  });

  it("classifies connection refused", async () => {
    // Grab a free port, then close it so nothing listens there. (Port 1 is fetch-spec "bad port".)
    const tmp = await startServer({});
    const closedUrl = tmp.url;
    await tmp.close();
    const r = await httpGet(closedUrl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("refused");
  });

  it("classifies DNS failure", async () => {
    const r = await httpGet("http://siteguard-does-not-exist.invalid/", { timeoutMs: 10_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("dns");
  });

  it("truncates large bodies", async () => {
    const r = await httpGet(`${srv.url}/ok`, { maxBodyBytes: 10 });
    expect(r.ok && r.truncated).toBe(true);
  });
});

describe("classifyNetworkError", () => {
  const wrap = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

  it.each([
    ["CERT_HAS_EXPIRED", "ssl"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "ssl"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "ssl"],
    ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ssl"],
    ["ECONNRESET", "reset"],
    ["EAI_AGAIN", "dns"],
    ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
    ["EHOSTUNREACH", "network"],
  ])("%s → %s", (code, reason) => {
    expect(classifyNetworkError(wrap(code)).reason).toBe(reason);
  });

  it("reads codes from AggregateError (happy eyeballs)", () => {
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: new AggregateError([Object.assign(new Error("x"), { code: "ECONNREFUSED" })]),
    });
    expect(classifyNetworkError(err).reason).toBe("refused");
  });
});

describe("detectBotProtection", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("ignores normal pages, even behind a CDN", () => {
    expect(detectBotProtection(200, h({ server: "cloudflare" }), "<html>ok</html>")).toBeNull();
    expect(detectBotProtection(200, h({ server: "ddos-guard" }), "<html>ok</html>")).toBeNull();
    expect(detectBotProtection(500, h({ server: "cloudflare" }), "error")).toBeNull();
  });

  it("does not treat a plain 403 as blocked", () => {
    expect(detectBotProtection(403, h({ server: "nginx" }), "<h1>Forbidden</h1>")).toBeNull();
  });

  it("detects rate limiting", () => {
    expect(detectBotProtection(429, h({}), "")?.provider).toBe("rate limiter");
  });
});

describe("uptime check", () => {
  const run = (path: string, extra = {}) => uptimeCheck.run(makeSite(`${srv.url}${path}`, extra), makeCtx());

  it("OK for a healthy page", async () => {
    const r = await run("/ok");
    expect(r).toMatchObject({ status: "OK", reason: "ok" });
    expect(r.metrics.statusCode).toBe(200);
    expect(typeof r.metrics.responseTimeMs).toBe("number");
  });

  it("FAIL http_5xx", async () => {
    expect(await run("/500")).toMatchObject({ status: "FAIL", reason: "http_5xx", message: "HTTP 500 server error" });
  });

  it("FAIL http_4xx", async () => {
    expect(await run("/404")).toMatchObject({ status: "FAIL", reason: "http_4xx" });
  });

  it("WARN slow above the threshold", async () => {
    const r = await uptimeCheck.run(makeSite(`${srv.url}/slow`), makeCtx({ thresholds: { ...makeCtx().thresholds, responseTimeWarnMs: 200 } }));
    expect(r).toMatchObject({ status: "WARN", reason: "slow" });
  });

  it("FAIL timeout", async () => {
    expect(await uptimeCheck.run(makeSite(`${srv.url}/hang`), makeCtx({ timeoutMs: 300 }))).toMatchObject({ status: "FAIL", reason: "timeout" });
  });

  it.each(["/cf", "/cf503", "/sucuri"])("BLOCKED (WARN, not DOWN) for bot protection: %s", async (path) => {
    const r = await run(path);
    expect(r).toMatchObject({ status: "WARN", reason: "blocked" });
    expect(r.details?.blockedBy).toBeTruthy();
  });

  it("reports redirect chain and final URL", async () => {
    const r = await run("/r1");
    expect(r.status).toBe("OK");
    expect(r.details?.finalUrl).toBe(`${srv.url}/ok`);
    expect(r.metrics.redirects).toBe(2);
  });

  it("degrades to WARN page_error when an important page fails", async () => {
    const r = await run("/ok", { importantPages: ["/500", "/ok"] });
    expect(r).toMatchObject({ status: "WARN", reason: "page_error" });
    expect(r.message).toContain("/500");
    expect((r.details?.pages as unknown[]).length).toBe(2);
  });
});
