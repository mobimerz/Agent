/** "YYYY-MM-DD" for the given instant in the given IANA timezone. */
export function dayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Parse "HH:MM" into [hours, minutes]; throws on invalid input. */
export function parseHm(value: string): [number, number] {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  return [Number(m[1]), Number(m[2])];
}
