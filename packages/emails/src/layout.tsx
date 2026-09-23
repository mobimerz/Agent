// Explicit import: works with both the classic (tsx/esbuild default) and automatic JSX runtimes.
import * as React from "react";
import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

export const COLORS = {
  critical: "#dc2626",
  warning: "#d97706",
  info: "#2563eb",
  resolved: "#16a34a",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  bg: "#f1f5f9",
};

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function EmailLayout({ preview, accent, children, footer }: { preview: string; accent: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: COLORS.bg, fontFamily: font, margin: 0, padding: "16px 8px" }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", backgroundColor: "#ffffff", borderRadius: 10, overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
          <Section style={{ height: 6, backgroundColor: accent }} />
          <Section style={{ padding: "20px 24px 8px" }}>
            <Text style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.muted, letterSpacing: 0.3 }}>🛡️ SiteGuard</Text>
          </Section>
          <Section style={{ padding: "0 24px 20px" }}>{children}</Section>
          <Hr style={{ borderColor: COLORS.border, margin: 0 }} />
          <Section style={{ padding: "12px 24px 16px" }}>
            <Text style={{ margin: 0, fontSize: 12, color: COLORS.muted, lineHeight: "18px" }}>
              {footer ?? "You receive this because you are on the SiteGuard alert list."}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function Heading({ children, color }: { children: React.ReactNode; color?: string }) {
  return <Text style={{ margin: "4px 0 12px", fontSize: 20, lineHeight: "26px", fontWeight: 700, color: color ?? COLORS.text }}>{children}</Text>;
}

export function Paragraph({ children }: { children: React.ReactNode }) {
  return <Text style={{ margin: "0 0 12px", fontSize: 14, lineHeight: "22px", color: COLORS.text }}>{children}</Text>;
}

/** Label/value rows; stacks nicely on narrow screens (table-based for email clients). */
export function Fields({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse", margin: "4px 0 16px" }}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td style={{ padding: "6px 12px 6px 0", fontSize: 13, color: COLORS.muted, verticalAlign: "top", whiteSpace: "nowrap", width: 1 }}>{r.label}</td>
            <td style={{ padding: "6px 0", fontSize: 14, color: COLORS.text, verticalAlign: "top", wordBreak: "break-word" }}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CtaButton({ href, children, color }: { href: string; children: React.ReactNode; color: string }) {
  return (
    <Button href={href} style={{ backgroundColor: color, color: "#ffffff", fontSize: 14, fontWeight: 600, padding: "10px 18px", borderRadius: 8, textDecoration: "none" }}>
      {children}
    </Button>
  );
}

export function ExternalLink({ href }: { href: string }) {
  return (
    <Link href={href} style={{ color: COLORS.info, textDecoration: "underline" }}>
      {href}
    </Link>
  );
}
