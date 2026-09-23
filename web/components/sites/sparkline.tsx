import { cn } from "@/lib/utils";

/** Tiny inline SVG sparkline (cheap enough for every row; gaps where there is no data). */
export function Sparkline({ values, className, width = 96, height = 24 }: { values: (number | null)[]; className?: string; width?: number; height?: number }) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return <div className={cn("text-muted-foreground text-xs", className)} style={{ width }} aria-hidden>—</div>;

  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const y = (v: number) => height - 2 - ((v - min) / range) * (height - 4);

  const segments: string[] = [];
  let current = "";
  values.forEach((v, i) => {
    if (v == null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (current) segments.push(current);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("text-primary overflow-visible", className)} aria-label={`Response time, last 24 h: ${min}–${max} ms`}>
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      ))}
    </svg>
  );
}
