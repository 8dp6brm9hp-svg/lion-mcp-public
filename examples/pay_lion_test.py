#!/usr/bin/env python3
"""Local checks for pay_lion.py. No network and no funded key."""
import base64
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pay_lion

CHALLENGE = {
    "x402Version": 2,
    "error": "Payment required",
    "resource": {
        "url": "https://lionx402.com/api/x402/wallet-screen-json?address=0x1",
        "description": "screen",
        "mimeType": "application/json",
    },
    "accepts": [
        {
            "scheme": "exact",
            "network": "eip155:8453",
            "amount": "1000",
            "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            "payTo": "0x68e3E7822cf83C824cF9606EC999b5e8a93c85B5",
            "maxTimeoutSeconds": 60,
            "extra": {"name": "USD Coin", "version": "2"},
        }
    ],
}
HEADER = base64.b64encode(json.dumps(CHALLENGE).encode()).decode()


def main():
    from_header = pay_lion.read_challenge(HEADER, {})
    assert from_header["x402Version"] == 2
    assert from_header["accepts"][0]["amount"] == "1000"

    from_body = pay_lion.read_challenge(None, CHALLENGE)
    assert from_body["accepts"][0]["payTo"] == CHALLENGE["accepts"][0]["payTo"]

    other = json.loads(json.dumps(CHALLENGE))
    other["accepts"][0]["amount"] = "999999"
    assert pay_lion.read_challenge(HEADER, other)["accepts"][0]["amount"] == "1000"

    urlsafe = base64.urlsafe_b64encode(json.dumps(CHALLENGE).encode()).decode().rstrip("=")
    assert pay_lion.decode_payment_required(urlsafe)["x402Version"] == 2
    assert pay_lion.read_challenge(None, {}) is None
    assert pay_lion.decode_payment_required("not-base64!!!") is None
    assert pay_lion.pick_accept(CHALLENGE)["network"] == "eip155:8453"
    try:
        pay_lion.resolve_challenge(402, None, {})
        raise AssertionError("challengeless 402 should fail")
    except RuntimeError as error:
        assert "no payment challenge" in str(error)
    assert pay_lion.resolve_challenge(200, None, {"ok": True}) is None

    signed = []

    def sign_typed_data(domain, _types, message):
        signed.append({"domain": domain, "message": message})
        return "0x" + "11" * 65

    wallet = {"address": "0x0000000000000000000000000000000000000001"}
    before = int(time.time())
    payload = pay_lion.build_payment_payload(
        CHALLENGE,
        wallet,
        get_address=lambda address: address,
        sign_typed_data=sign_typed_data,
    )
    assert payload["x402Version"] == 2
    assert payload["accepted"] is CHALLENGE["accepts"][0]
    assert payload["resource"] is CHALLENGE["resource"]
    authorization = payload["payload"]["authorization"]
    assert authorization["validAfter"] == "0"
    assert authorization["value"] == "1000"
    assert isinstance(authorization["validBefore"], str)
    valid_before = int(authorization["validBefore"])
    assert before + 60 <= valid_before <= int(time.time()) + 60
    assert signed[0]["message"]["validAfter"] == 0
    assert signed[0]["domain"]["name"] == "USD Coin"
    assert signed[0]["domain"]["version"] == "2"
    assert "extensions" not in payload

    encoded = pay_lion.encode_payment_signature(payload)
    assert re.fullmatch(r"[A-Za-z0-9+/]*={0,2}", encoded)
    assert "-" not in encoded and "_" not in encoded
    round_trip = json.loads(base64.b64decode(encoded))
    assert round_trip["accepted"]["amount"] == "1000"

    broken = json.loads(json.dumps(CHALLENGE))
    del broken["accepts"][0]["extra"]
    try:
        pay_lion.build_payment_payload(
            broken,
            wallet,
            get_address=lambda address: address,
            sign_typed_data=sign_typed_data,
        )
        raise AssertionError("missing EIP-712 extra should fail")
    except RuntimeError as error:
        assert "extra.name" in str(error)

    # Local signature only. This key is the public Hardhat test key, not a funded wallet.
    test_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    account = pay_lion.Account.from_key(test_key)
    real = pay_lion.build_payment_payload(CHALLENGE, account)
    signature = real["payload"]["signature"]
    assert signature.startswith("0x")
    assert len(signature) == 132
    assert real["payload"]["authorization"]["from"] == account.address
    assert real["payload"]["authorization"]["validAfter"] == "0"
    assert "extensions" not in real

    print("pay_lion tests ok")


if __name__ == "__main__":
    main()
