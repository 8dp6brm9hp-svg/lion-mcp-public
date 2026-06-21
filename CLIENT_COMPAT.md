# LION x402 — client compatibility

Can your agent's x402 client pay LION out of the box? Short answer: **yes for current x402 clients.** LION is x402 **v2**-native and lenient on inbound payloads. Verified 2026-06-21 against the live service.

## What LION speaks
| Aspect | LION |
|---|---|
| Protocol version | x402 **v2** (`x402Version: 2`) |
| Challenge | HTTP 402 with `accepts[]` in **both** the `Payment-Required` header (base64 JSON) **and** the response body |
| Request header (your payment) | reads **`Payment-Signature`** (v2) **and** legacy **`X-Payment`** (v1) |
| Settlement header (our reply) | emits **`Payment-Response`** + legacy **`X-Payment-Response`** + `payment_proof` in the body |
| Network | `eip155:8453` (CAIP-2), consistent across all routes; chainId 8453 |
| Asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Scheme | `exact` (and `upto`) |
| Settlement | keyless EIP-3009 `TransferWithAuthorization`, signed once off-chain; xpay facilitator broadcasts + pays gas; funds move you → payTo directly |

## Payload leniency (why standard clients work)
LION's verifier accepts the **canonical** x402 payment payload `{ x402Version, scheme, network, payload: { signature, authorization } }`. Top-level `asset`/`resource` are **optional** — if your client omits them (as the standard ones do), LION defaults them from the route. Inbound `network` accepts `eip155:8453`, `base`, `base-mainnet`, `base-sepolia`.

## Compatibility matrix
| Client | Status | Notes |
|---|---|---|
| `x402-fetch` (`wrapFetchWithPayment`) | ✅ works | sends `X-Payment` / `Payment-Signature`, canonical payload — accepted |
| `x402-axios` | ✅ works | same payload contract |
| Coinbase AgentKit / CDP clients | ✅ works | v2; settles to our payTo via EIP-3009 |
| Generic MCP clients (Claude/Cursor/Cline) | ✅ works | call the MCP endpoint; same pay flow |
| `Authorization: Bearer lct_…` (credits) | ✅ works | buy credits once, no per-call signature |
| Strict x402 **v1-only** client | ⚠️ caveat | a client that hard-requires `x402Version:1` + short network `base` and only reads the v1 `X-PAYMENT` flow may not parse a v2 challenge. Current clients are v2; low risk, monitored |

## One operational note
Cloudflare bot protection may return **403 to bare default User-Agents** (e.g. `python-urllib`) *before* LION can return its 402. Use a realistic UA (`curl/8`, `x402-fetch`'s UA, or `LION-Agent/1.0 (autonomous)`). Standard HTTP clients are unaffected.

## Verify what you receive
Every paid response is Ed25519-attested; the `?receipt=1` compliance receipt is a portable, offline-reverifiable audit record. Verify with [`verify/`](./verify) (`@lionx402/receipt-verifier`) or the live helper at `…/api/x402/<route>?verify_helper=1`.
