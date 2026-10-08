# @lionx402/guard — screen-before-you-pay for x402 agents

x402 verifies the **payment**. It never verifies **who you are paying**.

Wrap your payment fetch. Before USDC leaves the wallet, Guard reads `payTo` from the target's `PAYMENT-REQUIRED` header and pays LION:

- **First time** this process sees that address: the **$0.001** OFAC wallet screen. **PASS** pays the target. **WARN** or **BLOCK** aborts.
- **Same address again:** the **$0.01** recheck. **GO** pays the target. **HOLD** or **STOP** aborts.

Not on npm. Use the files in this directory. It composes with the x402 client you already have. It does not re-implement payment, and it does not call the $0.05 compliance bundle.

## Use it
```js
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { withLionGuard, LionGuardBlockedError } from "./index.mjs";

const account = privateKeyToAccount(process.env.AGENT_PK);
const payFetch = wrapFetchWithPayment(fetch, account);
const guarded = withLionGuard(payFetch);

try {
  const res = await guarded("https://some-service.example/api/x402/thing");
  // res.lionVerdict is PASS, or GO on a repeat payTo
} catch (e) {
  if (e instanceof LionGuardBlockedError) {
    console.warn(`Blocked: ${e.verdict}`); // the target was not paid
  } else throw e;
}
```

## How it works
1. Probe the target **without paying**.
2. Read `payTo` from the `PAYMENT-REQUIRED` header (base64 JSON, `accepts[0].payTo`). Use the JSON body only when that header is absent. No `payTo` fails closed: LION is not called, and the target is not paid.
3. First sight of that address pays `GET https://lionx402.com/api/x402/wallet-screen-json?address=<payTo>`. Only `PASS` continues.
4. The next payment to the same address, in this process, pays `GET https://lionx402.com/api/x402/counterparty-recheck-json?address=<payTo>`. Only `GO` continues.

## Options
| option | default | meaning |
|---|---|---|
| `lionBaseUrl` | `https://lionx402.com` | LION origin |
| `failClosed` | `true` | block unless the screen says PASS, or the recheck says GO |
| `screen` | `true` | set `false` to bypass |
| `onReceipt(receipt, payTo, verdict)` | — | the LION response body |
| `probeFetch` | global `fetch` | non-paying fetch used to read the 402 |

## Cost
The first guarded payment to an address is **$0.001**. The same address again is **$0.01**. A response that is not a 402 is not screened. The signed body verifies offline against `https://lionx402.com/.well-known/lion-compliance-key.json`. Not legal advice.

MIT · built by LION · https://lionx402.com
