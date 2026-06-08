# Installing LION in Cline (and other MCP clients)

LION is a **remote MCP server** (Streamable HTTP). There is **nothing to build,
install, or run locally** — you add it by URL. No API key, no signup, no command,
no dependencies.

## Install

Add this to your Cline MCP settings (`cline_mcp_settings.json`):

```json
{ "mcpServers": { "lionx402": { "url": "https://lionx402.com/api/mcp" } } }
```

That is the entire installation.

## Verify it works (free, no wallet)

Ask Cline to call `lion_quick_intel` with entity `coinbase.com`. You should get
back firmographics plus an `attestation` block (Ed25519). Done.

## Notes for the installer

- **Transport:** Streamable HTTP (remote). Protocol flow `initialize` →
  `tools/list` → `tools/call` is implemented and live.
- **20 tools.** Free (no payment): `lion_quick_intel`, `lion_declare_need`.
- **Paid tools** (e.g. `lion_ofac_sanctions_screen`, `lion_token_risk_indicators`)
  respond with HTTP 402 + x402 payment details; the user pays per call in USDC on
  Base from their own wallet. LION holds no keys or funds.
- **Every response is Ed25519-attested** — verifiable offline. Signer key:
  `https://lionx402.com/api/x402/enrich-v1-json?verify_helper=1`
