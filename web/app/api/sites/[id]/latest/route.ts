import { CHECK_TYPES, type CheckType } from "@siteguard/core";
import { mongoose } from "@siteguard/db";
import { db } from "@/lib/db";
import { getLatestResultAfter } from "@/lib/queries/sites";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Polled by "Run check now": returns the newest result at/after `after`, or 204 while pending. */
export async function GET(request: Request, ctx: RouteContext<"/api/sites/[id]/latest">) {
  if (!(await getSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const url = new URL(request.url);
  const type = url.searchParams.get("type") as CheckType | null;
  const after = new Date(url.searchParams.get("after") ?? "");
  if (!mongoose.isValidObjectId(id) || !type || !CHECK_TYPES.includes(type) || Number.isNaN(after.getTime())) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  await db();
  const result = await getLatestResultAfter(new mongoose.Types.ObjectId(id), type, after);
  if (!result) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
