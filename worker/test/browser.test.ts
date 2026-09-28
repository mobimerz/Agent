import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SettingsDoc } from "@siteguard/db";
import { createBrowserCheck, saveScreenshot } from "../src/checks/browser";
import { formCheck } from "../src/checks/form";
import { closeBrowser } from "../src/lib/browser";
import { makeCtx, makeSite, startServer, type Handler } from "./helpers";

/** Real Chromium, local pages only. Skipped (with a reason) if `pnpm browsers:install` hasn't been run. */
const hasChromium = existsSync(chromium.executablePath());

const page = (body: string, head = ""): Handler => (_q, r) => r.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><head><title>T</title>${head}</head><body>${body}</body></html>`);

const CONTACT = (extra = "") => `
  <h1>Contact Acme Dental</h1>
  <form id="contact" action="/submit" method="post">
    <input name="your-name" required> <input type="email" name="your-email" required>
    <input name="website_hp" style="display:none">
    <textarea name="message"></textarea> ${extra}
    <button type="submit">Send</button>
  </form>
  <p class="form-success" style="display:none">Thanks! We will get back to you.</p>
  <script>
    document.getElementById('contact').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await fetch(e.target.action, { method: 'POST', body: new FormData(e.target) });
      document.querySelector(r.ok ? '.form-success' : '.form-error').style.display = 'block';
    });
  </script>
  <p class="form-error" style="display:none">Sorry, the message could not be sent.</p>`;

let srv: Awaited<ReturnType<typeof startServer>>;
const submissions: string[] = [];
let submitStatus = 200;
let shots: string;

beforeAll(async () => {
  shots = await mkdtemp(join(tmpdir(), "siteguard-shots-"));
  srv = await startServer({
    "/": page("<h1>Welcome to Acme Dental</h1><p>Best dentist in town.</p><img src='/logo.png' width='100' height='50'>"),
    "/logo.png": (_q, r) => r.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg xmlns='http://www.w3.org/2000/svg' width='100' height='50'/>"),
    "/blank": page("<div id='root'></div>", "<script>throw new Error('Cannot read properties of undefined (reading \"map\")')</script>"),
    "/jserror": page("<h1>Shop</h1><p>Products listed here with enough text.</p><script>window.addEventListener('load',()=>{ undefinedFn(); })</script>"),
    "/missing-js": page("<h1>Home</h1><p>Plenty of visible text on this page.</p>", "<script src='/js/app.js'></script><link rel='stylesheet' href='/css/style.css'>"),
    "/contact": page(CONTACT()),
    "/contact-captcha": page(CONTACT("<div class='g-recaptcha' data-sitekey='x'></div>")),
    "/no-form": page("<h1>Contact</h1><p>Call us.</p><form role='search'><input type='search' name='q'></form>"),
    "/submit": (req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        submissions.push(body);
        res.writeHead(submitStatus).end("{}");
      });
    },
  });
});
afterAll(async () => {
  await closeBrowser();
  await srv?.close();
  await rm(shots, { recursive: true, force: true });
});

const ctx = () => makeCtx({ timeoutMs: 20_000, settings: { screenshotsKeep: 7 } as SettingsDoc });

describe.skipIf(!hasChromium)("browser health (real Chromium)", () => {
  // Screenshots go to the temp dir (created in beforeAll), never the real .dev-data.
  const check = { run: (...a: Parameters<ReturnType<typeof createBrowserCheck>["run"]>) => createBrowserCheck({ screenshotRoot: shots }).run(...a) };

  it("healthy page → OK with a screenshot on disk", async () => {
    const site = makeSite(`${srv.url}/`);
    const r = await check.run(site, ctx());
    expect(r.status).toBe("OK");
    expect(r.metrics).toMatchObject({ pageErrors: 0, failedResources: 0 });
    const file = r.details!.screenshot as string;
    expect(file).toMatch(new RegExp(`^${String(site._id)}/.+\\.jpg$`));
    expect(existsSync(join(shots, file))).toBe(true);
  });

  it("blank page (crashed JS app) → WARN blank_page with the JS error", async () => {
    const r = await check.run(makeSite(`${srv.url}/blank`), ctx());
    expect(r).toMatchObject({ status: "WARN", reason: "blank_page" });
    expect(r.message).toContain("Cannot read properties of undefined");
  });

  it("uncaught JS error on a rendered page → WARN js_errors", async () => {
    const r = await check.run(makeSite(`${srv.url}/jserror`), ctx());
    expect(r).toMatchObject({ status: "WARN", reason: "js_errors" });
    expect(r.message).toContain("undefinedFn");
  });

  it("own script/stylesheet 404 → WARN resource_errors", async () => {
    const r = await check.run(makeSite(`${srv.url}/missing-js`), ctx());
    expect(r).toMatchObject({ status: "WARN", reason: "resource_errors" });
    expect(r.message).toContain("/js/app.js (404)");
  });
});

describe("screenshots", () => {
  it("keeps only the newest N per site", async () => {
    for (let i = 0; i < 5; i++) {
      await saveScreenshot("site1", Buffer.from("jpg"), 3, shots);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(await readdir(join(shots, "site1"))).toHaveLength(3);
  });
});

describe.skipIf(!hasChromium)("contact form (real Chromium)", () => {
  const form = (path: string, extra: Record<string, unknown> = {}) =>
    makeSite(`${srv.url}/`, { form: { pageUrl: path, selector: "form", testSubmission: false, successText: "", ...extra } } as never);

  it("render check only (default): finds fields + submit, never submits", async () => {
    const before = submissions.length;
    const r = await formCheck.run(form("/contact"), ctx());
    expect(r).toMatchObject({ status: "OK", reason: "ok" });
    expect(r.metrics).toMatchObject({ fields: 3, required: 2, submitted: false });
    expect(submissions.length).toBe(before);
  });

  it("missing form (search forms don't count) → FAIL form_missing", async () => {
    const r = await formCheck.run(form("/no-form"), ctx());
    expect(r).toMatchObject({ status: "FAIL", reason: "form_missing" });
  });

  it("test submission: fills test data (not the honeypot) and detects success", async () => {
    submitStatus = 200;
    const r = await formCheck.run(form("/contact", { testSubmission: true }), ctx());
    expect(r).toMatchObject({ status: "OK", reason: "ok" });
    expect(r.message).toContain("Test submission succeeded");
    const sent = submissions.at(-1)!;
    expect(sent).toContain("[SITEGUARD-TEST]");
    expect(sent).toContain("siteguard-test@example.com");
    expect(sent).toMatch(/name="website_hp"\r\n\r\n\r\n/); // honeypot left empty
  });

  it("server error on submit → FAIL form_failed, and no 60 s re-submissions", async () => {
    submitStatus = 500;
    const site = form("/contact", { testSubmission: true });
    const r = await formCheck.run(site, ctx());
    expect(r).toMatchObject({ status: "FAIL", reason: "form_failed" });
    expect(formCheck.confirmRetries!(site)).toBe(0);
    expect(formCheck.confirmRetries!(form("/contact"))).toBeUndefined();
  });

  it("empty form page = the site URL itself (path + query kept), not the host root", async () => {
    const site = makeSite(`${srv.url}/contact?lang=en`, { form: { pageUrl: "", selector: "form", testSubmission: false, successText: "" } } as never);
    const r = await formCheck.run(site, ctx());
    expect(r).toMatchObject({ status: "OK", target: `${srv.url}/contact?lang=en` });
  });

  it("CAPTCHA → renders OK, submission skipped", async () => {
    const before = submissions.length;
    const r = await formCheck.run(form("/contact-captcha", { testSubmission: true }), ctx());
    expect(r).toMatchObject({ status: "OK", reason: "form_captcha" });
    expect(submissions.length).toBe(before);
  });
});

it.runIf(!hasChromium)("browser tests skipped: run `pnpm browsers:install`", () => {
  expect(hasChromium).toBe(false);
});
