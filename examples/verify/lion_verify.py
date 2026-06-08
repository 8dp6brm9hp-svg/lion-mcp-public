#!/usr/bin/env python3
"""LION attestation verifier (Ed25519) — prove a LION response is untampered, OFFLINE.

Zero dependencies: pure-Python Ed25519 (RFC 8032), standard library only.

    python3 lion_verify.py response.json     # verify a saved response
    curl ... | python3 lion_verify.py        # or pipe one in via stdin

    from lion_verify import lion_verify_attestation
    r = lion_verify_attestation(response_dict)   # r["ok"] is True if authentic

What this proves: the bytes you received are EXACTLY what LION signed (integrity
/ authenticity) — not that any external fact is true. Judge truth from each
field's `source`, `as_of`, and `confidence`.
"""
import hashlib
import json
import sys

# LION's published Ed25519 signer (trust anchor). A valid signature from a
# DIFFERENT key is cryptographically fine but is NOT LION — we flag that.
LION_PUBLISHED_SIGNER = "H9jfKtGS3G8mGzA2fH7KSzyvEhk0j-j9gvmqMrjQt7w"


# ---- canonical JSON: must match the server's JS stableStringify byte-for-byte ----
def _stable(v) -> str:
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        # JS Number -> string is shortest round-trip; so is Python repr() (3.1+).
        return repr(v)
    if isinstance(v, list):
        return "[" + ",".join(_stable(x) for x in v) + "]"
    if isinstance(v, dict):
        keys = sorted(v.keys())
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + _stable(v[k]) for k in keys) + "}"
    raise TypeError("uncanonicalizable type: " + type(v).__name__)


def _b64url(s: str) -> bytes:
    s = s.replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)
    import base64
    return base64.b64decode(s)


# ---- pure-Python Ed25519 verify (RFC 8032 reference math) ----
_p = 2 ** 255 - 19
_d = (-121665 * pow(121666, _p - 2, _p)) % _p
_I = pow(2, (_p - 1) // 4, _p)


def _xrecover(y):
    xx = (y * y - 1) * pow(_d * y * y + 1, _p - 2, _p) % _p
    x = pow(xx, (_p + 3) // 8, _p)
    if (x * x - xx) % _p != 0:
        x = (x * _I) % _p
    if x % 2 != 0:
        x = _p - x
    return x


_By = 4 * pow(5, _p - 2, _p) % _p
_B = (_xrecover(_By) % _p, _By % _p)


def _edwards(P, Q):
    x1, y1 = P
    x2, y2 = Q
    inv = pow(1 + _d * x1 * x2 * y1 * y2, _p - 2, _p)
    inv2 = pow(1 - _d * x1 * x2 * y1 * y2, _p - 2, _p)
    x3 = (x1 * y2 + x2 * y1) * inv % _p
    y3 = (y1 * y2 + x1 * x2) * inv2 % _p
    return (x3, y3)


def _scalarmult(P, e):
    Q = (0, 1)
    while e > 0:
        if e & 1:
            Q = _edwards(Q, P)
        P = _edwards(P, P)
        e >>= 1
    return Q


def _bit(h, i):
    return (h[i // 8] >> (i % 8)) & 1


def _decodeint(s):
    return sum(2 ** i * _bit(s, i) for i in range(256))


def _decodepoint(s):
    y = sum(2 ** i * _bit(s, i) for i in range(255))
    x = _xrecover(y)
    if x & 1 != _bit(s, 255):
        x = _p - x
    P = (x, y)
    if (-x * x + y * y - 1 - _d * x * x * y * y) % _p != 0:
        raise ValueError("point not on curve")
    return P


def _encodepoint(P):
    x, y = P
    bits = [(y >> i) & 1 for i in range(255)] + [x & 1]
    return bytes(sum(bits[i * 8 + j] << j for j in range(8)) for i in range(32))


def _ed25519_verify(signature: bytes, message: bytes, pubkey: bytes) -> bool:
    if len(signature) != 64 or len(pubkey) != 32:
        return False
    try:
        R = _decodepoint(signature[:32])
        A = _decodepoint(pubkey)
        S = _decodeint(signature[32:])
        # h is the FULL 512-bit SHA-512 as a little-endian int (not truncated to 256).
        h = int.from_bytes(hashlib.sha512(signature[:32] + pubkey + message).digest(), "little")
        return _scalarmult(_B, S) == _edwards(R, _scalarmult(A, h))
    except Exception:
        return False


def lion_verify_attestation(resp: dict) -> dict:
    att = (resp or {}).get("attestation")
    if not att or not att.get("signature"):
        return {"ok": False, "reason": "no_attestation"}
    body = {k: v for k, v in resp.items() if k != "attestation"}
    canonical = _stable(body)
    digest = hashlib.sha256(canonical.encode("utf-8")).digest()
    sha_hex = digest.hex()
    ok = _ed25519_verify(_b64url(att["signature"]), digest, _b64url(att["signer"]))
    return {
        "ok": bool(ok),
        "signer": att.get("signer"),
        "trusted_signer": att.get("signer") == LION_PUBLISHED_SIGNER,
        "payload_sha256": sha_hex,
        "sha256_matches_claim": (not att.get("payload_sha256")) or att.get("payload_sha256") == sha_hex,
    }


def main():
    text = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    r = lion_verify_attestation(json.loads(text))
    print(json.dumps(r, indent=2))
    if r["ok"] and r.get("trusted_signer"):
        print("\n✅ AUTHENTIC — untampered and signed by LION's published key.")
        sys.exit(0)
    elif r["ok"]:
        print("\n⚠️  Signature valid, but signer is NOT LION's published key. Not from LION.")
        sys.exit(1)
    else:
        print("\n❌ NOT VERIFIED — tampered, malformed, or unsigned. Do not trust.")
        sys.exit(1)


if __name__ == "__main__":
    main()
