# Contributing to LION x402

Thanks for your interest! This repo is the **public distribution kit** for the LION
x402 MCP server (the server itself is hosted at `https://lionx402.com/api/mcp`).

## Ways to contribute

- **Report a bug** in the reference client (`examples/pay-lion.mjs`) or the docs — open an issue.
- **Improve the docs** — clarifications, fixes, and additional client examples (other languages/SDKs) are very welcome via PR.
- **Share an integration** — built an agent that uses LION? Open an issue and we'll link it.

## Trying it out

```bash
cd examples
npm install
LION_PK=0x<funded-base-wallet-key> npm run pay -- \
  "https://lionx402.com/api/x402/cpg-product-intel-json?barcode=5449000000996"
```

Use a **dedicated, low-balance Base wallet**. The key is read from the `LION_PK`
env var only — never commit a key.

## PR guidelines

- Keep PRs focused and small.
- For doc/code style, match the surrounding file.
- No secrets, keys, or `.env` files in commits (`.gitignore` already covers these).

## Questions

Open an issue, or use the free `lion_declare_need` / `lion_quick_intel` tools to
explore the server before paying for anything.
