# LION Quickstart — zero → first call in 2 minutes

LION is **keyless**: no API key, no signup, no account. Payment (USDC on Base via
[x402](https://x402.org)) is the only gate, and **every response is Ed25519-attested**
so your agent can verify integrity offline. Start free, upgrade per-call.

---

## 1. See real data now — free, no wallet (10 seconds)

No install, no dependencies. Pick your language:

```bash
cd examples
node try-free.mjs stripe.com     # Node 18+ (built-in fetch)
python3 try_free.py stripe.com   # Python 3 (standard library only)
```

You get real firmographics **plus an attestation block** — proof the response wasn't
tampered with, even on the free tier. Or one raw call:

```bash
curl -s https://lionx402.com/api/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"lion_quick_intel","arguments":{"entity":"coinbase.com"}}}'
```

Free tools: `lion_quick_intel` (entity signal) and `lion_declare_need` (describe a
need in plain language → it returns a sample + the exact paid call to make next).

---

## 2. No code — wire it into Claude Desktop / Cursor (30 seconds)

Add to your MCP config:

```json
{ "mcpServers": { "lionx402": { "url": "https://lionx402.com/api/mcp" } } }
```

Then ask your agent:
> *Use the lionx402 tools — run `lion_quick_intel` on coinbase.com, then
> `lion_token_risk_indicators` for token 0x4200000000000000000000000000000000000006.*

The free tools just work. Paid tools return a 402 with payment details your client
can fulfill (see step 3).

---

## 3. First paid call — pay-per-call USDC on Base (2 minutes)

Paid tools cost ~$0.002–$0.01. You pay from **your own** funded Base wallet — LION
never holds a key. The signed EIP-3009 transfer authorization *is* the payment.

**Node** (ethers):

```bash
cd examples
npm install                       # ethers only
LION_PK=0x<your-base-wallet-key> \
  node --max-http-header-size=131072 pay-lion.mjs \
  "https://lionx402.com/api/x402/cpg-product-intel-json?barcode=5449000000996"
```

**Python** (eth-account):

```bash
cd examples
pip install -r requirements.txt   # eth-account only
LION_PK=0x<your-base-wallet-key> \
  python3 pay_lion.py \
  "https://lionx402.com/api/x402/cpg-product-intel-json?barcode=5449000000996"
```

- `LION_PK` is read from the env so it never hits your shell history. Use a
  **dedicated low-balance wallet** funded with a little USDC on Base.
- The flow: `GET` → `402` + payment requirements → sign → retry with
  `Payment-Signature` header → `200` + attested data. No retries to babysit.

Both clients are ~100 lines, no SDK lock-in — copy `pay-lion.mjs` or `pay_lion.py`
into your agent as-is. They emit byte-identical payment signatures.

---

## 4. Verify the attestation (optional, recommended)

Every response carries:

```json
"attestation": {
  "alg": "ed25519",
  "signer": "<base64url ed25519 public key>",
  "payload_sha256": "<sha256 of the canonical body>",
  "signature": "<base64url signature>",
  "scheme": "Ed25519(SHA-256(canonical sorted-key JSON of this body WITHOUT the attestation field))"
}
```

So you can prove offline that the bytes you got are exactly what LION signed —
*don't trust, verify.* (Integrity only: it proves the response is authentic and
untampered, not that any external fact is true — judge that from each field's
`source`, `as_of`, and `confidence`.) The published signer key is at
`https://lionx402.com/api/x402/enrich-v1-json?verify_helper=1`.

---

## What's available

20 tools — firmographics + SEC financials, CPG/retail prices, on-chain token risk,
OFAC sanctions + EU VAT screening, domain intel, multi-chain Base RPC, and composite
bundles. Live catalog: <https://lionx402.com/api/x402/catalog> ·
<https://lionx402.com/.well-known/x402.json>
