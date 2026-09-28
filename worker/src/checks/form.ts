import type { Page } from "playwright";
import { BrowserUnavailableError, withBrowserContext } from "../lib/browser";
import type { CheckModule, CheckRunResult } from "./types";

export const TEST_MARKER = "[SITEGUARD-TEST]";
export const TEST_VALUES = {
  name: `${TEST_MARKER} SiteGuard Monitor`,
  email: "siteguard-test@example.com",
  phone: "9999999999",
  message: `${TEST_MARKER} Automated contact-form check by SiteGuard website monitoring. Please ignore this message.`,
};

/** Success / failure markers of common form plugins (WordPress CF7, WPForms, Elementor, Gravity, Ninja, Formidable, HubSpot). */
const SUCCESS_SELECTORS = [
  "form.sent .wpcf7-response-output",
  ".wpforms-confirmation-container",
  ".wpforms-confirmation-container-full",
  ".elementor-message-success",
  ".gform_confirmation_message",
  ".nf-response-msg",
  ".frm_message",
  ".submitted-message",
  "[role=alert].success",
  ".form-success",
  ".alert-success",
];
const ERROR_SELECTORS = [
  "form.failed .wpcf7-response-output",
  "form.aborted .wpcf7-response-output",
  "form.spam .wpcf7-response-output",
  ".elementor-message-danger",
  ".wpforms-error-container",
  ".gform_validation_error",
  ".nf-error-msg",
  ".frm_error_style",
  ".alert-danger",
  ".form-error",
];
const CAPTCHA_SELECTORS = [
  "iframe[src*='recaptcha']",
  "iframe[src*='hcaptcha']",
  "iframe[src*='challenges.cloudflare.com']",
  ".g-recaptcha",
  ".h-captcha",
  ".cf-turnstile",
  "[data-sitekey]",
];

export interface FormInfo {
  found: boolean;
  fields: number;
  required: number;
  hasSubmit: boolean;
  captcha: boolean;
}

/** Index of the first visible, non-search form matching the selector, or -1. */
async function pickForm(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const forms = [...document.querySelectorAll(sel)].map((el) => (el.tagName === "FORM" ? el : (el.closest("form") ?? el)));
    return forms.findIndex((f) => {
      const r = f.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return false;
      if (f.getAttribute("role") === "search" || f.querySelector("input[type=search]")) return false;
      return f.querySelectorAll("input:not([type=hidden]), textarea, select").length > 0;
    });
  }, selector);
}

async function describe(page: Page, selector: string, index: number): Promise<FormInfo> {
  return page.evaluate(
    ({ sel, i, captchaSel }) => {
      const el = document.querySelectorAll(sel)[i]!;
      const f = el.tagName === "FORM" ? el : (el.closest("form") ?? el);
      const visible = (e: Element) => (e as HTMLElement).offsetParent !== null;
      const fields = [...f.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select")].filter(visible);
      const hasSubmit = Boolean(f.querySelector("button:not([type=button]):not([type=reset]), input[type=submit], input[type=image], [role=button][type=submit]"));
      return {
        found: true,
        fields: fields.length,
        required: fields.filter((x) => x.hasAttribute("required") || x.getAttribute("aria-required") === "true").length,
        hasSubmit,
        captcha: captchaSel.some((c) => f.querySelector(c) ?? (c.startsWith("iframe") ? document.querySelector(c) : null)),
      };
    },
    { sel: selector, i: index, captchaSel: CAPTCHA_SELECTORS },
  );
}

/** Fill every visible field with obviously-fake test data (hidden honeypot fields are left empty). */
async function fill(page: Page, selector: string, index: number): Promise<void> {
  const form = page.locator(selector).nth(index);
  const fields = form.locator("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]), textarea, select");
  const count = await fields.count();
  for (let i = 0; i < count; i++) {
    const f = fields.nth(i);
    if (!(await f.isVisible().catch(() => false))) continue;
    const meta = await f.evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      type: ((el as HTMLInputElement).type ?? "").toLowerCase(),
      hint: `${el.getAttribute("name") ?? ""} ${el.id} ${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("autocomplete") ?? ""}`.toLowerCase(),
      required: (el as HTMLInputElement).required || el.getAttribute("aria-required") === "true",
    }));
    if (meta.tag === "select") {
      const value = await f.evaluate((el) => [...(el as HTMLSelectElement).options].find((o) => o.value && !o.disabled)?.value ?? "");
      if (value) await f.selectOption(value).catch(() => {});
      continue;
    }
    if (meta.type === "checkbox" || meta.type === "radio") {
      if (meta.required) await f.check({ force: true }).catch(() => {});
      continue;
    }
    const value =
      meta.tag === "textarea"
        ? TEST_VALUES.message
        : meta.type === "email" || /mail/.test(meta.hint)
          ? TEST_VALUES.email
          : meta.type === "tel" || /phone|mobile|tel/.test(meta.hint)
            ? TEST_VALUES.phone
            : meta.type === "number"
              ? "1"
              : meta.type === "url"
                ? "https://example.com"
                : meta.type === "date"
                  ? new Date().toISOString().slice(0, 10)
                  : /subject/.test(meta.hint)
                    ? `${TEST_MARKER} Form check`
                    : TEST_VALUES.name;
    await f.fill(value).catch(() => {});
  }
}

type SubmitVerdict = { ok: true; how: string } | { ok: false; how: string } | { ok: null; how: string };

