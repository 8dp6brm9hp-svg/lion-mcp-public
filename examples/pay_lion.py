#!/usr/bin/env python3
"""LION x402 keyless reference client (Python).

Pays an HTTP 402 LION route in USDC on Base with any funded wallet. No API key,
no account: the signed EIP-3009 transfer authorization IS the payment.

    pip install -r requirements.txt      # just eth-account
    LION_PK=0x<base-wallet-private-key> python3 pay_lion.py \
        "https://lionx402.com/api/x402/cpg-product-intel-json?barcode=5449000000996"

The private key is read from LION_PK so it never lands in shell history. Use a
dedicated, low-balance wallet funded with a little USDC on Base.

Importable: `from pay_lion import pay` -> pay(resource_url, private_key).
Signing is byte-for-byte identical to the proven JS reference (examples/pay-lion.mjs);
this client only differs in language, not in the bytes it puts on the wire.
"""
import base64
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request

from eth_account import Account
from eth_account.messages import encode_typed_data

CHAIN_ID = 8453  # Base


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def http(url: str, headers=None):
    """GET returning (status, text); 402/4xx bodies are returned, not raised."""
    hdrs = {"accept": "application/json", "user-agent": "lion-x402-example/1.0"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, headers=hdrs)
    try:
        r = urllib.request.urlopen(req)
        return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def pick_accept(body):
    accepts = body.get("accepts") or []
    for a in accepts:
        extra = a.get("extra") or {}
        if a.get("scheme") == "exact" and (extra.get("facilitatorKind") == "xpay" or a.get("x402Version") == 1):
            return a
    return accepts[0] if accepts else None


def build_payment_header(accept, acct) -> str:
    """Sign the EIP-3009 authorization, return the base64url x402 envelope header.

    Byte-identical to the proven JS reference (examples/pay-lion.mjs).
    """
    value = str(accept.get("amount") or accept.get("maxAmountRequired"))
    asset = accept["asset"]
    pay_to = accept["payTo"]
    now = int(time.time())
    nonce_hex = secrets.token_hex(32)  # unique per signature, forever
    authorization = {
        "from": acct.address,
        "to": pay_to,
        "value": int(value),
        "validAfter": now - 60,
        "validBefore": now + 600,
        "nonce": bytes.fromhex(nonce_hex),
    }
    extra = accept.get("extra") or {}
    full_message = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "TransferWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ],
        },
        "domain": {
            "name": extra.get("name") or "USD Coin",
            "version": extra.get("version") or "2",
            "chainId": CHAIN_ID,
            "verifyingContract": asset,
        },
        "primaryType": "TransferWithAuthorization",
        "message": authorization,
    }
    signature = acct.sign_message(encode_typed_data(full_message=full_message)).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature

    # The FULL x402 envelope (not just {signature, authorization}) is required.
    envelope = {
        "x402Version": accept.get("x402Version") or 1,
        "scheme": accept.get("scheme") or "exact",
        "network": accept.get("network") or "base",
        "asset": asset,
        "payTo": pay_to,
        "resource": accept.get("resource"),
        "maxAmountRequired": value,
        "amount": value,
        "payload": {
            "signature": signature,
            "authorization": {
                "from": acct.address,
                "to": pay_to,
                "value": value,
                "validAfter": authorization["validAfter"],
                "validBefore": authorization["validBefore"],
                "nonce": "0x" + nonce_hex,
            },
        },
    }
    # Header value = base64url(JSON). Server base64url-decodes then JSON.parses.
    return b64u(json.dumps(envelope, separators=(",", ":")).encode())


def pay(resource: str, pk: str):
    """Pay a LION 402 route; return (status, body). body is a dict when JSON.

    Free / already-paid routes return their body directly with no payment.
    Reusable from other scripts and agents.
    """
    if pk and not pk.startswith("0x"):
        pk = "0x" + pk
    acct = Account.from_key(pk)
    status, text = http(resource)
    challenge = json.loads(text)
    if not challenge.get("accepts"):
        return status, challenge  # not a 402 (free or already paid)
    header = build_payment_header(pick_accept(challenge), acct)
    status, text = http(resource, {"accept": "application/json", "Payment-Signature": header})
    try:
        return status, json.loads(text)
    except json.JSONDecodeError:
        return status, text


def main():
    if len(sys.argv) < 2:
        sys.exit("ERROR: pass the paid resource URL as argument 1")
    pk = (os.environ.get("LION_PK") or "").strip()
    if not pk:
        sys.exit("ERROR: set LION_PK to your funded Base wallet private key")
    status, body = pay(sys.argv[1], pk)
    print("HTTP", status)
    print(json.dumps(body, indent=2) if isinstance(body, (dict, list)) else body)


if __name__ == "__main__":
    main()
