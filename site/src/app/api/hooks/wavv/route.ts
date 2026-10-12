import { after, NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ingestWavvEvent, processWavvEvent } from "@/lib/acq/processor";
import { verifyWavvSignature, type WavvEvent } from "@/lib/acq/wavv";

export const runtime = "nodejs";
// CRM updates, transcript fetch, AI review and hot-lead reports run after the
// response inside this budget.
export const maxDuration = 300;

/**
 * WAVV webhook (call.started / call.incoming / call.ended / call.recorded).
 * Register https://www.housesoldnj.com/api/hooks/wavv in WAVV → Integrations
 * → Webhooks and put its whsec_ secret in WAVV_WEBHOOK_SECRET.
 * Responds fast (WAVV allows 10 s) after logging the event; a 5xx makes WAVV
 * retry, so the event is only acknowledged once it is safely stored.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.WAVV_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifyWavvSignature(raw, req.headers.get("x-wavv-signature"), secret)) {
    console.warn("WAVV WEBHOOK bad signature");
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let evt: WavvEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const db = await getDb();
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 503 });
  const state = await ingestWavvEvent(db, evt);
  if (state === "ingested") {
    after(async () => {
      try {
        await processWavvEvent(db, evt);
      } catch (err) {
        console.error(`ACQ PROCESS FAILURE event=${evt.event} call=${evt.data?.id} ${String(err)}`);
      }
    });
  }
  return NextResponse.json({ ok: true, state });
}
