import { renderInviteEmail, renderTestEmail } from "@siteguard/emails";
import type { NotifyContext } from "./context";
import { sendEmail, sendTelegram, type SendOutcome } from "./send";
import { escapeHtml } from "./telegram-format";

/** Settings → "Send test email". Bypasses nothing: counts toward the quota like any email. */
export async function sendTestEmail(ctx: NotifyContext, requestedBy: string): Promise<SendOutcome> {
  const rendered = await renderTestEmail(ctx.config.appUrl, requestedBy);
  return sendEmail(ctx, { category: "test", rendered });
}

export async function sendTestTelegram(ctx: NotifyContext, requestedBy: string): Promise<SendOutcome> {
  const text = [
    "✅ <b>SiteGuard test message</b>",
    `Requested by ${escapeHtml(requestedBy)}.`,
    "If you can read this, Telegram alerts are set up correctly.",
    `<a href="${escapeHtml(ctx.config.appUrl)}">Open SiteGuard</a>`,
  ].join("\n");
  return sendTelegram(ctx, { text, category: "test" });
}

export async function sendInviteEmail(ctx: NotifyContext, args: { to: string; inviteUrl: string; invitedBy: string; role: string; expiresInDays: number }): Promise<SendOutcome> {
  const rendered = await renderInviteEmail(args);
  return sendEmail(ctx, { category: "invite", rendered, to: [args.to] });
}
