// Explicit import: works with both the classic (tsx/esbuild default) and automatic JSX runtimes.
import * as React from "react";
import { Section, Text } from "@react-email/components";
import { formatAlertTime, formatDuration, REPORT_KIND_LABEL, upcomingExpiries, type DisplayStatus, type ReportSnapshot } from "@siteguard/core";
import { COLORS, CtaButton, EmailLayout, Heading } from "./layout";

/** Beyond this many sites the email lists only sites needing attention (the dashboard has the full table). */
const FULL_TABLE_MAX = 40;

const STATUS: Record<DisplayStatus, { emoji: string; label: string; color: string }> = {
  up: { emoji: "🟢", label: "Up", color: COLORS.resolved },
  degraded: { emoji: "🟠", label: "Degraded", color: COLORS.warning },
  blocked: { emoji: "🟠", label: "Blocked", color: COLORS.warning },
  checking: { emoji: "🔴", label: "Failing", color: COLORS.critical },
  down: { emoji: "🔴", label: "Down", color: COLORS.critical },
  unknown: { emoji: "⚪", label: "Unknown", color: COLORS.muted },
  paused: { emoji: "⏸️", label: "Paused", color: COLORS.muted },
};

export function reportAccent(r: ReportSnapshot): string {
  return r.summary.down ? COLORS.critical : r.summary.degraded || r.summary.blocked || r.summary.openIncidents ? COLORS.warning : COLORS.resolved;
}

export function reportSubject(r: ReportSnapshot, dateLabel: string): string {
  const e = r.summary.down ? "🔴" : r.summary.degraded || r.summary.blocked || r.summary.openIncidents ? "🟠" : "🟢";
  return `${e} ${REPORT_KIND_LABEL[r.kind]} ${dateLabel} — ${r.summary.headline}`;
}

const pct = (v: number | null) => (v == null ? "—" : v >= 99.995 ? "100%" : `${v.toFixed(2)}%`);

