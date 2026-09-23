import { unreadCount } from "@/lib/notification-hub";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Polling fallback for the bell when SSE is unavailable. */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ count: await unreadCount(session.user.id) }, { headers: { "cache-control": "no-store" } });
}
