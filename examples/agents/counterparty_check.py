#!/usr/bin/env python3
"""Reference agent — crypto counterparty due-diligence, end-to-end via LION.

Given a counterparty's domain (and optionally their wallet address + a token they
want you to accept), this agent assembles a due-diligence report from LION:

  [1] Firmographics    — who they claim to be            FREE   (lion_quick_intel)
  [2] Sanctions screen — is their wallet OFAC-listed?     PAID   $0.005
  [3] Token risk       — is the token they offer risky?   PAID   $0.01

Every response's Ed25519 attestation is verified OFFLINE before it is trusted —
the agent refuses to act on data it can't prove came untampered from LION.

Usage
-----
  # free tier only (firmographics) — no wallet needed:
  python3 counterparty_check.py circle.com

  # full report — needs a funded Base wallet (~2 cents of USDC):
  pip install -r ../requirements.txt
  LION_PK=0x<key> python3 counterparty_check.py circle.com \
      --address 0xCOUNTERPARTY_WALLET --token 0xTOKEN --chain base

Attestation proves INTEGRITY (this is exactly what LION signed), not veracity
(whether the fact is true/current) — judge that from source / as_of / confidence.
"""
import argparse
import json
import os
import re
import sys
import urllib.request

# Reuse the PROVEN, tested helpers shipped in this repo (no reimplementation).
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "verify"))
sys.path.insert(0, os.path.join(HERE, ".."))
from lion_verify import lion_verify_attestation  # zero-dependency Ed25519 verifier
try:
    from pay_lion import pay  # keyless paid client (needs eth-account)
except Exception:
    pay = None

BASE = "https://lionx402.com"
MCP = BASE + "/api/mcp"


def free_tool(name, args):
    """Call a FREE LION tool over MCP; returns the parsed result object."""
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": name, "arguments": args}}
    req = urllib.request.Request(
        MCP, method="POST", data=json.dumps(payload).encode(),
        headers={"content-type": "application/json",
                 "accept": "application/json, text/event-stream",
                 "user-agent": "lion-counterparty-agent/1.0"})
    raw = urllib.request.urlopen(req).read().decode()
    m = re.search(r"\{.*\}", raw, re.S)
    return json.loads(json.loads(m.group(0))["result"]["content"][0]["text"])


def attest(obj):
    """Return a short human tag + the full verifier result for a LION response."""
    if not isinstance(obj, dict):
        return "n/a", {}
    r = lion_verify_attestation(obj)
    return ("verified ✅" if (r.get("ok") and r.get("trusted_signer")) else "UNVERIFIED ⚠️"), r


def main():
    ap = argparse.ArgumentParser(description="LION counterparty due-diligence agent")
    ap.add_argument("domain", help="counterparty domain, e.g. circle.com")
    ap.add_argument("--address", help="counterparty wallet to OFAC-screen (paid)")
    ap.add_argument("--token", help="token address to risk-check (paid)")
    ap.add_argument("--chain", default="base")
    a = ap.parse_args()

    pk = (os.environ.get("LION_PK") or "").strip()
    paid_ok = bool(pk) and pay is not None
    flags = []

    print(f"\n=== LION counterparty check: {a.domain} ===\n")

    # [1] Firmographics — free
    fi = free_tool("lion_quick_intel", {"entity": a.domain})
    tag, _ = attest(fi)
    d = fi.get("data") or {}
    print(f"[1] Firmographics  (FREE, attestation {tag})")
    print(f"    name: {d.get('name')}  |  country: {d.get('country')}  |  founded: {d.get('founded_year')}")
    print(f"    source: {fi.get('source')}  |  confidence: {fi.get('confidence')}")
    if tag.startswith("UNVERIFIED"):
        flags.append("firmographics failed attestation")

    # [2] Sanctions + [3] Token risk — paid
    if not paid_ok:
        why = "no LION_PK set" if not pk else "eth-account not installed (pip install -r ../requirements.txt)"
        print(f"\n[2] Sanctions screen  — SKIPPED ({why})")
        print(f"[3] Token risk        — SKIPPED ({why})")
        print("    → set LION_PK to a funded Base wallet to run the paid compliance checks.")
    else:
        if a.address:
            st, san = pay(f"{BASE}/api/x402/sanctions-screen-json?address={a.address}", pk)
            tag, _ = attest(san)
            print(f"\n[2] Sanctions screen  (PAID $0.005, HTTP {st}, attestation {tag})")
            print(f"    {a.address}")
            print(f"    {json.dumps(san) if isinstance(san, dict) else san}"[:400])
            if isinstance(san, dict) and (san.get("sanctioned") or san.get("listed") or san.get("match")):
                flags.append("OFAC sanctions hit")
            if tag.startswith("UNVERIFIED"):
                flags.append("sanctions response failed attestation")
        else:
            print("\n[2] Sanctions screen  — skipped (pass --address)")

        if a.token:
            st, tok = pay(f"{BASE}/api/x402/token-risk-indicators-json?token={a.token}&chain={a.chain}", pk)
            tag, _ = attest(tok)
            print(f"\n[3] Token risk  (PAID $0.01, HTTP {st}, attestation {tag})")
            print(f"    {a.token}")
            print(f"    {json.dumps(tok) if isinstance(tok, dict) else tok}"[:400])
            if tag.startswith("UNVERIFIED"):
                flags.append("token-risk response failed attestation")
        else:
            print("\n[3] Token risk  — skipped (pass --token)")

    print("\n=== verdict ===")
    print(f"  flags: {', '.join(flags) if flags else 'none'}")
    print("  reminder: attestation proves integrity, not veracity — confirm facts")
    print("  via each datapoint's source / as_of / confidence.\n")
    return 2 if flags else 0


if __name__ == "__main__":
    sys.exit(main())
