import { subscribe, unreadCount, type NotificationPayload } from "@/lib/notification-hub";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events: pushes new in-app notifications the moment the worker
 * inserts them (MongoDB Change Stream). The client falls back to polling
 * /api/notifications/unread if the stream can't be kept open.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;
  const encoder = new TextEncoder();

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      send("unread", { count: await unreadCount(userId) });

      const unsubscribe = subscribe(async (n: NotificationPayload) => {
        send("notification", n);
        send("unread", { count: await unreadCount(userId) });
      });
      // Keep-alive comment so proxies (Caddy) and browsers don't drop idle streams.
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25_000);

      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
