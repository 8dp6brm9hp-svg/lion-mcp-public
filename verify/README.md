# @lionx402/receipt-verifier

Verify LION x402 data **offline** — prove a response or a compliance receipt is authentic and untampered **without trusting LION at verify time**.

Every paid LION response is Ed25519-attested. The `$0.05` Counterparty Compliance Bundle can return a portable `LION_SIGNED_COMPLIANCE_RECEIPT_V1` — a content-addressed, self-contained audit record your agent stores and re-verifies forever, with no further LION call.

- Zero dependencies. Node 20+ (global WebCrypto with Ed25519) and modern browsers.
- Self-contained: no network needed to verify.
- Mirrors the canonical helper LION serves at `…/api/x402/<route>?verify_helper=1`; `test.mjs` asserts functional equivalence so this copy can't silently drift.

## Verify scheme
`Ed25519( SHA-256( canonical sorted-key JSON of the body WITHOUT its attestation field ) )`. The signer's public key ships in every `attestation` block.

## Use it

```js
import { lionVerifyAttestation, lionVerifyReceipt } from "@lionx402/receipt-verifier";

// Any attested LION response:
const res = await fetch("https://lionx402.com/api/x402/compliance-bundle-json?domain=stripe.com&wallet=0xYOURWALLET").then(r => r.json());
const v = await lionVerifyAttestation(res);
// { ok: true, signer: "...", payload_sha256: "..." }

// A stored portable compliance receipt (?receipt=1):
const check = await lionVerifyReceipt(storedReceipt);
// { ok: true, signer, receipt_id, verdict, subject, source_verified: true }
if (!check.ok) throw new Error("receipt failed verification: " + check.reason);
```

`lionVerifyReceipt` verifies the receipt's own signature **and** independently re-verifies the embedded `source_response`. Both must pass.

## CLI

```bash
node lion-verify.mjs path/to/receipt.json
# prints the verdict JSON; exit 0 if ok, 1 if not
```

## What "ok: true" proves
- The bytes were signed by the published LION signer.
- Nothing in the body changed since issuance (any edit flips `ok` to `false`).

It does **not** assert the underlying facts are correct — it asserts LION issued exactly these bytes. Pair it with the on-chain `payment_proof` to tie the data to a settled payment.

## Test
```bash
npm test   # or: node test.mjs
```
Runs against real attested fixtures, a tamper case, and (when online) a drift check against the live served helper.

MIT. Not financial, legal, or compliance advice.
