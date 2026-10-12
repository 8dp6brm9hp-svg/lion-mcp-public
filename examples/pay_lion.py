#!/usr/bin/env python3
"""LION x402 keyless reference client (Python).

Pays an HTTP 402 LION route in USDC on Base with any funded wallet. No API key,
no account: the signed EIP-3009 transfer authorization IS the payment.

    pip install -r requirements.txt      # just eth-account
    LION_PK=0x<base-wallet-private-key> python3 pay_lion.py \
        "https://lionx402.com/api/x402/wallet-screen-json?address=0x0000000000000000000000000000000000000001"

The private key is read from LION_PK so it never lands in shell history. Use a
dedicated, low-balance wallet funded with a little USDC on Base.

x402 v2 puts the challenge in the PAYMENT-REQUIRED header. The body may be the
same JSON, or {}. This client reads the header first, then the body. The signed
retry is a v2 payload in a standard-base64 PAYMENT-SIGNATURE. The payload shape
matches examples/pay-lion.mjs.

Importable: `from pay_lion import pay` -> pay(resource_url, private_key)
returns (status, body). A 402 with no challenge raises RuntimeError.
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
from eth_utils import to_checksum_address

CHAIN_ID = 8453  # Base

TYPED_DATA_TYPES = {
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
}


def decode_payment_required(header):
    """Decode a PAYMENT-REQUIRED header. Standard base64 and base64url both work."""
    if not isinstance(header, str):
        return None
    raw = header.strip()
    if not raw:
        return None
    try:
        pad = "" if len(raw) % 4 == 0 else "=" * (4 - (len(raw) % 4))
        b64 = raw.replace("-", "+").replace("_", "/") + pad
        obj = json.loads(base64.b64decode(b64).decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    accepts = obj.get("accepts") if isinstance(obj, dict) else None
    if not isinstance(accepts, list) or not accepts:
        return None
    return obj


def read_challenge(header, body):
    """Header wins. Body is the fallback for a client that only stored the JSON."""
    from_header = decode_payment_required(header)
    if from_header:
        return from_header
    if isinstance(body, dict):
        accepts = body.get("accepts")
        if isinstance(accepts, list) and accepts:
            return body
    return None


def resolve_challenge(status, header, body):
    """Return the challenge, None when the call was not a 402, or raise."""
    challenge = read_challenge(header, body)
    if challenge:
        return challenge
    if status == 402:
        raise RuntimeError(
            "HTTP 402 had no payment challenge in PAYMENT-REQUIRED or the body"
        )
    return None


def pick_accept(challenge):
    accepts = challenge.get("accepts") or []
    for accept in accepts:
        network = str(accept.get("network") or "")
        if accept.get("scheme") == "exact" and network in ("eip155:8453", "base"):
            return accept
    return accepts[0] if accepts else None


def encode_payment_signature(payload) -> str:
    """Standard base64. The server rejects base64url '-' and '_'."""
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def _account_signer(account):
    def sign(domain, _types, message):
        full_message = {
            "types": TYPED_DATA_TYPES,
            "domain": domain,
            "primaryType": "TransferWithAuthorization",
            "message": {
                "from": message["from"],
                "to": message["to"],
                "value": int(message["value"]),
                "validAfter": int(message["validAfter"]),
                "validBefore": int(message["validBefore"]),
                "nonce": bytes.fromhex(message["nonce"][2:]),
            },
        }
        signature = account.sign_message(encode_typed_data(full_message=full_message)).signature.hex()
        if not signature.startswith("0x"):
            signature = "0x" + signature
        return signature

    return sign


def build_payment_payload(challenge, wallet, *, get_address=None, sign_typed_data=None):
    """Build the PAYMENT-SIGNATURE payload. Does not broadcast it.

    wallet is an eth_account LocalAccount, or any object with .address when
    sign_typed_data is injected. get_address defaults to EIP-55 checksum.
    """
    accept = pick_accept(challenge)
    if not accept:
        raise RuntimeError("402 challenge has no accepts")
    if get_address is None:
        get_address = to_checksum_address
    address = wallet["address"] if isinstance(wallet, dict) else wallet.address
    version = 1 if challenge.get("x402Version") == 1 else 2
    if sign_typed_data is None:
        sign_typed_data = _account_signer(wallet)

    if version == 1:
        value = str(accept.get("maxAmountRequired") or accept.get("amount"))
        extra = accept.get("extra") or {}
        timeout = accept.get("maxTimeoutSeconds") or 600
        domain_name = extra.get("name") or "USD Coin"
        domain_version = extra.get("version") or "2"
    else:
        extra = accept.get("extra") or {}
        if not extra.get("name") or not extra.get("version"):
            raise RuntimeError("402 accept is missing EIP-712 extra.name and extra.version")
        if accept.get("amount") is None:
            raise RuntimeError("402 accept is missing amount")
        value = str(accept.get("amount"))
        timeout = accept.get("maxTimeoutSeconds") or 60
        domain_name = extra["name"]
        domain_version = extra["version"]

    now = int(time.time())
    valid_after = str(now - 60) if version == 1 else "0"
    authorization = {
        "from": get_address(address),
        "to": get_address(accept["payTo"]),
        "value": value,
        "validAfter": valid_after,
        "validBefore": str(now + int(timeout)),
        "nonce": "0x" + secrets.token_hex(32),
    }
    domain = {
        "name": domain_name,
        "version": domain_version,
        "chainId": CHAIN_ID,
        "verifyingContract": get_address(accept["asset"]),
    }
    message = {
        "from": authorization["from"],
        "to": authorization["to"],
        "value": int(authorization["value"]),
        "validAfter": int(authorization["validAfter"]),
        "validBefore": int(authorization["validBefore"]),
        "nonce": authorization["nonce"],
    }
    signature = sign_typed_data(domain, TYPED_DATA_TYPES["TransferWithAuthorization"], message)
    if version == 1:
        return {
            "x402Version": 1,
            "scheme": accept.get("scheme") or "exact",
            "network": accept.get("network") or "base",
            "payload": {"signature": signature, "authorization": authorization},
        }
    return {
        "x402Version": 2,
        "resource": challenge.get("resource"),
        "accepted": accept,
        "payload": {"signature": signature, "authorization": authorization},
    }


def header_get(headers, name):
    if not headers:
        return None
    getter = getattr(headers, "get", None)
    if getter is None:
        return None
    return getter(name)


def parse_body(text):
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def http(url, headers=None):
    """GET returning (status, headers, text). 402 and other 4xx are returned."""
    hdrs = {"Accept": "application/json", "User-Agent": "lion-x402-example/1.0"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs, method="GET")
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, response.headers, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read().decode()


def prepare(resource):
    """Fetch the resource once. Return (status, body, challenge or None)."""
    status, headers, text = http(resource)
    body = parse_body(text)
    challenge = resolve_challenge(status, header_get(headers, "payment-required"), body)
    return status, body, challenge


def settle(resource, pk, challenge):
    """Sign challenge and retry the same URL. Return (status, body)."""
    if pk and not str(pk).startswith("0x"):
        pk = "0x" + pk
    account = Account.from_key(pk)
    payload = build_payment_payload(challenge, account)
    signature = encode_payment_signature(payload)
    status, _headers, text = http(resource, {"PAYMENT-SIGNATURE": signature})
    return status, parse_body(text)


def pay(resource, pk):
    """Pay a LION 402 route; return (status, body). body is a dict when JSON.

    Free / already-paid routes return their body directly with no payment.
    A 402 that carries no challenge raises RuntimeError instead of looking free.
    """
    status, body, challenge = prepare(resource)
    if challenge is None:
        return status, body
    return settle(resource, pk, challenge)


def main():
    if len(sys.argv) < 2:
        sys.exit("ERROR: pass the paid resource URL as argument 1")
    pk = (os.environ.get("LION_PK") or "").strip()
    if not pk:
        sys.exit("ERROR: set LION_PK to your funded Base wallet private key")
    if not pk.startswith("0x"):
        pk = "0x" + pk

    print("payer:", Account.from_key(pk).address, file=sys.stderr)
    try:
        status, body, challenge = prepare(sys.argv[1])
    except RuntimeError as error:
        sys.exit(f"ERROR: {error}")
    if challenge is None:
        print(json.dumps(
            {"note": "no 402 (free/already paid)", "status": status, "body": body},
            indent=2,
        ))
        return

    accept = pick_accept(challenge)
    atomic = accept.get("amount") or accept.get("maxAmountRequired")
    print(
        f"paying: {int(atomic) / 1e6} USDC -> {accept.get('payTo')}",
        file=sys.stderr,
    )
    status, body = settle(sys.argv[1], pk, challenge)
    print("HTTP", status)
    print(json.dumps(body, indent=2) if isinstance(body, (dict, list)) else body)
    if status == 402:
        sys.exit(1)


if __name__ == "__main__":
    main()
