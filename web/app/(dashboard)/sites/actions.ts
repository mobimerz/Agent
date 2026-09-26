"use server";

import { revalidatePath } from "next/cache";
import { ACTIVE_CHECK_TYPES, siteInputSchema, type CheckType, type SiteInput } from "@siteguard/core";
import { deleteSiteCascade, getSettings, Incident, JobState, jobKeys, mongoose, requestRunNow, Site, syncSiteJobs } from "@siteguard/db";
import { parseSitesCsv, type ImportPreview } from "@/lib/csv-import";
import { db } from "@/lib/db";
import { requireAdmin, requireSession } from "@/lib/session";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join(".");
    out[key] ??= i.message;
  }
  return out;
}

function isDuplicateKey(err: unknown) {
  return (err as { code?: number }).code === 11000;
}

function revalidateSites(id?: string) {
  revalidatePath("/");
  revalidatePath("/sites");
  if (id) revalidatePath(`/sites/${id}`);
}

export async function createSite(input: SiteInput): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  const parsed = siteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error.issues) };

  await db();
  try {
    const site = await Site.create({ ...parsed.data, createdBy: session.user.id });
    await syncSiteJobs(site.toObject());
    revalidateSites();
    return { ok: true, data: { id: String(site._id) } };
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: false, error: "A site with this URL already exists.", fieldErrors: { url: "Already monitored" } };
    throw err;
  }
}

export async function updateSite(id: string, input: SiteInput): Promise<ActionResult<{ id: string }>> {
  await requireSession();
  if (!mongoose.isValidObjectId(id)) return { ok: false, error: "Site not found" };
  const parsed = siteInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error.issues) };

  // Pause/resume has its own action; editing must never flip it.
  const changes: Partial<typeof parsed.data> = { ...parsed.data };
  delete changes.status;

  await db();
  try {
    const site = await Site.findByIdAndUpdate(id, { $set: changes }, { returnDocument: "after", runValidators: true }).lean();
    if (!site) return { ok: false, error: "Site not found" };
    await syncSiteJobs(site);
    revalidateSites(id);
    return { ok: true, data: { id } };
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: false, error: "Another site already uses this URL.", fieldErrors: { url: "Already monitored" } };
    throw err;
  }
}

export async function setSitePaused(id: string, paused: boolean): Promise<ActionResult> {
  await requireSession();
  if (!mongoose.isValidObjectId(id)) return { ok: false, error: "Site not found" };
  await db();
  const site = await Site.findByIdAndUpdate(id, { $set: { status: paused ? "paused" : "active" } }, { returnDocument: "after" }).lean();
  if (!site) return { ok: false, error: "Site not found" };
  await syncSiteJobs(site);
  revalidateSites(id);
  return { ok: true, data: undefined };
}

export async function deleteSite(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!mongoose.isValidObjectId(id)) return { ok: false, error: "Site not found" };
  await db();
  await deleteSiteCascade(new mongoose.Types.ObjectId(id));
  revalidateSites();
  return { ok: true, data: undefined };
}

/** Queue an immediate run. The client then polls /api/sites/[id]/latest for the result. */
export async function runCheckNow(id: string, type: CheckType): Promise<ActionResult<{ requestedAt: string }>> {
  await requireSession();
  if (!mongoose.isValidObjectId(id)) return { ok: false, error: "Site not found" };
  if (!ACTIVE_CHECK_TYPES.includes(type)) return { ok: false, error: "This check is not available yet." };
  await db();
  const site = await Site.findById(id, { status: 1, checks: 1 }).lean();
  if (!site) return { ok: false, error: "Site not found" };
  if (site.status === "paused") return { ok: false, error: "Site is paused. Resume it first." };
  await syncSiteJobs(site); // make sure the job row exists (e.g. check just enabled)
  const requestedAt = await requestRunNow(site._id, type);
  if (!requestedAt) return { ok: false, error: "This check is disabled for the site." };
  return { ok: true, data: { requestedAt: requestedAt.toISOString() } };
}

/**
 * "Accept this change": the DNS records seen on the last run become the new
 * baseline, the open DNS incident (if any) is resolved by the user, and the
 * check re-runs right away to confirm.
 */
export async function acceptDnsChange(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!mongoose.isValidObjectId(id)) return { ok: false, error: "Site not found" };
  await db();
  const siteId = new mongoose.Types.ObjectId(id);
  const key = jobKeys.check(id, "dns");
  const job = await JobState.findOne({ key }, { data: 1 }).lean();
  const data = (job?.data ?? {}) as { observed?: unknown; observedAt?: string };
  if (!data.observed) return { ok: false, error: "No DNS records observed yet — run the DNS check first." };

  const now = new Date();
  await JobState.updateOne({ key }, { $set: { "data.baseline": data.observed, "data.baselineAt": now.toISOString(), "data.pending": [], "data.acceptedBy": session.user.name } });

  const open = await Incident.findOne({ siteId, checkType: "dns", isOpen: true }).lean();
  if (open) {
    const durationSec = Math.round((now.getTime() - open.startedAt.getTime()) / 1000);
    await Incident.updateOne(
      { _id: open._id, isOpen: true },
      {
        $set: { status: "RESOLVED", isOpen: false, resolvedAt: now, durationSec, resolvedBy: session.user.name },
        $push: { timeline: { at: now, type: "resolved", message: "DNS change accepted as the new baseline", by: session.user.name } },
      },
    );
    await Site.updateOne({ _id: siteId }, { $set: { "current.openIncidents": await Incident.countDocuments({ siteId, isOpen: true }) } });
  }
  await requestRunNow(siteId, "dns");
  revalidateSites(id);
  revalidatePath("/incidents");
  return { ok: true, data: undefined };
}

// ─── CSV import ──────────────────────────────────────────────────────

async function existingUrlMap() {
  const sites = await Site.find({}, { url: 1, name: 1 }).lean();
  return new Map(sites.map((s) => [s.url, s.name]));
}

export async function previewImport(csv: string): Promise<ActionResult<ImportPreview>> {
  await requireAdmin();
  await db();
  return { ok: true, data: parseSitesCsv(csv, await existingUrlMap()) };
}

/** Re-parses on the server (never trusts the client preview) and inserts only valid rows. */
export async function commitImport(csv: string): Promise<ActionResult<{ created: number; skipped: number }>> {
  // Members may add sites one by one; bulk import is an admin action.
  const session = await requireAdmin();
  await db();
  const preview = parseSitesCsv(csv, await existingUrlMap());
  if (preview.fatal) return { ok: false, error: preview.fatal };

  const settings = await getSettings();
  let created = 0;
  for (const { data } of preview.valid) {
    try {
      const site = await Site.create({ ...data, createdBy: session.user.id });
      await syncSiteJobs(site.toObject(), settings);
      created++;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err; // raced with another insert: treat as duplicate
    }
  }
  revalidateSites();
  return { ok: true, data: { created, skipped: preview.totalRows - created } };
}
