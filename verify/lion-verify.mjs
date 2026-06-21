// LION x402 — offline Ed25519 verifier for attested responses & signed compliance receipts.
//
// Self-contained: works in Node 20+ (global WebCrypto with Ed25519) and modern browsers.
// Zero dependencies. No network call required to verify — that is the whole point:
// a LION response or LION_SIGNED_COMPLIANCE_RECEIPT_V1 proves its own integrity offline,
// without trusting LION at verify time.
//
// The core `lionVerifyAttestation` mirrors, byte-for-byte in behavior, the canonical helper
// LION serves at  https://lionx402.com/api/x402/<route>?verify_helper=1 .
// `test.mjs` asserts functional equivalence against that live helper so this copy cannot drift.
//
// Scheme: Ed25519( SHA-256( canonical sorted-key JSON of the body WITHOUT its `attestation` field ) ).

/**
 * Verify any attested LION response object.
 * @param {object} resp - a parsed LION JSON response (must contain an `attestation` block).
 * @returns {Promise<{ok:boolean, signer?:string, payload_sha256?:string, reason?:string}>}
 */
export async function lionVerifyAttestation(resp) {
  if (!resp || !resp.attestation || !resp.attestation.signature) return { ok: false, reason: "no_attestation" };
  const att = resp.attestation;
  const body = Object.assign({}, resp); delete body.attestation;
  const canonical = stableStringify(body);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
  const key = await crypto.subtle.importKey("raw", b64urlToBytes(att.signer), { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("Ed25519", key, b64urlToBytes(att.signature), hash);
  return { ok: !!ok, signer: att.signer, payload_sha256: toHex(hash) };
}

/**
 * Verify a portable LION_SIGNED_COMPLIANCE_RECEIPT_V1.
 * Checks the receipt's own attestation AND (if embedded) independently re-verifies the
 * source_response. Both must pass. Use this to validate a stored compliance audit record.
 * @param {object} receipt
 * @returns {Promise<{ok:boolean, signer?:string, receipt_id?:string|null, verdict?:string|null, subject?:any, source_verified?:boolean, reason?:string, detail?:object}>}
 */
export async function lionVerifyReceipt(receipt) {
  const top = await lionVerifyAttestation(receipt);
  if (!top.ok) return { ok: false, reason: "receipt_attestation_invalid", detail: top };
  let sourceVerified = false;
  if (receipt && receipt.source_response && receipt.source_response.attestation) {
    const src = await lionVerifyAttestation(receipt.source_response);
    if (!src.ok) return { ok: false, reason: "source_response_attestation_invalid", detail: src };
    sourceVerified = true;
  }
  return {
    ok: true,
    signer: top.signer,
    receipt_id: receipt.receipt_id || null,
    verdict: receipt.verdict || null,
    subject: receipt.subject || null,
    source_verified: sourceVerified
  };
}

function stableStringify(v) { if (v === null || typeof v !== "object") return JSON.stringify(v); if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]"; const k = Object.keys(v).sort(); return "{" + k.map(function (x) { return JSON.stringify(x) + ":" + stableStringify(v[x]); }).join(",") + "}"; }
function b64urlToBytes(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
function toHex(b) { let s = ""; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0"); return s; }

// --- tiny CLI:  node lion-verify.mjs <lion-response-or-receipt.json> ---
if (typeof process !== "undefined" && process.argv && import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import("node:fs");
  const path = process.argv[2];
  if (!path) { console.error("usage: node lion-verify.mjs <lion-response-or-receipt.json>"); process.exit(2); }
  const obj = JSON.parse(readFileSync(path, "utf8"));
  const r = obj && obj.type === "LION_SIGNED_COMPLIANCE_RECEIPT_V1" ? await lionVerifyReceipt(obj) : await lionVerifyAttestation(obj);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
