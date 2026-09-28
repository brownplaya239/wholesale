import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSession, safeNext, SESSION_COOKIE, SESSION_DAYS } from "@/lib/admin/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  const next = safeNext(form?.get("next"));
  if (!(await checkPassword(password))) {
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 800));
    const back = new URL("/admin/login", req.url);
    back.searchParams.set("error", "1");
    back.searchParams.set("next", next);
    return NextResponse.redirect(back, 303);
  }
  const token = await createSession();
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, token!, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && !req.url.startsWith("http://localhost"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}
