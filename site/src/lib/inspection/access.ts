import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/admin/auth";

export async function inspectionAccess(req: NextRequest, write = false): Promise<NextResponse | null> {
  if (!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value))) return NextResponse.json({ error: "Sign in to the admin workspace" }, { status: 401 });
  if (write && req.headers.get("origin") !== new URL(req.url).origin) return NextResponse.json({ error: "Use the same-site admin workspace" }, { status: 403 });
  return null;
}
export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
