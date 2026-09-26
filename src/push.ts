// Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291), using only WebCrypto,
// so it runs in the Worker and in Node tests. The VAPID key pair is made on first use and kept in the settings table.

const encoder = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const s = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concat(...parts: ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export type PushSubscription = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

/** A P-256 private key as a JWK, from its raw 32-byte scalar and 65-byte uncompressed public point. */
function privateJwk(d: Uint8Array, publicRaw: Uint8Array): JsonWebKey {
  return { kty: "EC", crv: "P-256", d: b64url(d), x: b64url(publicRaw.slice(1, 33)), y: b64url(publicRaw.slice(33, 65)), ext: true };
}

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const privateJwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { publicKey: b64url(publicRaw), privateJwk };
}

/** The VAPID keys from the settings table, creating them the first time. */
export async function loadVapidKeys(db: D1Database): Promise<VapidKeys> {
  const read = () => db.prepare("SELECT value FROM settings WHERE key = 'vapid_keys'").first<{ value: string }>();
  const row = await read();
  if (row) return JSON.parse(row.value) as VapidKeys;
  await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid_keys', ?)").bind(JSON.stringify(await generateVapidKeys())).run();
  return JSON.parse((await read())!.value) as VapidKeys; // re-read so two first requests agree on one pair
}

/** The Authorization header for a push service: a signed JWT for the endpoint's origin, valid for 12 hours. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): Promise<string> {
  const header = b64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

async function hkdf(salt: BufferSource, ikm: BufferSource, info: BufferSource, bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/**
 * Encrypts a payload for one subscription (RFC 8291, a single aes128gcm record).
 * `fixed` pins the salt and sender key, only so the RFC's test vector can be checked.
 */
export async function encryptPayload(
  sub: PushSubscription,
  payload: string,
  fixed?: { salt: Uint8Array<ArrayBuffer>; senderPrivate: Uint8Array; senderPublic: Uint8Array<ArrayBuffer> },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  let senderPrivateKey: CryptoKey;
  let senderPublic: Uint8Array<ArrayBuffer>;
  if (fixed) {
    senderPrivateKey = await crypto.subtle.importKey("jwk", privateJwk(fixed.senderPrivate, fixed.senderPublic), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    senderPublic = fixed.senderPublic;
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    senderPrivateKey = pair.privateKey;
    senderPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as Parameters<typeof crypto.subtle.deriveBits>[0], senderPrivateKey, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(encoder.encode("WebPush: info\0"), uaPublic, senderPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(encoder.encode(payload), new Uint8Array([2])); // 0x02: the last (and only) record
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const recordSize = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, recordSize, new Uint8Array([senderPublic.length]), senderPublic, ciphertext);
}

/** Push services this app sends to; anything else is refused so a stored endpoint can't point the Worker elsewhere. */
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    return (
      url.protocol === "https:" &&
      (host === "web.push.apple.com" ||
        host === "fcm.googleapis.com" ||
        host === "updates.push.services.mozilla.com" ||
        host.endsWith(".push.apple.com") ||
        host.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };

/** Sends one notification. Returns the push service's HTTP status (404 or 410 means the subscription is gone). */
export async function sendPush(sub: PushSubscription, message: PushMessage, keys: VapidKeys, subject: string): Promise<number> {
  if (!isPushEndpoint(sub.endpoint)) return 400;
  const body = await encryptPayload(sub, JSON.stringify(message));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(sub.endpoint, keys, subject),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(4 * 3600), // a reminder is stale after a few hours
      urgency: "normal",
    },
    body,
  });
  return res.status;
}
