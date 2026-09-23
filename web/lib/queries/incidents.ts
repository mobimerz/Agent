import "server-only";
import { INCIDENT_STATUSES, SEVERITIES, type CheckType, type IncidentStatus, type Severity } from "@siteguard/core";
import { AlertEvent, Incident, mongoose, Site } from "@siteguard/db";
import { db } from "../db";

export interface IncidentFilters {
  status?: IncidentStatus | "active";
  severity?: Severity;
  site?: string;
}

export function parseIncidentFilters(sp: Record<string, string | string[] | undefined>): IncidentFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const status = one("status");
  const severity = one("severity");
  return {
    // Default view: everything still open (OPEN + ACKNOWLEDGED).
    status: status === "all" ? undefined : status && (INCIDENT_STATUSES as readonly string[]).includes(status) ? (status as IncidentStatus) : "active",
    severity: severity && (SEVERITIES as readonly string[]).includes(severity) ? (severity as Severity) : undefined,
    site: one("site") && mongoose.isValidObjectId(one("site")) ? one("site") : undefined,
  };
}

export interface IncidentRow {
  id: string;
  siteId: string;
  siteName: string;
  clientName: string;
  checkType: CheckType;
  severity: Severity;
  status: IncidentStatus;
  title: string;
  message: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSec: number | null;
  suppressed: string | null;
}

export async function listIncidents(f: IncidentFilters, limit = 200): Promise<IncidentRow[]> {
  await db();
  const q: Record<string, unknown> = {};
  if (f.status === "active") q.isOpen = true;
  else if (f.status) q.status = f.status;
  if (f.severity) q.severity = f.severity;
  if (f.site) q.siteId = new mongoose.Types.ObjectId(f.site);

  const incidents = await Incident.find(q).sort({ isOpen: -1, startedAt: -1 }).limit(limit).lean();
  const sites = await Site.find({ _id: { $in: [...new Set(incidents.map((i) => String(i.siteId)))] } }, { name: 1, clientName: 1 }).lean();
  const byId = new Map(sites.map((s) => [String(s._id), s]));
  return incidents.map((i) => ({
    id: String(i._id),
    siteId: String(i.siteId),
    siteName: byId.get(String(i.siteId))?.name ?? "(deleted site)",
    clientName: byId.get(String(i.siteId))?.clientName ?? "",
    checkType: i.checkType as CheckType,
    severity: i.severity,
    status: i.status,
    title: i.title,
    message: i.message ?? "",
    startedAt: i.startedAt.toISOString(),
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    durationSec: i.durationSec ?? (i.isOpen ? Math.round((Date.now() - i.startedAt.getTime()) / 1000) : null),
    suppressed: i.suppressed ?? null,
  }));
}

export async function getIncident(id: string) {
  if (!mongoose.isValidObjectId(id)) return null;
  await db();
  const inc = await Incident.findById(id).lean();
  if (!inc) return null;
  const [site, alerts] = await Promise.all([
    Site.findById(inc.siteId, { name: 1, url: 1, clientName: 1 }).lean(),
    AlertEvent.find({ incidentId: inc._id }).sort({ createdAt: 1 }).lean(),
  ]);
  // Open incidents: duration so far.
  const durationSec = inc.durationSec ?? Math.round((Date.now() - inc.startedAt.getTime()) / 1000);
  return { inc, site, alerts, durationSec };
}

export async function incidentSiteOptions() {
  await db();
  const ids = await Incident.distinct("siteId");
  const sites = await Site.find({ _id: { $in: ids } }, { name: 1 }).sort({ name: 1 }).lean();
  return sites.map((s) => ({ id: String(s._id), name: s.name }));
}
