---
name: lion-screen-before-pay
description: Before your agent sends USDC to an x402 payTo, screen the counterparty via LION's keyless compliance gate (OFAC SDN + domain trust + multi-chain token risk + firmographics). CLEAR proceeds; a sanctions/risk hit ABORTS the payment (fail-closed). Returns a portable, offline-verifiable signed compliance receipt.
---

# lion-screen-before-pay

x402 verifies the **payment**, never **who you are paying**. An agent will happily send USDC to a `payTo` that belongs to a sanctioned, fraudulent, or honeypot counterparty. **Screen first, pay second.**

## When to use
Whenever the agent is about to pay an x402 resource — or onboard/transact with any wallet, domain, or company. Screen the `payTo` before signing the payment.

## The gate (one keyless call, ~$0.05 USDC on Base)
```
GET https://lionx402.com/api/x402/compliance-bundle-json?address=<PAYTO>&receipt=1
```
- `address` = the wallet you're about to pay. Also accepts `&domain=` `&token=` `&name=` (any combination).
- `&receipt=1` returns the portable `LION_SIGNED_COMPLIANCE_RECEIPT_V1`.
- Response: `{ "verdict": "CLEAR" | "REVIEW", "flags": [...], "checks_run": [...], "receipt": {...}, "attestation": {...} }`.

## Workflow
1. Hit the target resource; on `402`, read `accepts[0].payTo` — that's the counterparty.
2. **Screen it** — pay LION's gate for that `payTo` (it is itself an x402 call; pay it with the `cdp-x402` buyer flow below).
3. **Decide:** `verdict == "CLEAR"` → proceed to pay the target. Otherwise → **ABORT** the payment and surface `flags`.
4. **Keep the receipt** — store `receipt` as proof you screened; it verifies offline (no callback) against LION's published key.

## Screening the gate (reuses the `cdp-x402` buyer flow)
```bash
PAYTO=0x...                      # the counterparty you're about to pay
LION="https://lionx402.com/api/x402/compliance-bundle-json?address=$PAYTO&receipt=1"

REQ=$(curl -s "$LION" | jq -c '.accepts[0]')                 # LION 402 challenge
addr=$(cdp evm accounts by-name name=$ACCOUNT | jq -r .address)
payload=$(cdp util x402 build --from $addr --payment-requirements "$REQ")
D=$(echo "$payload" | jq -c .domain); T=$(echo "$payload" | jq -c .types)
P=$(echo "$payload" | jq -r .primaryType); M=$(echo "$payload" | jq -c .message)
sig=$(cdp evm accounts sign typed-data $addr \
  "domain:=$D" "types:=$T" "primaryType=$P" "message:=$M" | jq -r .signature)
header=$(cdp util x402 encode --payment-requirements "$REQ" \
  --signature "$sig" --authorization "$M" --x402-version 2)

RESULT=$(curl -s -H "X-PAYMENT: $header" -H "PAYMENT-SIGNATURE: $header" "$LION")
verdict=$(echo "$RESULT" | jq -r '.verdict // .receipt.verdict')
if [ "$verdict" != "CLEAR" ]; then
  echo "BLOCKED ($verdict): $(echo "$RESULT" | jq -c '.flags')"; exit 1   # fail-closed: do NOT pay
fi
echo "$RESULT" | jq -c '.receipt' > last_compliance_receipt.json          # keep the proof
# verdict CLEAR -> now pay the original target resource.
```

## Second call — did the verdict flip? ($0.01)

The $0.001 screen and the $0.05 gate are one-shot. The next time this agent pays the same counterparty, recheck instead of buying another dossier. The receipt includes the Treasury OFAC snapshot date (`ofac.snapshot_as_of`) and the address count (`ofac.addresses_in_snapshot`). Entity names are a curated index, not the full SDN name file. The response also says whether the verdict changed since the last signed recheck.

```
GET https://lionx402.com/api/x402/counterparty-recheck-json?address=<PAYTO>
GET https://lionx402.com/api/x402/counterparty-recheck-json?address=<PAYTO>&domain=<DOMAIN>
```

- `action`: `GO` | `HOLD` | `STOP`. STOP when the verdict is BLOCK. HOLD when the verdict is WARN or `changed` is true. GO only when PASS and `changed` is not true.
- `ofac.snapshot_as_of` and `ofac.addresses_in_snapshot`: the Treasury publication date of the digital-currency address list, and how many addresses are in it. Read these from the receipt. Do not take a count from this skill.
- `verdict`: `PASS` | `WARN` | `BLOCK` (same branch as the wallet screen).
- `changed`: `false` on the first stored check, `true` when the verdict or hit flags flipped.
- `prior_receipt_id`: the previous receipt, or null.
- `receipt_id` + `attestation`: the new Ed25519 receipt. Keep it. The next recheck compares against it.

Abort on STOP or HOLD. Proceed only on GO. Do not cache a CLEAR forever without this call.

## Drop-in alternatives
- **TypeScript / x402-fetch:** `npm i @lionx402/guard` → `withLionGuard(payFetch)` auto-screens every `payTo` (CLEAR→pay, hit→throws `LionGuardBlockedError`).
- **MCP agents:** add `https://lionx402.com/api/mcp`; call `lion_compliance_bundle` ("Screen-Before-You-Pay — Counterparty Compliance Gate").

## Verify the receipt offline (no trust in LION at verify time)
Recompute SHA-256 over the canonical body (minus `attestation`), Ed25519-verify `attestation.signature` against the signer at:
```
https://lionx402.com/.well-known/lion-compliance-key.json
```
Helper: `@lionx402/receipt-verifier`, or append `?verify_helper=1` to any LION paid route.

## Notes
- Keyless — no LION account or API key. ~$0.05 USDC per screen, a small fraction of the payment it protects; cache CLEAR verdicts per counterparty to avoid re-screening.
- Multi-signal (OFAC + domain trust + token risk + firmographics) + a portable proof — not a single boolean.
- Fail-closed by default. Mechanical screening from public sources (OFAC SDN, Wikidata, DexScreener/GoPlus, DoH/crt.sh) — not legal advice.
