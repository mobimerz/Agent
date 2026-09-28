import "server-only";
import type { ReportSnapshot } from "@siteguard/core";
import { mongoose, Report } from "@siteguard/db";
import { db } from "../db";

export interface ReportListRow {
  id: string;
  kind: ReportSnapshot["kind"];
  date: string;
  generatedAt: string;
  manual: boolean;
  headline: string;
  down: number;
  degraded: number;
  openIncidents: number;
  changes: number;
  delivery: { email: string | null; telegram: string | null };
}

export async function listReports(limit = 60): Promise<ReportListRow[]> {
  await db();
  const rows = await Report.find({}, { sites: 0, incidents: 0 }).sort({ generatedAt: -1 }).limit(limit).lean();
  return rows.map((r) => ({
    id: String(r._id),
    kind: r.kind,
    date: r.date,
    generatedAt: r.generatedAt!.toISOString(),
    manual: r.manual ?? false,
    headline: r.summary?.headline ?? "",
    down: r.summary?.down ?? 0,
    degraded: (r.summary?.degraded ?? 0) + (r.summary?.blocked ?? 0),
    openIncidents: r.summary?.openIncidents ?? 0,
    changes: (r.changes as unknown[] | undefined)?.length ?? 0,
    delivery: { email: r.delivery?.email ?? null, telegram: r.delivery?.telegram ?? null },
  }));
}

export async function getReport(id: string): Promise<(ReportSnapshot & { id: string; delivery: ReportListRow["delivery"] }) | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  await db();
  const r = await Report.findById(id).lean();
  if (!r) return null;
  const plain = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
  return {
    id,
    kind: r.kind,
    date: r.date,
    generatedAt: r.generatedAt!.toISOString(),
    periodStart: (r.periodStart ?? r.generatedAt!).toISOString(),
    periodEnd: (r.periodEnd ?? r.generatedAt!).toISOString(),
    manual: r.manual ?? false,
    summary: plain.summary as ReportSnapshot["summary"],
    changes: (plain.changes as ReportSnapshot["changes"]) ?? [],
    incidents: (plain.incidents as ReportSnapshot["incidents"]) ?? { opened: [], resolved: [], open: [] },
    sites: (plain.sites as ReportSnapshot["sites"]) ?? [],
    delivery: { email: r.delivery?.email ?? null, telegram: r.delivery?.telegram ?? null },
  };
}
