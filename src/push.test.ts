import assert from "node:assert/strict";
import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";
import { test } from "node:test";
import { b64url, encryptPayload, fromB64url, generateVapidKeys, isPushEndpoint, sendPush, vapidAuthorization } from "./push";

// RFC 8291 Appendix A.
const rfc = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** An independent decryptor (Node's crypto module, not WebCrypto), following RFC 8291 from the receiver's side. */
function decrypt(body: Uint8Array, uaPrivate: string, uaPublic: string, auth: string): string {
  const buf = Buffer.from(body);
  const salt = buf.subarray(0, 16);
  const idlen = buf[20];
  const senderPublic = buf.subarray(21, 21 + idlen);
  const ciphertext = buf.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(fromB64url(uaPrivate)));
  const secret = ecdh.computeSecret(senderPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), Buffer.from(fromB64url(uaPublic)), senderPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, Buffer.from(fromB64url(auth)), info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  return plain.subarray(0, plain.length - 1).toString();
}

test("payload encryption matches the RFC 8291 test vector", async () => {
  const body = await encryptPayload({ endpoint: "https://web.push.apple.com/x", p256dh: rfc.uaPublic, auth: rfc.auth }, rfc.plaintext, {
    salt: fromB64url(rfc.salt),
    senderPrivate: fromB64url(rfc.asPrivate),
    senderPublic: fromB64url(rfc.asPublic),
  });
  assert.equal(b64url(body), rfc.body);
  assert.equal(decrypt(body, rfc.uaPrivate, rfc.uaPublic, rfc.auth), rfc.plaintext);
});

test("payload encryption with a fresh key decrypts on the receiving side", async () => {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const sub = { endpoint: "https://web.push.apple.com/x", p256dh: b64url(ua.getPublicKey()), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
  const message = JSON.stringify({ title: "Brain training", body: "2 rounds left ✓", url: "/brain" });
  const body = await encryptPayload(sub, message);
  assert.equal(decrypt(body, b64url(ua.getPrivateKey()), sub.p256dh, sub.auth), message);
});

test("VAPID header is a JWT signed by the public key it names", async () => {
  const keys = await generateVapidKeys();
  const header = await vapidAuthorization("https://web.push.apple.com/abc/def", keys, "https://example.workers.dev", 1_000_000_000_000);
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(match);
  assert.equal(match[4], keys.publicKey);
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(match[2])));
  assert.deepEqual(claims, { aud: "https://web.push.apple.com", exp: 1_000_000_000 + 12 * 3600, sub: "https://example.workers.dev" });
  const key = await crypto.subtle.importKey("raw", fromB64url(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromB64url(match[3]), new TextEncoder().encode(`${match[1]}.${match[2]}`));
  assert.ok(ok);
});

test("only real push services are accepted as endpoints", () => {
  assert.ok(isPushEndpoint("https://web.push.apple.com/QGt3"));
  assert.ok(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
  assert.ok(!isPushEndpoint("http://web.push.apple.com/QGt3"));
  assert.ok(!isPushEndpoint("https://evil.example/web.push.apple.com"));
  assert.ok(!isPushEndpoint("https://web.push.apple.com.evil.example/"));
  assert.ok(!isPushEndpoint("not a url"));
});

test("sendPush posts an encrypted, VAPID-signed request the phone can read", async () => {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const sub = { endpoint: "https://web.push.apple.com/QGt3abc", p256dh: b64url(ua.getPublicKey()), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
  const keys = await generateVapidKeys();
  const realFetch = globalThis.fetch;
  let captured: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    captured = { url, init };
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  try {
    const message = { title: "Pull day 💪", body: "Last Pull: 3 days ago.", url: "/log?tab=pull", tag: "gym" };
    assert.equal(await sendPush(sub, message, keys, "https://gym.example"), 201);
    assert.ok(captured);
    const { url, init } = captured as { url: string; init: RequestInit };
    const headers = init.headers as Record<string, string>;
    assert.equal(url, sub.endpoint);
    assert.equal(init.method, "POST");
    assert.equal(headers["content-encoding"], "aes128gcm");
    assert.match(headers.authorization, new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`));
    assert.ok(Number(headers.ttl) > 0);
    assert.deepEqual(JSON.parse(decrypt(init.body as Uint8Array, b64url(ua.getPrivateKey()), sub.p256dh, sub.auth)), message);
    assert.equal(await sendPush({ ...sub, endpoint: "https://evil.example/x" }, message, keys, "https://gym.example"), 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});
