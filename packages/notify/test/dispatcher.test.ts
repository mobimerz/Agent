import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AlertData } from "@siteguard/core";
import { renderTestEmail } from "@siteguard/emails";
import { AlertEvent, EmailLog, getSettings, JobState, jobKeys, Notification, Outbox, type SettingsDoc } from "@siteguard/db";
import { startTestDb } from "../../db/test/setup-mongo";
import {
  BREVO_SEND_URL,
  createNotifyContext,
  dispatchPendingAlerts,
  emailStatus,
  formatAlertTelegram,
  getEmailQuota,
  queueAlert,
  runWorkerWatchdog,
  sendEmail,
  sendTestEmail,
  sendTestTelegram,
  telegramStatus,
  type NotifyConfig,
} from "../src";

const msw = setupServer();
let db: Awaited<ReturnType<typeof startTestDb>>;
let settings: SettingsDoc;

beforeAll(async () => {
  msw.listen({ onUnhandledRequest: "error" });
  db = await startTestDb();
  settings = await getSettings();
});
afterAll(async () => {
  msw.close();
  await db?.stop();
});
beforeEach(async () => {
  msw.resetHandlers();
  await Promise.all([AlertEvent.deleteMany({}), EmailLog.deleteMany({}), Outbox.deleteMany({}), Notification.deleteMany({}), JobState.deleteMany({})]);
});

const preview: NotifyConfig = {
  appUrl: "http://localhost:3000",
  timeZone: "Asia/Kolkata",
  dryRun: true,
  fromName: "SiteGuard",
  envAlertEmails: ["team@mycompany.com"],
  envTelegramChatIds: ["-1001", "12345"],
};
const live: NotifyConfig = { ...preview, dryRun: false, brevoApiKey: "xkeysib-live", fromEmail: "alerts@mycompany.com", telegramBotToken: "1:TOKEN" };
const NOW = new Date("2026-09-23T06:30:00Z"); // 12:00 IST

const ctxFor = (config: NotifyConfig) => createNotifyContext(config, { settings, now: () => NOW, sleep: async () => {} });

function alert(i: number, extra: Partial<AlertData> = {}): AlertData {
  return {
    type: "opened",
    severity: "CRITICAL",
    title: "Site is down",
    siteName: `Client Site ${i}`,
    clientName: "Sharma & Sons <Pvt>",
    siteUrl: `https://site${i}.example`,
    checkLabel: "Uptime / HTTP",
    reason: "timeout",
    message: "Timeout after 30 s",
    startedAt: "2026-09-23T06:15:00.000Z",
    lastOkAt: "2026-09-23T06:10:00.000Z",
    link: `http://localhost:3000/sites/${i}`,
    ...extra,
  };
}
const queue = (i: number, extra: Partial<AlertData> = {}, opts: { priority?: boolean } = {}) =>
  queueAlert({ data: alert(i, extra), channels: { email: true, telegram: true, inApp: true }, ...opts });

describe("preview mode (no credentials)", () => {
  it("is automatic when keys are missing, even with DRY_RUN=false", () => {
    const cfg = { ...preview, dryRun: false };
    expect(emailStatus(cfg, settings)).toMatchObject({ mode: "preview", reasons: ["BREVO_API_KEY is not set", "ALERT_FROM_EMAIL is not set"] });
    expect(telegramStatus(cfg, settings)).toMatchObject({ mode: "preview", reasons: ["TELEGRAM_BOT_TOKEN is not set"] });
    expect(emailStatus(live, settings).mode).toBe("live");
  });

  it("stores the exact rendered email + Telegram text instead of sending", async () => {
    await queue(1);
    const ctx = await ctxFor(preview);
    await dispatchPendingAlerts(ctx);

    const [ev] = await AlertEvent.find().lean();
    expect(ev!.channels).toEqual({ email: "preview", telegram: "preview" });
    const mail = (await Outbox.findOne({ channel: "email" }).lean())!;
    expect(mail.subject).toBe("🔴 CRITICAL: Site is down — Client Site 1 (Timeout after 30 s)");
    expect(mail.to).toEqual(["team@mycompany.com"]);
    expect(mail.html).toContain("Client Site 1");
    expect(mail.html).toContain("23 Sept 2026, 11:45 am IST"); // started (IST)
    expect(mail.html).toContain("23 Sept 2026, 11:40 am IST"); // last successful check
    expect(mail.html).toContain("http://localhost:3000/sites/1");
    const tg = (await Outbox.findOne({ channel: "telegram" }).lean())!;
    expect(tg.to).toEqual(["-1001", "12345"]);
    expect((tg.request as { body: { parse_mode: string } }).body.parse_mode).toBe("HTML");
    expect(await Notification.countDocuments()).toBe(1); // in-app written at queue time
  });
});

