const TZ = process.env.TIMEZONE || process.env.NEXT_PUBLIC_TIMEZONE || "Asia/Kolkata";

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: TZ });
const timeOnly = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayMonth = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: TZ });

export const formatDateTime = (d: Date | string | number | null | undefined) => (d ? dateTime.format(new Date(d)) : "—");
export const formatTime = (d: Date | string | number) => timeOnly.format(new Date(d));
export const formatDay = (d: Date | string | number) => dayMonth.format(new Date(d));

/** "12:15 pm" for today, "22 Sept, 12:15 pm" otherwise. */
export function formatShort(d: Date | string | number): string {
  const date = new Date(d);
  const today = dayMonth.format(new Date()) === dayMonth.format(date);
  return today ? timeOnly.format(date) : `${dayMonth.format(date)}, ${timeOnly.format(date)}`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

export function formatPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "0%";
  return `${v >= 99.995 && v < 100 ? "99.99" : v.toFixed(v === 100 ? 0 : digits)}%`;
}

export function timeAgo(d: Date | string | number | null | undefined, now = Date.now()): string {
  if (!d) return "never";
  const sec = Math.round((now - new Date(d).getTime()) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function formatInterval(sec: number): string {
  if (sec % 86400 === 0) return `${sec / 86400} d`;
  if (sec % 3600 === 0) return `${sec / 3600} h`;
  return `${Math.round(sec / 60)} min`;
}
