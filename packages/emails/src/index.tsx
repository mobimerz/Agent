// Explicit import: works with both the classic (tsx/esbuild default) and automatic JSX runtimes.
import * as React from "react";
import { render } from "@react-email/components";
import { alertEmoji, formatDuration, type AlertData } from "@siteguard/core";

import { COLORS } from "./layout";
import { AlertEmail, DigestEmail, SimpleEmail } from "./templates";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

async function renderBoth(subject: string, element: React.ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

export function alertSubject(d: AlertData): string {
  const e = alertEmoji(d.type, d.severity);
  const site = d.siteName ?? "";
  switch (d.type) {
    case "opened":
      return `${e} ${d.severity === "CRITICAL" ? "CRITICAL" : d.severity}: ${d.title} — ${site} (${d.message})`;
    case "escalated":
      return `${e} ESCALATED: ${d.title} — ${site} (${d.message})`;
    case "resolved":
      return `${e} RESOLVED: ${site} — ${d.title} (down ${formatDuration(d.durationSec)})`;
    case "reminder":
      return `⏰ Still open ${formatDuration(d.durationSec)}: ${d.title} — ${site}`;
    case "unstable":
      return `${e} Unstable: ${site} — alerts paused`;
    case "stable":
      return `${e} Stable again: ${site}`;
    case "worker_offline":
      return `${e} SiteGuard monitoring is OFFLINE`;
    case "worker_online":
      return `${e} SiteGuard monitoring is back online`;
  }
}

export function renderAlertEmail(data: AlertData, timeZone: string): Promise<RenderedEmail> {
  return renderBoth(alertSubject(data), <AlertEmail data={data} timeZone={timeZone} />);
}

export function renderDigestEmail(items: AlertData[], timeZone: string, reason: "grouped" | "digest"): Promise<RenderedEmail> {
  const critical = items.filter((i) => i.severity === "CRITICAL" && i.type !== "resolved").length;
  const subject = `${critical ? "🔴" : "🟠"} SiteGuard: ${items.length} alerts${critical ? ` (${critical} critical)` : ""}`;
  return renderBoth(subject, <DigestEmail items={items} timeZone={timeZone} reason={reason} />);
}

export function renderTestEmail(appUrl: string, sentBy: string): Promise<RenderedEmail> {
  return renderBoth(
    "✅ SiteGuard test email",
    <SimpleEmail
      title="Email alerts are working"
      accent={COLORS.resolved}
      lines={[`This is a test email from SiteGuard, requested by ${sentBy}.`, "If you can read this, Brevo delivery, your sender domain and the recipient list are set up correctly."]}
      cta={{ label: "Open SiteGuard", href: appUrl }}
    />,
  );
}

export function renderInviteEmail(opts: { inviteUrl: string; invitedBy: string; role: string; expiresInDays: number }): Promise<RenderedEmail> {
  return renderBoth(
    `${opts.invitedBy} invited you to SiteGuard`,
    <SimpleEmail
      title="You're invited to SiteGuard"
      lines={[
        `${opts.invitedBy} invited you to join SiteGuard, our client website monitoring dashboard, as ${opts.role === "admin" ? "an admin" : "a member"}.`,
        `The link works once and expires in ${opts.expiresInDays} days.`,
      ]}
      cta={{ label: "Accept invite", href: opts.inviteUrl }}
      footer="If you weren't expecting this, you can ignore this email."
    />,
  );
}
