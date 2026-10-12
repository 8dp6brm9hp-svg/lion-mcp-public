#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildPaymentPayload,
  decodePaymentRequired,
  encodePaymentSignature,
  pickAccept,
  readChallenge,
} from "./pay-lion.mjs";

const challenge = {
  x402Version: 2,
  error: "Payment required",
  resource: {
    url: "https://lionx402.com/api/x402/wallet-screen-json?address=0x1",
    description: "screen",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x68e3E7822cf83C824cF9606EC999b5e8a93c85B5",
      maxTimeoutSeconds: 60,
      extra: { name: "USD Coin", version: "2" },
    },
  ],
};
const header = Buffer.from(JSON.stringify(challenge)).toString("base64");

const fromHeader = readChallenge(header, {});
assert.equal(fromHeader.x402Version, 2);
assert.equal(fromHeader.accepts[0].amount, "1000");

const fromBody = readChallenge(null, challenge);
assert.equal(fromBody.accepts[0].payTo, challenge.accepts[0].payTo);

assert.equal(readChallenge(null, {}), null);
assert.equal(decodePaymentRequired("not-base64!!!"), null);
assert.equal(pickAccept(challenge).network, "eip155:8453");

const signed = [];
const wallet = {
  address: "0x0000000000000000000000000000000000000001",
  signTypedData: async (domain, _types, message) => {
    signed.push({ domain, message });
    return "0x" + "11".repeat(65);
  },
};
const payload = await buildPaymentPayload(challenge, wallet, {
  ethers: { getAddress: (a) => a },
});
assert.equal(payload.x402Version, 2);
assert.equal(payload.accepted, challenge.accepts[0]);
assert.equal(payload.resource, challenge.resource);
assert.equal(payload.payload.authorization.validAfter, "0");
assert.equal(payload.payload.authorization.value, "1000");
assert.equal(signed[0].message.validAfter, 0n);
assert.equal(signed[0].domain.name, "USD Coin");
assert.equal("extensions" in payload, false);

const encoded = encodePaymentSignature(payload);
assert.match(encoded, /^[A-Za-z0-9+/]*={0,2}$/);
assert.equal(encoded.includes("-") || encoded.includes("_"), false);
const round = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
assert.equal(round.accepted.amount, "1000");

console.log("pay-lion tests ok");
