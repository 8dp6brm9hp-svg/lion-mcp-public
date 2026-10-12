// LION x402 keyless reference client (EIP-3009 / EIP-712 -> Payment-Signature)
//
// Pays an HTTP 402 LION route in USDC on Base with any funded wallet.
// No API key, no account: the signed transfer authorization IS the payment.
//
// Usage:
//   npm install ethers
//   LION_PK=0x<base-wallet-private-key> node --max-http-header-size=131072 pay-lion.mjs \
//     "https://lionx402.com/api/x402/wallet-screen-json?address=0x0000000000000000000000000000000000000001"
//
// The private key is read from the LION_PK env var so it never appears in shell history.
// Use a dedicated low-balance wallet.
//
// x402 v2 puts the challenge in the PAYMENT-REQUIRED header. The body may be
// the same JSON, or {}. This client reads the header first, then the body.
// The signed retry is a v2 payload in a standard-base64 PAYMENT-SIGNATURE.

import crypto from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RESOURCE = process.argv[2];

export function decodePaymentRequired(header) {
  if (!header || typeof header !== "string") return null;
  const raw = header.trim();
  if (!raw) return null;
  try {
    const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (!json || !Array.isArray(json.accepts) || json.accepts.length === 0) return null;
    return json;
  } catch {
    return null;
  }
}

/** Header wins. Body is the fallback for a client that only stored the JSON. */
export function readChallenge(header, body) {
  const fromHeader = decodePaymentRequired(header);
  if (fromHeader) return fromHeader;
  if (body && typeof body === "object" && Array.isArray(body.accepts) && body.accepts.length) {
    return body;
  }
  return null;
}

export function pickAccept(challenge) {
  const accepts = challenge.accepts || [];
  return (
    accepts.find((a) => {
      const network = String(a.network || "");
      return a.scheme === "exact" && (network === "eip155:8453" || network === "base");
    }) || accepts[0]
  );
}

export function encodePaymentSignature(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/**
 * @param {object} challenge
 * @param {{ address: string, signTypedData: Function }} wallet
 * @param {{ ethers?: { getAddress: Function } }} [opts]
 */
export async function buildPaymentPayload(challenge, wallet, opts = {}) {
  const accept = pickAccept(challenge);
  if (!accept) throw new Error("402 challenge has no accepts");
  const ethers = opts.ethers || (await import("ethers"));
  const getAddress = ethers.getAddress;
  const version = challenge.x402Version === 1 ? 1 : 2;

  if (version === 1) {
    const value = String(accept.maxAmountRequired || accept.amount);
    const asset = getAddress(accept.asset);
    const to = getAddress(accept.payTo);
    const now = Math.floor(Date.now() / 1000);
    const authorization = {
      from: getAddress(wallet.address),
      to,
      value,
      validAfter: String(now - 60),
      validBefore: String(now + (accept.maxTimeoutSeconds || 600)),
      nonce: "0x" + crypto.randomBytes(32).toString("hex"),
    };
    const signature = await signAuthorization(wallet, authorization, {
      name: accept.extra?.name || "USD Coin",
      version: accept.extra?.version || "2",
      chainId: 8453,
      verifyingContract: asset,
    });
    return {
      x402Version: 1,
      scheme: accept.scheme || "exact",
      network: accept.network || "base",
      payload: { signature, authorization },
    };
  }

  if (!accept.extra?.name || !accept.extra?.version) {
    throw new Error("402 accept is missing EIP-712 extra.name and extra.version");
  }
  const asset = getAddress(accept.asset);
  const to = getAddress(accept.payTo);
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: getAddress(wallet.address),
    to,
    value: String(accept.amount),
    validAfter: "0",
    validBefore: String(now + Number(accept.maxTimeoutSeconds || 60)),
    nonce: "0x" + crypto.randomBytes(32).toString("hex"),
  };
  const signature = await signAuthorization(wallet, authorization, {
    name: accept.extra.name,
    version: accept.extra.version,
    chainId: 8453,
    verifyingContract: asset,
  });
  return {
    x402Version: 2,
    resource: challenge.resource,
    accepted: accept,
    payload: { signature, authorization },
  };
}

async function signAuthorization(wallet, authorization, domain) {
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = {
    from: authorization.from,
    to: authorization.to,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce,
  };
  return wallet.signTypedData(domain, types, message);
}

function parseBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function main() {
  let pk = (process.env.LION_PK || "").trim();
  if (pk && !pk.startsWith("0x")) pk = "0x" + pk;
  if (!pk) {
    console.error("ERROR: set LION_PK to your funded Base wallet private key");
    process.exit(1);
  }
  if (!RESOURCE) {
    console.error("ERROR: pass the paid resource URL as argument 1");
    process.exit(1);
  }

  const { Wallet } = await import("ethers");
  const wallet = new Wallet(pk);
  console.error("payer:", wallet.address);

  const first = await fetch(RESOURCE, { headers: { accept: "application/json" } });
  const firstText = await first.text();
  const firstBody = parseBody(firstText);
  const challenge = readChallenge(first.headers.get("payment-required"), firstBody);
  if (!challenge) {
    if (first.status === 402) {
      console.error("ERROR: HTTP 402 had no payment challenge in PAYMENT-REQUIRED or the body");
      process.exit(1);
    }
    console.log(JSON.stringify({ note: "no 402 (free/already paid)", status: first.status, body: firstBody }, null, 2));
    process.exit(0);
  }

  const accept = pickAccept(challenge);
  const atomic = accept.amount || accept.maxAmountRequired;
  console.error("paying:", Number(atomic) / 1e6, "USDC ->", accept.payTo);

  const payload = await buildPaymentPayload(challenge, wallet);
  const header = encodePaymentSignature(payload);
  const res = await fetch(RESOURCE, {
    headers: { accept: "application/json", "PAYMENT-SIGNATURE": header },
  });
  const text = await res.text();
  const body = parseBody(text);
  console.log("HTTP", res.status);
  console.log(JSON.stringify(body, null, 2));
  if (res.status === 402) process.exit(1);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isDirectRun()) main();
