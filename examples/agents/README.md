# Reference agents

Small, runnable agents that do a real job end-to-end through LION — free tools,
paid tools, and offline attestation verification, wired together the way you'd
wire them into your own agent.

## `counterparty_check.py` — crypto counterparty due-diligence

Given a counterparty's domain (and optionally their wallet + a token they want you
to accept), it builds a due-diligence report:

| Step | Source | Cost |
|---|---|---|
| Firmographics — who they claim to be | `lion_quick_intel` | **free** |
| Sanctions screen — is their wallet OFAC-listed? | `sanctions-screen-json` | $0.005 |
| Token risk — is the token they offer risky? | `token-risk-indicators-json` | $0.01 |

Every response is verified with the offline Ed25519 verifier before it's trusted —
the agent won't act on data it can't prove came untampered from LION.

```bash
# Free tier (firmographics only) — no wallet, runs immediately:
python3 counterparty_check.py circle.com

# Full report — needs a funded Base wallet (~2 cents of USDC):
pip install -r ../requirements.txt
LION_PK=0x<key> python3 counterparty_check.py circle.com \
    --address 0xCOUNTERPARTY_WALLET --token 0xTOKEN --chain base
```

It reuses the repo's proven building blocks rather than reimplementing them:
[`pay_lion.py`](../pay_lion.py) for the keyless payment and
[`verify/lion_verify.py`](../verify/lion_verify.py) for attestation — so the ~140
lines here are just orchestration you can read top to bottom and adapt.

**Integrity, not veracity:** a `verified ✅` tag means the bytes are exactly what
LION signed — not that the underlying fact is true or current. Judge that from each
datapoint's `source`, `as_of`, and `confidence`.
