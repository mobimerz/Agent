import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate: bounce requests without a session cookie to /login.
 * The real session check happens server-side in the dashboard layout,
 * server actions and route handlers.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();

  const url = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except API routes, Next internals, static files, and public auth pages.
  matcher: ["/((?!api/|_next/|favicon.ico|icon|apple-icon|robots.txt|login|invite/).*)"],
};
