# LION attestation verifier — *don't trust, verify*

Every LION response (free **and** paid) carries an `attestation` block. These tools
let you prove, **offline**, that a response is exactly what LION signed — no network
call, no trust in this code's author required (the scheme is open and below).

| Tool | Use it for | Dependencies |
|---|---|---|
| [`index.html`](./index.html) | Paste-and-verify in your browser (fully client-side) | none — open the file |
| [`verify.mjs`](./verify.mjs) | JS agents / CI | Node 20+ (built-in) |
| [`lion_verify.py`](./lion_verify.py) | Python agents / CI | none (pure-Python Ed25519) |

```bash
# Node
curl -s https://lionx402.com/api/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"lion_quick_intel","arguments":{"entity":"coinbase.com"}}}' \
  | node -e 'process.stdin.once("data",d=>{const m=String(d).match(/\{[\s\S]*\}/);console.log(JSON.parse(JSON.parse(m[0]).result.content[0].text))})' > resp.json
node verify.mjs resp.json

# Python (zero deps)
python3 lion_verify.py resp.json
```

Programmatic:

```js
import { lionVerifyAttestation } from "./verify.mjs";
const r = await lionVerifyAttestation(resp);   // { ok, trusted_signer, payload_sha256, ... }
```
```python
from lion_verify import lion_verify_attestation
r = lion_verify_attestation(resp)              # {"ok": ..., "trusted_signer": ..., ...}
```

## The scheme (so you can re-implement it in any language)

1. Take the response object and **remove** the `attestation` field.
2. **Canonicalize**: serialize as JSON with object keys sorted recursively (arrays
   keep their order, no extra whitespace). This is `attestation.scheme`'s
   "canonical sorted-key JSON".
3. `digest = SHA-256(utf8(canonical))` → 32 bytes.
4. **Ed25519-verify** `attestation.signature` over those 32 digest bytes, using
   `attestation.signer` as the raw public key. Signatures and the key are
   base64url-encoded.

All four steps are ~15 lines each; see the files. They agree byte-for-byte and are
checked against the [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032) Ed25519 test
vectors.

## Trust anchor

LION's published signer key is **`H9jfKtGS3G8mGzA2fH7KSzyvEhk0j-j9gvmqMrjQt7w`**.
A response can be cryptographically valid yet signed by a *different* key — that is
**not** LION, and every tool here flags it (`trusted_signer: false`). The live key
is also served at
<https://lionx402.com/api/x402/enrich-v1-json?verify_helper=1>.

## What attestation does and does not mean

- ✅ **Integrity / authenticity** — this exact response was produced by LION's key
  and has not been altered in transit.
- ❌ **Not veracity** — it does *not* prove a fact is true or current. Judge that
  from each field's `source`, `as_of`, and `confidence`.