async function submitAndJudge(page: Page, selector: string, index: number, successText: string): Promise<SubmitVerdict> {
  const before = page.url();
  let badStatus: number | null = null;
  page.on("response", (r) => {
    if (r.request().method() === "POST" && r.status() >= 400 && badStatus === null) badStatus = r.status();
  });
  const form = page.locator(selector).nth(index);
  const button = form.locator("button:not([type=button]):not([type=reset]), input[type=submit], input[type=image]").first();
  await Promise.all([page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {}), button.click({ timeout: 10_000 })]);
  // AJAX forms show their message a moment after the request completes.
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const text = (await page.evaluate(() => document.body?.innerText ?? "").catch(() => "")).toLowerCase();
    if (successText && text.includes(successText.toLowerCase())) return { ok: true, how: `success text “${successText}” shown` };
    for (const s of ERROR_SELECTORS) if (await page.locator(s).first().isVisible().catch(() => false)) return { ok: false, how: `error shown: ${(await page.locator(s).first().innerText().catch(() => s)).slice(0, 160)}` };
    for (const s of SUCCESS_SELECTORS) if (await page.locator(s).first().isVisible().catch(() => false)) return { ok: true, how: `plugin success message: ${(await page.locator(s).first().innerText().catch(() => s)).slice(0, 160)}` };
    if (badStatus) return { ok: false, how: `form endpoint returned HTTP ${badStatus}` };
    if (!successText && page.url() !== before && /thank|success|sent|confirm/i.test(page.url())) return { ok: true, how: `redirected to ${page.url()}` };
    await page.waitForTimeout(500);
  }
  return { ok: null, how: successText ? `success text “${successText}” did not appear` : "no success message detected" };
}

export const formCheck: CheckModule = {
  type: "form",
  queue: "browser",
  maxRunMs: 3 * 60_000,
  // A test submission emails the client: never re-submit every 60 s to "confirm" a failure.
  confirmRetries: (site) => (site.form?.testSubmission ? 0 : undefined),

  async run(site, ctx): Promise<CheckRunResult> {
    const cfg = site.form ?? { pageUrl: "", selector: "form", testSubmission: false, successText: "" };
    // Empty = the site URL itself (not "/" — the site may live under a path or need its query).
    const url = cfg.pageUrl?.trim() ? new URL(cfg.pageUrl.trim(), site.url).toString() : site.url;
    const selector = cfg.selector?.trim() || "form";
    try {
      return await withBrowserContext(async (context) => {
        const page = await context.newPage();
        const res = await page.goto(url, { waitUntil: "load", timeout: ctx.timeoutMs ?? 45_000 });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        if ((res?.status() ?? 0) >= 400) {
          return { status: "UNKNOWN" as const, reason: "unreachable" as const, message: `Form page returned HTTP ${res?.status()} — see uptime check`, metrics: {}, target: url };
        }

        const index = await pickForm(page, selector).catch(() => -1);
        if (index < 0) {
          return { status: "FAIL" as const, reason: "form_missing" as const, message: `No visible form matching “${selector}” on ${new URL(url).pathname}`, metrics: { fields: 0 }, target: url, details: { url, selector } };
        }
        const info = await describe(page, selector, index);
        const metrics = { fields: info.fields, required: info.required, captcha: info.captcha, submitted: false };
        const details: Record<string, unknown> = { url, selector, ...info, testSubmission: cfg.testSubmission };
        if (!info.hasSubmit) {
          return { status: "FAIL" as const, reason: "form_missing" as const, message: `Form found but it has no submit button (${info.fields} fields)`, metrics, details, target: url };
        }
        const shape = `${info.fields} field${info.fields === 1 ? "" : "s"}${info.required ? ` (${info.required} required)` : ""}, submit button${info.captcha ? ", CAPTCHA" : ""}`;
        if (!cfg.testSubmission) {
          return { status: "OK" as const, reason: "ok" as const, message: `Form renders: ${shape}. Test submission is off.`, metrics, details, target: url };
        }
        if (info.captcha) {
          return { status: "OK" as const, reason: "form_captcha" as const, message: `Form renders (${shape}); CAPTCHA present, so the test submission was skipped`, metrics, details, target: url };
        }

        await fill(page, selector, index);
        const verdict = await submitAndJudge(page, selector, index, cfg.successText ?? "");
        const done = { ...metrics, submitted: true };
        details.submission = verdict.how;
        if (verdict.ok === true) return { status: "OK" as const, reason: "ok" as const, message: `Test submission succeeded — ${verdict.how}`, metrics: done, details, target: url };
        if (verdict.ok === false) return { status: "FAIL" as const, reason: "form_failed" as const, message: `Test submission failed — ${verdict.how}`, metrics: done, details, target: url };
        return {
          status: "UNKNOWN" as const,
          reason: "form_failed" as const,
          message: `Submitted, but could not confirm success (${verdict.how}). Set “Success text” in the site settings to the message the form shows.`,
          metrics: done,
          details,
          target: url,
        };
      });
    } catch (err) {
      if (err instanceof BrowserUnavailableError) return { status: "UNKNOWN", reason: "not_applicable", message: err.message, metrics: {} };
      return { status: "UNKNOWN", reason: "unreachable", message: `Form page did not load: ${(err as Error).message.split("\n")[0]}`, metrics: {}, target: url };
    }
  },
};