describe("Telegram formatting", () => {
  it("short HTML message with emoji, escaping, IST times and link", () => {
    const text = formatAlertTelegram(alert(1), "Asia/Kolkata");
    expect(text.split("\n")[0]).toBe("🔴 <b>CRITICAL</b> · Client Site 1");
    expect(text).toContain("Client: Sharma &amp; Sons &lt;Pvt&gt;");
    expect(text).toContain("Reason: Timeout after 30 s");
    expect(text).toContain("Since: 23 Sept 2026, 11:45 am IST");
    expect(text).toContain("Last OK: 23 Sept 2026, 11:40 am IST");
    expect(text).toContain('<a href="http://localhost:3000/sites/1">Open in SiteGuard</a>');
    const resolved = formatAlertTelegram(alert(1, { type: "resolved", durationSec: 754 }), "Asia/Kolkata");
    expect(resolved).toMatch(/^🟢 <b>RESOLVED<\/b>/);
    expect(resolved).toContain("Downtime: <b>12 min</b>");
    expect(formatAlertTelegram(alert(1, { severity: "WARNING", title: "Slow response" }), "Asia/Kolkata")).toMatch(/^🟠/);
  });
});

describe("grouping (5+ within 10 min → ONE email)", () => {
  it("sends individually below the threshold", async () => {
    for (const i of [1, 2, 3]) await queue(i);
    await dispatchPendingAlerts(await ctxFor(preview));
    expect(await Outbox.countDocuments({ channel: "email" })).toBe(3);
    expect(await Outbox.countDocuments({ channel: "telegram" })).toBe(3);
  });

  it("groups a burst into one email and one Telegram message", async () => {
    for (const i of [1, 2, 3, 4, 5, 6]) await queue(i);
    const n = await dispatchPendingAlerts(await ctxFor(preview));
    expect(n).toEqual({ telegram: 1, email: 1 });
    const mail = (await Outbox.findOne({ channel: "email" }).lean())!;
    expect(mail.subject).toBe("🔴 SiteGuard: 6 alerts (6 critical)");
    expect(await AlertEvent.countDocuments({ "channels.email": "grouped", "channels.telegram": "grouped" })).toBe(6);
    expect((await EmailLog.findOne({ category: "digest" }).lean())!.items).toBe(6);
  });

  it("after 4 recent alert emails, the next ones are grouped (and held until the window passes)", async () => {
    for (const i of [1, 2, 3, 4]) await queue(i);
    await dispatchPendingAlerts(await ctxFor(preview)); // 4 individual
    await queue(5);
    await dispatchPendingAlerts(await ctxFor(preview)); // 4 recent + 1 → grouped
    expect(await EmailLog.countDocuments({ category: "digest" })).toBe(1);
    await queue(6);
    await dispatchPendingAlerts(await ctxFor(preview)); // group already sent this window → hold
    expect(await AlertEvent.countDocuments({ "channels.email": "pending" })).toBe(1);
  });

  it("priority alerts (hacked site) always go out individually", async () => {
    for (const i of [1, 2, 3, 4, 5]) await queue(i);
    await queue(9, { title: "Possible hacked site — spam/hack content found" }, { priority: true });
    await dispatchPendingAlerts(await ctxFor(preview));
    const subjects = (await Outbox.find({ channel: "email" }).lean()).map((m) => m.subject);
    expect(subjects).toContain("🔴 CRITICAL: Possible hacked site — spam/hack content found — Client Site 9 (Timeout after 30 s)");
    expect(subjects.some((s) => s?.includes("5 alerts"))).toBe(true);
  });
});

