#!/usr/bin/env python3
"""LION — free first touch (Python). Real, Ed25519-attested data in ~10 seconds.

No wallet, no API key, no signup, and NO dependencies — standard library only.

    python3 try_free.py                # defaults to coinbase.com
    python3 try_free.py stripe.com

Calls the FREE `lion_quick_intel` tool over MCP and prints the data plus the
attestation you can verify offline. Free responses are attested too — LION's
integrity proof is not paywalled. For deeper data see QUICKSTART.md / pay_lion.py.
"""
import json
import re
import sys
import urllib.request

entity = sys.argv[1] if len(sys.argv) > 1 else "coinbase.com"
MCP = "https://lionx402.com/api/mcp"

payload = {
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {"name": "lion_quick_intel", "arguments": {"entity": entity}},
}
req = urllib.request.Request(
    MCP, method="POST", data=json.dumps(payload).encode(),
    headers={"content-type": "application/json",
             "accept": "application/json, text/event-stream",
             "user-agent": "lion-x402-example/1.0"},
)

print(f"LION free quick-intel → {entity}\n")
raw = urllib.request.urlopen(req).read().decode()
# MCP may answer as plain JSON or a single SSE `data:` frame — handle both.
m = re.search(r"\{.*\}", raw, re.S)
if not m:
    sys.exit("unexpected MCP response: " + raw[:200])
obj = json.loads(json.loads(m.group(0))["result"]["content"][0]["text"])

print("data:")
print(json.dumps(obj.get("data"), indent=2))
print(f"\nsource: {obj.get('source')}  |  confidence: {obj.get('confidence')}  "
      f"|  as_of: {obj.get('as_of')}  |  free_tier: {obj.get('free_tier')}")

att = obj.get("attestation") or {}
print("\nattestation — verify OFFLINE that this exact response is untampered:")
print(f"  alg:            {att.get('alg')}")
print(f"  signer:         {att.get('signer')}")
print(f"  payload_sha256: {att.get('payload_sha256')}")
sig = att.get("signature") or ""
print(f"  signature:      {sig[:28]}…")

print("\nNext steps:")
print("  • `lion_declare_need` tells you the exact paid call for deeper data.")
print("  • Paid calls cost ~$0.002–$0.01 in USDC on Base — see QUICKSTART.md / pay_lion.py.")
print("  • No-code: drop this into Claude Desktop / Cursor →")
print('      { "mcpServers": { "lionx402": { "url": "https://lionx402.com/api/mcp" } } }')