function Tile({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <td style={{ padding: "0 4px", width: "25%" }}>
      <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "8px 10px" }}>
        <div style={{ fontSize: 11, color: COLORS.muted }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      </div>
    </td>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={{ margin: "18px 0 6px", fontSize: 13, fontWeight: 700, color: COLORS.text, textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</Text>;
}

function Line({ children, color = COLORS.text }: { children: React.ReactNode; color?: string }) {
  return <Text style={{ margin: "0 0 4px", fontSize: 13, lineHeight: "19px", color }}>{children}</Text>;
}

export function ReportEmail({ report, timeZone, appUrl, reportUrl }: { report: ReportSnapshot; timeZone: string; appUrl: string; reportUrl: string }) {
  const s = report.summary;
  const attention = report.sites.filter((x) => x.status !== "up" && x.status !== "paused" && x.status !== "unknown");
  const expiries = upcomingExpiries(report.sites);
  const table = report.sites.length <= FULL_TABLE_MAX ? report.sites : attention;
  const siteLink = (id: string) => `${appUrl}/sites/${id}`;

  return (
    <EmailLayout
      preview={s.headline}
      accent={reportAccent(report)}
      footer={`Covers ${formatAlertTime(report.periodStart, timeZone)} → ${formatAlertTime(report.periodEnd, timeZone)}. Report times can be changed in Settings → Alerts, reports & thresholds.`}
    >
      <Text style={{ margin: 0, fontSize: 12, fontWeight: 700, color: COLORS.muted, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {report.kind === "morning" ? "☀️" : "🌙"} {REPORT_KIND_LABEL[report.kind]}
        {report.manual ? " (sent manually)" : ""}
      </Text>
      <Heading>{s.headline}</Heading>

      <table role="presentation" cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse", margin: "0 -4px 8px" }}>
        <tbody>
          <tr>
            <Tile label="Up" value={s.up} color={COLORS.resolved} />
            <Tile label="Down" value={s.down} color={s.down ? COLORS.critical : COLORS.text} />
            <Tile label="Degraded" value={s.degraded + s.blocked} color={s.degraded + s.blocked ? COLORS.warning : COLORS.text} />
            <Tile label="Open incidents" value={s.openIncidents} color={s.openIncidents ? COLORS.warning : COLORS.text} />
          </tr>
        </tbody>
      </table>
      <Line color={COLORS.muted}>
        Average uptime this period: <strong>{pct(s.avgUptime)}</strong>
        {s.paused ? ` · ${s.paused} paused` : ""}
      </Line>

      <SectionTitle>Since the last report</SectionTitle>
      {report.changes.length === 0 && report.incidents.opened.length === 0 && report.incidents.resolved.length === 0 ? (
        <Line color={COLORS.muted}>No changes.</Line>
      ) : (
        <>
          {report.changes.map((c, i) => (
            <Line key={`c${i}`}>
              {c.tone === "bad" ? "🔴" : c.tone === "good" ? "🟢" : "🔵"} <strong>{c.siteName}</strong> {c.text}
            </Line>
          ))}
          {report.incidents.resolved.map((i) => (
            <Line key={`r${i.id}`}>
              ✅ <strong>{i.siteName}</strong> resolved: {i.title} (down {formatDuration(i.durationSec)})
            </Line>
          ))}
          {report.incidents.opened
            .filter((i) => !i.resolvedAt)
            .map((i) => (
              <Line key={`o${i.id}`}>
                {i.severity === "CRITICAL" ? "🔴" : "🟠"} <strong>{i.siteName}</strong> new incident: {i.title} (since {formatAlertTime(i.startedAt, timeZone)})
              </Line>
            ))}
        </>
      )}

      {report.incidents.open.length > 0 && (
        <>
          <SectionTitle>Open incidents ({report.incidents.open.length})</SectionTitle>
          {report.incidents.open.map((i) => (
            <Line key={i.id}>
              {i.severity === "CRITICAL" ? "🔴" : i.severity === "WARNING" ? "🟠" : "🔵"} <strong>{i.siteName}</strong> — {i.title} · open {formatDuration((new Date(report.generatedAt).getTime() - new Date(i.startedAt).getTime()) / 1000)}
            </Line>
          ))}
        </>
      )}

      {expiries.length > 0 && (
        <>
          <SectionTitle>Renewals due within 30 days</SectionTitle>
          {expiries.map((e, i) => (
            <Line key={i} color={e.daysLeft <= 7 ? COLORS.critical : COLORS.text}>
              {e.daysLeft <= 7 ? "🔴" : "🟠"} <strong>{e.siteName}</strong> — {e.what} {e.daysLeft < 0 ? "EXPIRED" : `expires in ${e.daysLeft} day${e.daysLeft === 1 ? "" : "s"}`}
            </Line>
          ))}
        </>
      )}

      {table.length > 0 && (
        <>
          <SectionTitle>{table === report.sites ? `All sites (${report.sites.length})` : `Needs attention (${table.length} of ${report.sites.length} sites)`}</SectionTitle>
          <table role="presentation" cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {table.map((x) => {
                const st = STATUS[x.status];
                return (
                  <tr key={x.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: "6px 6px 6px 0", verticalAlign: "top" }}>
                      <a href={siteLink(x.id)} style={{ color: COLORS.text, fontWeight: 600, textDecoration: "none" }}>
                        {x.name}
                      </a>
                      {x.issues[0] && x.status !== "up" ? <div style={{ color: COLORS.muted, fontSize: 12 }}>{x.issues[0].message}</div> : null}
                    </td>
                    <td style={{ padding: "6px 6px", color: st.color, whiteSpace: "nowrap", verticalAlign: "top" }}>
                      {st.emoji} {st.label}
                    </td>
                    <td style={{ padding: "6px 0 6px 6px", textAlign: "right", whiteSpace: "nowrap", color: COLORS.muted, verticalAlign: "top" }}>
                      {pct(x.uptimePct)}
                      {x.avgResponseMs != null ? ` · ${x.avgResponseMs} ms` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <Section style={{ marginTop: 16 }}>
        <CtaButton href={reportUrl} color={reportAccent(report)}>
          Open full report
        </CtaButton>
      </Section>
    </EmailLayout>
  );
}
