import { dayKey, type EmailCategory } from "@siteguard/core";
import type { RenderedEmail } from "@siteguard/emails";
import { EmailLog, Outbox } from "@siteguard/db";
import type { BrevoEmail } from "./brevo";
import { emailStatus, telegramStatus, type NotifyContext } from "./context";
import { DeliveryError } from "./errors";
import { getEmailQuota, quotaAllows } from "./quota";
import { buildTelegramPayload } from "./telegram";

export type SendState = "sent" | "preview" | "skipped" | "failed";
export interface SendOutcome {
  state: SendState;
  error?: ReturnType<DeliveryError["toJSON"]> | { message: string; hint?: string; kind?: string };
  /** Outbox id when previewed (link target for /dev/emails, /dev/telegram). */
  previewId?: string;
}

function toOutcomeError(err: unknown): NonNullable<SendOutcome["error"]> {
  if (err instanceof DeliveryError) return err.toJSON();
  return { message: (err as Error).message ?? String(err) };
}

/**
 * Send (or, in preview mode, render + store) one email to the alert list.
 * Applies the daily quota; never throws.
 */
export async function sendEmail(
  ctx: NotifyContext,
  args: { category: EmailCategory; rendered: RenderedEmail; items?: number; to?: string[]; bypassQuota?: boolean },
): Promise<SendOutcome> {
  const status = emailStatus(ctx.config, ctx.settings);
  const to = args.to ?? status.recipients;
  const day = dayKey(ctx.now(), ctx.config.timeZone);
  const base = { day, category: args.category, to, subject: args.rendered.subject, items: args.items ?? 1, sentAt: ctx.now() };

  if (!args.bypassQuota) {
    const quota = await getEmailQuota(ctx);
    if (!quotaAllows(quota, args.category)) {
      await EmailLog.create({ ...base, status: "skipped_quota", provider: "brevo" });
      return {
        state: "skipped",
        error: { kind: "quota", message: `Daily email limit reached (${quota.used}/${quota.dailyLimit}, ${quota.reservedForReports} reserved for reports)`, hint: "Alerts continue on Telegram and in-app." },
      };
    }
  }

  const payload: BrevoEmail = {
    sender: { name: ctx.config.fromName, email: ctx.config.fromEmail ?? "alerts@example.invalid" },
    to: to.map((email) => ({ email })),
    subject: args.rendered.subject,
    htmlContent: args.rendered.html,
    textContent: args.rendered.text,
    tags: ["siteguard", args.category],
  };

  if (status.mode === "preview" || !ctx.email) {
    const doc = await Outbox.create({
      channel: "email",
      category: args.category,
      to: to.length ? to : ["(no recipients configured)"],
      subject: args.rendered.subject,
      html: args.rendered.html,
      text: args.rendered.text,
      request: { url: "POST https://api.brevo.com/v3/smtp/email", body: { ...payload, htmlContent: `(${args.rendered.html.length} chars)` } },
    });
    await EmailLog.create({ ...base, status: "preview", provider: "preview" });
    ctx.log?.info({ category: args.category, subject: args.rendered.subject, to }, "[preview] email not sent (DRY_RUN)");
    return { state: "preview", previewId: String(doc._id) };
  }

  if (!to.length) {
    return { state: "skipped", error: { kind: "not_configured", message: "No alert email recipients configured", hint: "Set ALERT_TO_EMAILS in .env (or recipients in Settings)." } };
  }

  try {
    const { messageId } = await ctx.email.send(payload);
    await EmailLog.create({ ...base, status: "sent", provider: ctx.email.name, messageId });
    return { state: "sent" };
  } catch (err) {
    const e = toOutcomeError(err);
    await EmailLog.create({ ...base, status: "failed", provider: "brevo", error: e.message });
    ctx.log?.error({ err: e, category: args.category }, "email send failed");
    return { state: "failed", error: e };
  }
}

/** Send one Telegram message to every configured chat (or store it in preview mode). Never throws. */
export async function sendTelegram(ctx: NotifyContext, args: { text: string; category: EmailCategory; silent?: boolean }): Promise<SendOutcome> {
  const status = telegramStatus(ctx.config, ctx.settings);
  const chats = status.recipients;

  if (status.mode === "preview" || !ctx.telegram) {
    const doc = await Outbox.create({
      channel: "telegram",
      category: args.category,
      to: chats.length ? chats : ["(no chat id configured)"],
      text: args.text,
      request: { url: "POST https://api.telegram.org/bot<token>/sendMessage", body: buildTelegramPayload(chats[0] ?? "<chat_id>", args.text, args.silent) },
    });
    ctx.log?.info({ category: args.category, chats }, "[preview] telegram not sent (DRY_RUN)");
    return { state: "preview", previewId: String(doc._id) };
  }

  if (!chats.length) {
    return { state: "skipped", error: { kind: "not_configured", message: "No Telegram chat ID configured", hint: "Set TELEGRAM_CHAT_ID in .env (comma-separate several)." } };
  }

  const failures: NonNullable<SendOutcome["error"]>[] = [];
  for (const chat of chats) {
    try {
      await ctx.telegram.sendMessage(chat, args.text, args.silent);
    } catch (err) {
      const e = toOutcomeError(err);
      failures.push({ ...e, message: `chat ${chat}: ${e.message}` });
      ctx.log?.error({ err: e, chat }, "telegram send failed");
    }
  }
  if (failures.length === chats.length) return { state: "failed", error: failures[0] };
  if (failures.length) return { state: "sent", error: { ...failures[0]!, message: `Sent to ${chats.length - failures.length}/${chats.length} chats. ${failures[0]!.message}` } };
  return { state: "sent" };
}
