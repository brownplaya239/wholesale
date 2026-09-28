import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/admin/auth";

/**
 * Gate for the internal reports: every /admin page and /api/admin endpoint
 * needs a valid signed session, except the login page and login endpoint.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open = pathname === "/admin/login" || pathname === "/api/admin/login";
  if (open || (await verifySession(req.cookies.get(SESSION_COOKIE)?.value))) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  }
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/admin/login", req.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
