"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatDuration } from "@siteguard/core";
import { Incident, mongoose, Site } from "@siteguard/db";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

type Result = { ok: true } | { ok: false; error: string };

function revalidate(id: string) {
  revalidatePath("/incidents");
  revalidatePath(`/incidents/${id}`);
  revalidatePath("/");
}

export async function acknowledgeIncident(id: string): Promise<Result> {
  const session = await requireSession();
  if (!mongoose.isValidObjectId(id)) return { ok: false, error: "Incident not found" };
  await db();
  const res = await Incident.updateOne(
    { _id: id, status: "OPEN" },
    {
      $set: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedBy: session.user.name },
      $push: { timeline: { at: new Date(), type: "acknowledged", message: "Acknowledged — reminders stopped", by: session.user.name } },
    },
  );
  if (!res.modifiedCount) return { ok: false, error: "Incident is not open (already acknowledged or resolved)." };
  revalidate(id);
  return { ok: true };
}

const noteSchema = z.string().trim().min(1, "Note is empty").max(2000);

export async function addIncidentNote(id: string, text: string): Promise<Result> {
  const session = await requireSession();
  const parsed = noteSchema.safeParse(text);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  if (!mongoose.isValidObjectId(id)) return { ok: false, error: "Incident not found" };
  await db();
  const now = new Date();
  await Incident.updateOne(
    { _id: id },
    {
      $push: {
        notes: { userId: session.user.id, userName: session.user.name, text: parsed.data, createdAt: now },
        timeline: { at: now, type: "note", message: parsed.data, by: session.user.name },
      },
    },
  );
  revalidate(id);
  return { ok: true };
}

/** Manual close (e.g. a known false alarm). In-app only; the engine reopens it if the check still fails. */
export async function resolveIncidentManually(id: string): Promise<Result> {
  const session = await requireSession();
  if (!mongoose.isValidObjectId(id)) return { ok: false, error: "Incident not found" };
  await db();
  const inc = await Incident.findOne({ _id: id, isOpen: true }).lean();
  if (!inc) return { ok: false, error: "Incident is already resolved." };
  const now = new Date();
  const durationSec = Math.round((now.getTime() - inc.startedAt.getTime()) / 1000);
  await Incident.updateOne(
    { _id: id, isOpen: true },
    {
      $set: { status: "RESOLVED", isOpen: false, resolvedAt: now, durationSec, resolvedBy: session.user.name },
      $push: { timeline: { at: now, type: "resolved", message: `Resolved manually after ${formatDuration(durationSec)}`, by: session.user.name } },
    },
  );
  await Site.updateOne({ _id: inc.siteId }, { $set: { "current.openIncidents": await Incident.countDocuments({ siteId: inc.siteId, isOpen: true }) } });
  revalidate(id);
  return { ok: true };
}
