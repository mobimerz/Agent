"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartPoint } from "@/lib/queries/sites";
import { cn } from "@/lib/utils";

const TZ = "Asia/Kolkata";
const fmtTime = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fmtDay = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: TZ });
const fmtFull = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });

export function ResponseChart({ day, week, slowMs }: { day: ChartPoint[]; week: ChartPoint[]; slowMs: number }) {
  const [range, setRange] = useState<"24h" | "7d">("24h");
  const data = range === "24h" ? day : week;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Response time</h3>
        <div className="bg-muted inline-flex rounded-md p-0.5 text-xs">
          {(["24h", "7d"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn("rounded px-2.5 py-1 font-medium", range === r ? "bg-background shadow-sm" : "text-muted-foreground")}
              aria-pressed={range === r}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {data.length < 2 ? (
        <div className="text-muted-foreground grid h-56 place-items-center rounded-md border border-dashed text-sm">Not enough data yet — checks run every few minutes.</div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(t: number) => (range === "24h" ? fmtTime.format(t) : fmtDay.format(t))}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                minTickGap={40}
              />
              <YAxis yAxisId="ms" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => `${v}`} width={48} />
              <YAxis yAxisId="fail" hide domain={[0, "dataMax"]} />
              <Tooltip
                contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }}
                labelFormatter={(t) => fmtFull.format(Number(t))}
                formatter={(value, name) => (name === "fail" ? [`${value}`, "Failed checks"] : [`${value} ms`, "Response"])}
              />
              <Bar yAxisId="fail" dataKey="fail" fill="var(--destructive)" opacity={0.35} barSize={4} />
              <Line yAxisId="ms" type="monotone" dataKey="ms" stroke="var(--primary)" strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-muted-foreground mt-2 text-xs">Slow threshold: {slowMs} ms. Red bars mark failed checks.</p>
    </div>
  );
}