describe("Brevo quota guard", () => {
  async function fillLog(n: number) {
    await EmailLog.insertMany(Array.from({ length: n }, () => ({ day: "2026-09-23", category: "alert", status: "sent", sentAt: NOW })));
  }

  it("keeps 10 emails reserved for the daily reports", async () => {
    await fillLog(240); // 250 limit − 10 reserved = 240 for alerts
    const ctx = await ctxFor(preview);
    const q = await getEmailQuota(ctx);
    expect(q).toMatchObject({ used: 240, remainingForAlerts: 0, remainingTotal: 10 });

    await queue(1);
    await dispatchPendingAlerts(ctx);
    const [ev] = await AlertEvent.find().lean();
    expect(ev!.channels).toEqual({ email: "skipped", telegram: "preview" }); // Telegram still delivered
    expect(ev!.deliveryErrors?.email).toMatch(/kept for reports/);

    const report = await sendEmail(ctx, { category: "report", rendered: await renderTestEmail("http://x", "test") });
    expect(report.state).toBe("preview"); // reports may use the reserve
  });

  it("digest mode after 200 emails: one digest per hour", async () => {
    await fillLog(200);
    const ctx = await ctxFor(preview);
    await queue(1);
    await dispatchPendingAlerts(ctx);
    expect(await EmailLog.countDocuments({ category: "digest" })).toBe(1);
    await queue(2);
    await dispatchPendingAlerts(ctx);
    expect(await EmailLog.countDocuments({ category: "digest" })).toBe(1);
    expect(await AlertEvent.countDocuments({ "channels.email": "pending" })).toBe(1);
  });
});

describe("live mode errors are surfaced with hints", () => {
  it("Brevo 401 unrecognised IP → failed + whitelist hint (test email)", async () => {
    msw.use(
      http.post(BREVO_SEND_URL, () => HttpResponse.json({ code: "unauthorized", message: "We have detected you are using an unrecognised IP address 1.2.3.4" }, { status: 401 })),
    );
    const res = await sendTestEmail(await ctxFor(live), "Admin");
    expect(res.state).toBe("failed");
    expect(res.error).toMatchObject({ kind: "ip_not_authorized" });
    expect(res.error?.hint).toMatch(/Authorized IPs/);
    expect((await EmailLog.findOne().lean())!.status).toBe("failed");
  });

  it("Telegram: sends to every chat; partial failure still counts as sent", async () => {
    const chats: string[] = [];
    msw.use(
      http.post("https://api.telegram.org/bot1:TOKEN/sendMessage", async ({ request }) => {
        const body = (await request.json()) as { chat_id: string };
        chats.push(body.chat_id);
        return body.chat_id === "12345"
          ? HttpResponse.json({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, { status: 400 })
          : HttpResponse.json({ ok: true, result: { message_id: 1 } });
      }),
    );
    const res = await sendTestTelegram(await ctxFor(live), "Admin");
    expect(chats).toEqual(["-1001", "12345"]);
    expect(res.state).toBe("sent");
    expect(res.error?.message).toMatch(/1\/2 chats/);
  });
});

describe("worker watchdog (runs in the web process)", () => {
  it("alerts once when the heartbeat is 15+ min old, then 'back online' when it returns", async () => {
    await JobState.create({ key: jobKeys.heartbeat, kind: "global", lastRunAt: new Date(NOW.getTime() - 16 * 60_000) });
    const ctx = await ctxFor(preview);
    const started = new Date(NOW.getTime() - 60 * 60_000);

    expect((await runWorkerWatchdog(ctx, { processStartedAt: started })).state).toBe("offline_alerted");
    // Delivered immediately from here (not via the dead worker's dispatcher).
    expect(await Outbox.countDocuments({ channel: "email", subject: "🔴 SiteGuard monitoring is OFFLINE" })).toBe(1);
    expect(await Outbox.countDocuments({ channel: "telegram" })).toBe(1);
    expect(await Notification.countDocuments({ type: "worker_offline", severity: "CRITICAL" })).toBe(1);

    expect((await runWorkerWatchdog(ctx, { processStartedAt: started })).state).toBe("offline_already_alerted");
    expect(await Outbox.countDocuments({ channel: "email" })).toBe(1);

    await JobState.updateOne({ key: jobKeys.heartbeat }, { $set: { lastRunAt: NOW } });
    expect((await runWorkerWatchdog(ctx, { processStartedAt: started })).state).toBe("back_online");
    expect(await Notification.countDocuments({ type: "worker_online" })).toBe(1);
  });

  it("stays quiet when the worker is healthy", async () => {
    await JobState.create({ key: jobKeys.heartbeat, kind: "global", lastRunAt: new Date(NOW.getTime() - 60_000) });
    expect((await runWorkerWatchdog(await ctxFor(preview), { processStartedAt: NOW })).state).toBe("ok");
    expect(await Outbox.countDocuments()).toBe(0);
  });
});
