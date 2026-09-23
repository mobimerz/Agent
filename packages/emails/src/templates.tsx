// Explicit import: works with both the classic (tsx/esbuild default) and automatic JSX runtimes.
import * as React from "react";
import { Section, Text } from "@react-email/components";
import { alertEmoji, formatAlertTime, formatDuration, type AlertData, type Severity } from "@siteguard/core";
import { COLORS, CtaButton, EmailLayout, ExternalLink, Fields, Heading, Paragraph } from "./layout";

export function accentFor(data: Pick<AlertData, "type" | "severity">): string {
  if (data.type === "resolved" || data.type === "stable" || data.type === "worker_online") return COLORS.resolved;
  return ({ CRITICAL: COLORS.critical, WARNING: COLORS.warning, INFO: COLORS.info } as Record<Severity, string>)[data.severity];
}

const HEADLINE: Record<AlertData["type"], string> = {
  opened: "New incident",
  escalated: "Incident escalated",
  resolved: "Resolved",
  reminder: "Still not resolved",
  unstable: "Site is unstable",
  stable: "Site is stable again",
  worker_offline: "Monitoring is offline",
  worker_online: "Monitoring is back online",
};

export function alertRows(data: AlertData, timeZone: string) {
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (data.siteName) rows.push({ label: "Site", value: <strong>{data.siteName}</strong> });
  if (data.clientName) rows.push({ label: "Client", value: data.clientName });
  if (data.siteUrl) rows.push({ label: "URL", value: <ExternalLink href={data.siteUrl} /> });
  if (data.checkLabel) rows.push({ label: "Check", value: data.checkLabel });
  rows.push({ label: data.type === "resolved" ? "Was" : "Reason", value: data.message });
  if (data.startedAt) rows.push({ label: "Started", value: formatAlertTime(data.startedAt, timeZone) });
  if (data.type === "resolved") {
    if (data.resolvedAt) rows.push({ label: "Recovered", value: formatAlertTime(data.resolvedAt, timeZone) });
    rows.push({ label: "Total downtime", value: <strong>{formatDuration(data.durationSec)}</strong> });
  } else if (data.startedAt) {
    rows.push({ label: "Last successful check", value: data.lastOkAt ? formatAlertTime(data.lastOkAt, timeZone) : "none recorded" });
    if (data.type === "reminder" && data.durationSec != null) rows.push({ label: "Open for", value: formatDuration(data.durationSec) });
  }
  for (const e of data.extra ?? []) rows.push({ label: e.label, value: e.value });
  return rows;
}

export function AlertEmail({ data, timeZone }: { data: AlertData; timeZone: string }) {
  const accent = accentFor(data);
  return (
    <EmailLayout preview={`${data.title}${data.siteName ? ` — ${data.siteName}` : ""}: ${data.message}`} accent={accent}>
      <Text style={{ margin: 0, fontSize: 12, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {alertEmoji(data.type, data.severity)} {HEADLINE[data.type]} · {data.type === "resolved" ? "OK" : data.severity}
      </Text>
      <Heading>{data.title}</Heading>
      <Fields rows={alertRows(data, timeZone)} />
      <CtaButton href={data.link} color={accent}>
        Open in SiteGuard
      </CtaButton>
    </EmailLayout>
  );
}

export function DigestEmail({ items, timeZone, reason }: { items: AlertData[]; timeZone: string; reason: "grouped" | "digest" }) {
  const critical = items.filter((i) => i.severity === "CRITICAL" && i.type !== "resolved").length;
  const resolved = items.filter((i) => i.type === "resolved").length;
  const accent = critical ? COLORS.critical : resolved === items.length ? COLORS.resolved : COLORS.warning;
  return (
    <EmailLayout
      preview={`${items.length} alerts: ${critical} critical, ${resolved} resolved`}
      accent={accent}
      footer={
        reason === "grouped"
          ? "Several alerts happened close together, so they were grouped into one email to save your daily email quota. Telegram and in-app alerts were sent individually."
          : "Today's email quota is nearly used, so alerts are batched into a digest. Telegram and in-app alerts are still instant."
      }
    >
      <Heading>{items.length} alerts{critical ? ` · ${critical} critical` : ""}</Heading>
      {items.map((d, i) => (
        <Section key={i} style={{ borderLeft: `4px solid ${accentFor(d)}`, padding: "4px 0 4px 12px", margin: "0 0 12px" }}>
          <Text style={{ margin: 0, fontSize: 14, fontWeight: 700, color: COLORS.text }}>
            {alertEmoji(d.type, d.severity)} {d.siteName ? `${d.siteName} — ` : ""}
            {d.type === "resolved" ? `Resolved: ${d.title}` : d.title}
          </Text>
          <Text style={{ margin: "2px 0 0", fontSize: 13, color: COLORS.muted, lineHeight: "20px" }}>
            {d.message}
            {d.type === "resolved" ? ` · down ${formatDuration(d.durationSec)}` : d.startedAt ? ` · since ${formatAlertTime(d.startedAt, timeZone)}` : ""}
            {d.clientName ? ` · ${d.clientName}` : ""}
            <br />
            <a href={d.link} style={{ color: COLORS.info }}>
              Open
            </a>
          </Text>
        </Section>
      ))}
    </EmailLayout>
  );
}

export function SimpleEmail({ title, lines, cta, accent = COLORS.info, footer }: { title: string; lines: string[]; cta?: { label: string; href: string }; accent?: string; footer?: string }) {
  return (
    <EmailLayout preview={lines[0] ?? title} accent={accent} footer={footer}>
      <Heading>{title}</Heading>
      {lines.map((l, i) => (
        <Paragraph key={i}>{l}</Paragraph>
      ))}
      {cta && (
        <CtaButton href={cta.href} color={accent}>
          {cta.label}
        </CtaButton>
      )}
    </EmailLayout>
  );
}
