// LION attestation verifier (Ed25519) — prove a LION response is untampered, OFFLINE.
//
// Library + CLI. Works in Node 20+ and (the same logic) in the browser.
//
//   node verify.mjs response.json      # verify a saved response
//   curl ... | node verify.mjs         # or pipe one in via stdin
//
//   import { lionVerifyAttestation } from "./verify.mjs";
//   const r = await lionVerifyAttestation(responseObject);  // r.ok === true if authentic
//
// What this proves: the bytes you received are EXACTLY what LION signed
// (integrity / authenticity) — not that any external fact is true. Judge truth
// from each field's `source`, `as_of`, and `confidence`.

import { webcrypto } from "node:crypto";
const subtle = (globalThis.crypto && globalThis.crypto.subtle) || webcrypto.subtle;

// LION's published Ed25519 signer (trust anchor). A valid signature from a
// DIFFERENT key is cryptographically fine but is NOT LION — we flag that.
export const LION_PUBLISHED_SIGNER = "H9jfKtGS3G8mGzA2fH7KSzyvEhk0j-j9gvmqMrjQt7w";

export async function lionVerifyAttestation(resp) {
  if (!resp || !resp.attestation || !resp.attestation.signature) {
    return { ok: false, reason: "no_attestation" };
  }
  const att = resp.attestation;
  const body = { ...resp };
  delete body.attestation;
  const canonical = stableStringify(body);
  const hash = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  let ok = false;
  try {
    const key = await subtle.importKey("raw", b64urlToBytes(att.signer), { name: "Ed25519" }, false, ["verify"]);
    ok = await subtle.verify("Ed25519", key, b64urlToBytes(att.signature), hash);
  } catch (e) {
    return { ok: false, reason: "verify_error: " + (e && e.message), signer: att.signer };
  }
  return {
    ok: !!ok,
    signer: att.signer,
    trusted_signer: att.signer === LION_PUBLISHED_SIGNER,
    payload_sha256: toHex(hash),
    sha256_matches_claim: !att.payload_sha256 || att.payload_sha256 === toHex(hash),
  };
}

// Canonical JSON: recursively sort object keys; arrays keep order. Must match
// the server's signer exactly (Ed25519(SHA-256(this string))).
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const k = Object.keys(v).sort();
  return "{" + k.map((x) => JSON.stringify(x) + ":" + stableStringify(v[x])).join(",") + "}";
}
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
function toHex(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

// ---- CLI ----
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const file = process.argv[2];
  const read = (stream) => new Promise((res, rej) => {
    let d = ""; stream.setEncoding("utf8");
    stream.on("data", (c) => (d += c)); stream.on("end", () => res(d)); stream.on("error", rej);
  });
  const fs = await import("node:fs/promises");
  const text = file ? await fs.readFile(file, "utf8") : await read(process.stdin);
  const resp = JSON.parse(text);
  const r = await lionVerifyAttestation(resp);
  console.log(JSON.stringify(r, null, 2));
  if (r.ok && r.trusted_signer) console.log("\n✅ AUTHENTIC — untampered and signed by LION's published key.");
  else if (r.ok) console.log("\n⚠️  Signature valid, but signer is NOT LION's published key. Not from LION.");
  else console.log("\n❌ NOT VERIFIED — tampered, malformed, or unsigned. Do not trust.");
  process.exit(r.ok && r.trusted_signer ? 0 : 1);
}
