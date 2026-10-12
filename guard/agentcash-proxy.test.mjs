#!/usr/bin/env node
// Offline. The LION payment is a fake function. No USDC, no AgentCash process.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardMcpFetch, payLionWithAgentCash } from "./agentcash-proxy.mjs";

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log("  PASS:", msg); }
  else { fail++; console.log("  FAIL:", msg); }
}

const payTo = "0x" + "ab".repeat(20);
const header = Buffer.from(JSON.stringify({ accepts: [{ payTo }] })).toString("base64url");

function call(url) {
  return {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "fetch", arguments: { url } },
  };
}

function probe402() {
  return {
    status: 402,
    headers: { get: (n) => (String(n).toLowerCase() === "payment-required" ? header : null) },
    clone() { return this; },
    json: async () => ({}),
  };
}

const dir = mkdtempSync(join(tmpdir(), "lion-proxy-"));
const memoryFile = join(dir, "screened-payto.json");
const lionCalls = [];

const deps = {
  memoryFile,
  lionBase: "https://lionx402.com",
  probeFetch: async () => probe402(),
  payLion: async (url) => {
    lionCalls.push(url);
    if (url.includes("counterparty-recheck-json")) {
      return { status: 200, json: async () => ({ action: "GO" }) };
    }
    return { status: 200, json: async () => ({ verdict: "PASS" }) };
  },
};

const first = await guardMcpFetch(call("https://merchant.example/paid"), deps);
ok(first.forward === true && first.verdict === "PASS", "PASS forwards the original fetch");
ok(lionCalls[0].includes("wallet-screen-json") && lionCalls[0].includes(payTo), "first call pays the $0.001 screen");

const second = await guardMcpFetch(call("https://merchant.example/paid"), deps);
ok(second.forward === true && second.verdict === "GO", "remembered address forwards on GO");
ok(lionCalls[1].includes("counterparty-recheck-json"), "second call pays the $0.01 recheck");

deps.payLion = async (url) => {
  lionCalls.push(url);
  return { status: 200, json: async () => ({ verdict: "BLOCK" }) };
};
const blocked = await guardMcpFetch(call("https://other.example/paid"), {
  ...deps,
  probeFetch: async () => {
    const other = "0x" + "cd".repeat(20);
    const h = Buffer.from(JSON.stringify({ accepts: [{ payTo: other }] })).toString("base64url");
    return {
      status: 402,
      headers: { get: (n) => (String(n).toLowerCase() === "payment-required" ? h : null) },
      clone() { return this; },
      json: async () => ({}),
    };
  },
});
ok(blocked.forward === false && blocked.response.result.isError === true, "BLOCK does not forward");
ok(String(blocked.response.result.content[0].text).includes("BLOCK"), "block text names the verdict");

const listed = await guardMcpFetch({ jsonrpc: "2.0", id: 1, method: "tools/list" }, deps);
ok(listed.forward === true, "tools/list is not screened");

const free = await guardMcpFetch(call("https://free.example/x"), {
  ...deps,
  probeFetch: async () => ({ status: 200, headers: { get: () => null }, clone() { return this; }, json: async () => ({}) }),
});
ok(free.forward === true && free.verdict == null, "a non-402 is forwarded with no LION call");

let spawned = null;
const fakeSpawn = () => {
  const stdout = { on(ev, fn) { if (ev === "data") queueMicrotask(() => fn(Buffer.from('{"success":true,"data":{"verdict":"PASS"}}\n'))); } };
  const stderr = { on() {} };
  return {
    stdout,
    stderr,
    on(ev, fn) {
      if (ev === "close") queueMicrotask(() => fn(0));
    },
  };
};
const paid = await payLionWithAgentCash("https://lionx402.com/api/x402/wallet-screen-json?address=" + payTo, (cmd, args) => {
  spawned = { cmd, args };
  return fakeSpawn();
});
ok(spawned.cmd === "npx" && spawned.args.includes("fetch") && spawned.args.includes("--format"), "LION payment uses raw agentcash fetch");
ok((await paid.json()).verdict === "PASS", "a successful agentcash body is the LION receipt");

rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
