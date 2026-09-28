/**
 * Admin sessions for the internal reports. One secret: ADMIN_PASSWORD (Vercel
 * env). Sessions are HMAC-signed cookies keyed from it, so changing the
 * password signs everyone out. Web Crypto only — runs in middleware (edge)
 * and route handlers alike.
 */

export const SESSION_COOKIE = "hsnj_admin";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

async function hmacKey(): Promise<CryptoKey | null> {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`hsnj-admin-session:${pw}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(payload: string): Promise<string | null> {
  const key = await hmacKey();
  if (!key) return null;
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(input: string): Promise<boolean> {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || !input) return false;
  // Compare digests so timing doesn't leak the password length.
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(pw)),
  ]);
  return safeEqual(b64url(a), b64url(b));
}

export async function createSession(): Promise<string | null> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = `${Date.now() + SESSION_DAYS * 86_400_000}.${nonce}`;
  const sig = await sign(payload);
  return sig ? `${payload}.${sig}` : null;
}

export async function verifySession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = await sign(`${exp}.${nonce}`);
  return Boolean(expected) && safeEqual(expected!, sig);
}

/** Only same-site admin paths are valid post-login destinations. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/admin(\/[\w\-./]*)?$/.test(next) ? next : "/admin";
}
