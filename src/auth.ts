// Sign-in: a cookie signed with DASHBOARD_PASSWORD, so changing the password signs everyone out.

const encoder = new TextEncoder();
export const SESSION_COOKIE = "gym_session";
export const SESSION_DAYS = 30;

/** Compares two strings in time that does not depend on where they differ. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  // Hash first so both inputs have the same length, then compare every byte.
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))));
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cookie value: "<expiry ms>.<signature>". */
export async function createSession(secret: string, now = Date.now()): Promise<string> {
  const expires = String(now + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${expires}.${await sign(expires, secret)}`;
}

export async function isValidSession(cookie: string | undefined, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!cookie || !secret) return false;
  const [expires, signature] = cookie.split(".");
  if (!expires || !signature || !(Number(expires) > now)) return false;
  return safeEqual(signature, await sign(expires, secret));
}

/** True once a valid session is past half its life, so regular use keeps you signed in. */
export function sessionNeedsRefresh(cookie: string, now = Date.now()): boolean {
  const expires = Number(cookie.split(".")[0]);
  return expires - now < (SESSION_DAYS / 2) * 24 * 60 * 60 * 1000;
}

/** Only same-site paths are allowed after sign-in, so the login form cannot redirect elsewhere. */
export function safeNextPath(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

/** Hex SHA-256, used to store the steps sync key without keeping the key itself. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new random key made of letters and digits only, so it survives copy and paste. */
export function newSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The token part of an Authorization header ("Bearer <token>"), ignoring case and stray spaces, or null. */
export function bearerToken(header: string | undefined): string | null {
  const match = /^\s*bearer\s+(.+?)\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}
