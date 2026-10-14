import { createHash } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ingestWavvEvent, processWavvEvent } from "@/lib/acq/processor";
import { matchWavvSignature, type WavvEvent } from "@/lib/acq/wavv";

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
  // Pasted env values often carry a stray space or newline; a whsec_ secret never does.
  const secret = process.env.WAVV_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  const header = req.headers.get("x-wavv-signature");
  const scheme = matchWavvSignature(raw, header, secret);
  if (!scheme) {
    // Non-reversible diagnostics only: secret shape + fingerprint, header shape, clock skew.
    const t = header?.match(/t=(\d+)/)?.[1];
    console.warn(
      `WAVV WEBHOOK bad signature secret_len=${secret.length} secret_prefix_ok=${secret.startsWith("whsec_")} ` +
        `secret_fp=${createHash("sha256").update(secret).digest("hex").slice(0, 8)} ` +
        `header=${header ? header.replace(/v1=([0-9a-fA-F]+)/g, (_m, h: string) => `v1=<${h.length} hex>`) : "missing"} ` +
        `skew_s=${t ? Math.floor(Date.now() / 1000) - Number(t) : "n/a"} body_len=${raw.length} ` +
        `sig_headers=${[...req.headers.keys()].filter((k) => /sig|wavv|hmac/i.test(k)).join("|") || "none"}`,
    );
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (scheme.key !== "raw" || scheme.msg !== "t.body" || scheme.enc !== "hex") {
    console.info(`WAVV WEBHOOK signature matched non-default scheme key=${scheme.key} msg=${scheme.msg} enc=${scheme.enc}`);
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
