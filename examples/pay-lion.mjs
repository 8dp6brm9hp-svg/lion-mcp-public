// LION x402 keyless reference client (EIP-3009 / EIP-712 -> Payment-Signature)
//
// Pays an HTTP 402 LION route in USDC on Base with any funded wallet.
// No API key, no account: the signed transfer authorization IS the payment.
//
// Usage:
//   npm install ethers
//   LION_PK=0x<base-wallet-private-key> node --max-http-header-size=131072 pay-lion.mjs \
//     "https://lionx402.com/api/x402/cpg-product-intel-json?barcode=5449000000996"
//
// The private key is read from the LION_PK env var so it never appears in shell history.
// Use a dedicated low-balance wallet.

import { ethers } from "ethers";
import crypto from "node:crypto";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const RESOURCE = process.argv[2];
let PK = (process.env.LION_PK || "").trim();
if (PK && !PK.startsWith("0x")) PK = "0x" + PK;
if (!PK) { console.error("ERROR: set LION_PK to your funded Base wallet private key"); process.exit(1); }
if (!RESOURCE) { console.error("ERROR: pass the paid resource URL as argument 1"); process.exit(1); }

// Pick the keyless xpay accept (x402 v1, exact scheme on Base).
function pickAccept(body) {
  const accepts = body.accepts || [];
  return accepts.find(a => a.scheme === "exact" && (a.extra?.facilitatorKind === "xpay" || a.x402Version === 1)) || accepts[0];
}

async function buildEnvelope(accept, wallet) {
  const chainId = 8453;
  const asset = accept.asset;
  const value = String(accept.amount || accept.maxAmountRequired);
  const to = accept.payTo;
  const from = wallet.address;
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from, to, value,
    validAfter: now - 60,
    validBefore: now + 600,
    nonce: "0x" + crypto.randomBytes(32).toString("hex"), // unique per signature, forever
  };

  const domain = { name: accept.extra?.name || "USD Coin", version: accept.extra?.version || "2", chainId, verifyingContract: asset };
  const types = { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" } ] };

  const signature = await wallet.signTypedData(domain, types, authorization);

  // The FULL x402 envelope (not just {signature, authorization}) is required.
  return {
    x402Version: accept.x402Version || 1,
    scheme: accept.scheme || "exact",
    network: accept.network || "base",
    asset,
    payTo: to,
    resource: accept.resource,
    maxAmountRequired: value,
    amount: value,
    payload: { signature, authorization },
  };
}

const wallet = new ethers.Wallet(PK);
console.error("payer:", wallet.address);

const challenge = await (await fetch(RESOURCE, { headers: { accept: "application/json" } })).json();
if (!challenge.accepts) { console.log(JSON.stringify({ note: "no 402 (free/already paid)", challenge }, null, 2)); process.exit(0); }

const accept = pickAccept(challenge);
console.error("paying:", Number(accept.amount || accept.maxAmountRequired) / 1e6, "USDC ->", accept.payTo);

const envelope = await buildEnvelope(accept, wallet);
// Header value = base64url(JSON.stringify(envelope)). Server base64url-decodes then JSON.parses.
const header = b64u(JSON.stringify(envelope));

const res = await fetch(RESOURCE, { headers: { accept: "application/json", "Payment-Signature": header } });
const text = await res.text();
let body; try { body = JSON.parse(text); } catch { body = text; }
console.log("HTTP", res.status);
console.log(JSON.stringify(body, null, 2));
