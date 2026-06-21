<p align="center"><img src="assets/lion-logo-400.png" alt="LION" width="150"></p>

# LION x402 — Keyless MCP Enrichment for Agents

**LION** is a keyless, account-less [MCP](https://modelcontextprotocol.io) server that gives AI agents pay-per-call access to real-world business & crypto data. Agents pay per call in **USDC on Base** via the [x402](https://x402.org) protocol (HTTP 402 + EIP-3009) — **no API key, no signup, no subscription. Payment is the only gate.**

Every response is **cryptographically Ed25519-attested**: an agent can verify *offline* that the data was not tampered with — provable, not self-reported. Verify it yourself with the zero-dependency package in [`verify/`](./verify) (`@lionx402/receipt-verifier`, Node + browser + CLI). Check x402 client compatibility in [CLIENT_COMPAT.md](./CLIENT_COMPAT.md).

> 🚀 **New here? → [QUICKSTART.md](./QUICKSTART.md)** — real attested data free in 10 seconds (no wallet), then your first paid call in 2 minutes.

- **MCP endpoint (Streamable HTTP):** `https://lionx402.com/api/mcp`
- **Discovery manifest:** `https://lionx402.com/.well-known/x402.json`
- **Free tier:** 100 calls/month per wallet via `?wallet=0x...`; or start with the free `lion_declare_need` / `lion_quick_intel` tools.
- **Network:** USDC on Base (`eip155:8453`), asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

## Quick start (Claude Desktop / Cursor)

```json
{
  "mcpServers": {
    "lionx402": { "url": "https://lionx402.com/api/mcp" }
  }
}
```

Then ask your agent: *"Use the lionx402 tools — call `lion_quick_intel` for coinbase.com, then `lion_cpg_product_intel` with barcode 5449000000996."*

## Tools

| Tool | Price (USDC) | What it returns |
|---|---|---|
| `lion_declare_need` | free | Quick-intel sample + the exact paid call to make |
| `lion_quick_intel` | free | Lightweight entity signal (attention/momentum) |
| `lion_enrich_v1` | $0.002/field | Company firmographics + SEC financials (Apollo-style org enrich), pay-per-field, Ed25519-attested |
| `lion_cpg_product_intel` | $0.004 | CPG/retail product + crowdsourced shop prices (Open Food Facts + Open Prices) |
| `lion_composite_bundle` | $0.005 | Enrichment + attested tx context + Base RPC in one call |
| `lion_sec_financials` | $0.005 | SEC EDGAR financials |
| `lion_token_risk_indicators` | $0.01 | Base/Ethereum/Solana token risk score + itemized flags |
| `lion_ofac_sanctions_screen` | $0.005 | OFAC sanctions screening |
| `lion_vat_validation` | $0.005 | EU VAT validation |
| `lion_domain_intel` | $0.005 | Domain trust signals |
| `lion_keyless_base_rpc` | from $0.001 | Multi-chain Base/Ethereum JSON-RPC reads |

Full live catalog: [`/api/x402/catalog`](https://lionx402.com/api/x402/catalog) · [`/.well-known/x402.json`](https://lionx402.com/.well-known/x402.json)

## How payment works (x402 / EIP-3009, keyless)

1. `GET` a paid route → server replies **HTTP 402** with the payment requirements (`accepts[]`: asset, amount in micro-USDC, EIP-712 domain).
2. Sign an **EIP-3009 `TransferWithAuthorization`** with any funded Base wallet (off-chain, one-time, no allowance, no custody).
3. Send the signed authorization in the `Payment-Signature` header and retry → **200 + data**.
4. A community facilitator broadcasts the authorization and pays gas; funds move **directly** buyer → payTo on-chain. LION never holds keys or funds.

Complete keyless reference clients: [`examples/pay-lion.mjs`](examples/pay-lion.mjs) (Node) and [`examples/pay_lion.py`](examples/pay_lion.py) (Python). A runnable end-to-end agent — counterparty due-diligence (firmographics + OFAC + token risk, with attestation verified) — is in [`examples/agents/`](examples/agents/).

## Verifying the attestation

Each paid response includes an `attestation` block:

```json
"attestation": {
  "alg": "ed25519",
  "signer": "<base64url public key>",
  "payload_sha256": "<sha256 of canonical body without the attestation field>",
  "signature": "<base64url ed25519 signature>"
}
```

Recompute `SHA-256(canonical sorted-key JSON of the body without the attestation field)` and verify the Ed25519 signature against the published `signer`. Ready-made verifiers (browser / Node / zero-dep Python) are in [`examples/verify/`](examples/verify/) — open `index.html` to paste-and-verify offline. Live helper: `GET https://lionx402.com/api/x402/enrich-v1-json?verify_helper=1`.

## Why LION

- **Keyless & frictionless** — x402 payment *is* authentication. Nothing to sign up for.
- **Verifiable by construction** — Ed25519 attestation + per-field source labels + confidence. Your agent can *prove* the data is untampered, unlike opaque aggregators.
- **Pay-for-what-you-use** — per-call (and per-field) micropayments in USDC on Base.
- **Open-data sourced** — Open Food Facts (ODbL), Open Prices, SEC EDGAR, Wikidata (CC0), with attribution.

## License

MIT — see [LICENSE](LICENSE).

---

*Public data only; no PII. Mechanical lookups from open sources. Not financial, investment, audit, or legal advice. Verify independently.*
