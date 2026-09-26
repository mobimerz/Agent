"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PsiPoint } from "@/lib/queries/checks";

const TZ = "Asia/Kolkata";
const fmtDay = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: TZ });
const fmtFull = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });

/** Fixed identity: mobile is always series-1 (blue), desktop always series-2 (orange). */
const SERIES = [
  { key: "Mobile", color: "var(--series-1)" },
  { key: "Desktop", color: "var(--series-2)" },
] as const;

const tick = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" };

export function SeriesLegend() {
  return (
    <div className="text-muted-foreground flex items-center gap-4 text-xs" aria-label="Legend">
      {SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color }} />
          {s.key}
        </span>
      ))}
    </div>
  );
}

interface MiniChartProps {
  title: string;
  data: PsiPoint[];
  mobile: keyof PsiPoint;
  desktop: keyof PsiPoint;
  unit?: string;
  domain?: [number, number | "auto"];
  /** Dashed reference: alert threshold or Google's "good" limit. */
  reference?: { value: number; label: string };
  format?: (v: number) => string;
  height?: number;
}

/** Last point gets a direct label so identity never relies on colour alone. */
function endLabel(data: PsiPoint[], name: string, color: string, format: (v: number) => string) {
  const last = data.length - 1;
  return function EndLabel(props: { x?: number | string; y?: number | string; index?: number; value?: unknown }) {
    if (props.index !== last || props.value == null) return null;
    return (
      <text x={Number(props.x) + 6} y={Number(props.y)} dy={4} fontSize={11} fill="var(--foreground)">
        <tspan fill={color}>●</tspan> {name} {format(Number(props.value))}
      </text>
    );
  };
}

export function MiniLineChart({ title, data, mobile, desktop, unit = "", domain, reference, format = (v) => `${v}${unit}`, height = 180 }: MiniChartProps) {
  const hasData = data.some((d) => d[mobile] != null || d[desktop] != null);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      {!hasData ? (
        <div className="text-muted-foreground grid place-items-center rounded-md border border-dashed text-xs" style={{ height }}>
          No runs yet
        </div>
      ) : (
        <div className="w-full" style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 96, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(t: number) => fmtDay.format(t)} tick={tick} minTickGap={32} />
              <YAxis tick={tick} domain={domain ?? [0, "auto"]} width={44} tickFormatter={(v: number) => format(v)} />
              {reference && (
                <ReferenceLine y={reference.value} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: reference.label, position: "insideTopLeft", fontSize: 10, fill: "var(--muted-foreground)" }} />
              )}
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(t) => fmtFull.format(Number(t))}
                formatter={(value, name) => [value == null ? "—" : format(Number(value)), name]}
              />
              {[
                { k: mobile, s: SERIES[0] },
                { k: desktop, s: SERIES[1] },
              ].map(({ k, s }) => (
                <Line
                  key={s.key}
                  name={s.key}
                  type="monotone"
                  dataKey={k}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: s.color }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
                  connectNulls
                  isAnimationActive={false}
                  label={endLabel(data, s.key, s.color, format)}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}

export function ScoreHistoryCharts({ data, minPerformance, minSeo }: { data: PsiPoint[]; minPerformance: number; minSeo: number }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <MiniLineChart title="Performance score" data={data} mobile="perfMobile" desktop="perfDesktop" domain={[0, 100]} reference={{ value: minPerformance, label: `alert < ${minPerformance}` }} />
      <MiniLineChart title="SEO score (Lighthouse)" data={data} mobile="seoMobile" desktop="seoDesktop" domain={[0, 100]} reference={{ value: minSeo, label: `alert < ${minSeo}` }} />
    </div>
  );
}

/** Core Web Vitals (lab) as small multiples — different units never share an axis. */
export function CwvTrendCharts({ data }: { data: PsiPoint[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <MiniLineChart title="LCP (s)" data={data} mobile="lcpMobile" desktop="lcpDesktop" format={(v) => `${v.toFixed(1)} s`} reference={{ value: 2.5, label: "good ≤ 2.5 s" }} height={160} />
      <MiniLineChart title="CLS" data={data} mobile="clsMobile" desktop="clsDesktop" format={(v) => v.toFixed(2)} reference={{ value: 0.1, label: "good ≤ 0.1" }} height={160} />
      <MiniLineChart title="TBT (ms)" data={data} mobile="tbtMobile" desktop="tbtDesktop" format={(v) => `${Math.round(v)}`} reference={{ value: 200, label: "good ≤ 200" }} height={160} />
    </div>
  );
}
