import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPhoto } from "@/lib/leads/store";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const photo = db ? await getPhoto(db, id) : null;
  if (!photo) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=86400" },
  });
}
