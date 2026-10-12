// Offline tests for the guard. Mock fetch only. No network, no USDC.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withLionGuard, LionGuardBlockedError } from "./index.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  PASS:", m); } else { fail++; console.log("  FAIL:", m); } };

const resp = (status, body, headers) => ({
  status,
  headers: headers || {},
  json: async () => body,
  clone() { return this; },
});

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

let n = 0;
function addr() {
  n += 1;
  return "0x" + n.toString(16).padStart(40, "0");
}

function mocks({ probe, onPay }) {
  const calls = [];
  const probeFetch = async () => probe;
  const payFetch = async (url) => {
    const u = String(url);
    calls.push(u);
    return onPay(u);
  };
  return { calls, probeFetch, payFetch };
}

console.log("Test 1: header-only 402, PASS pays the target");
{
  const payTo = addr();
  const other = addr();
  const probe = resp(402, { accepts: [{ payTo: other }] }, {
    "payment-required": b64url({ accepts: [{ payTo }] }),
  });
  const { calls, probeFetch, payFetch } = mocks({
    probe,
    onPay: (url) => {
      if (url.includes("wallet-screen-json")) return resp(200, { verdict: "PASS", address: payTo });
      return resp(200, { ok: true });
    },
  });
  const g = withLionGuard(payFetch, { probeFetch, memoryFile: false });
  const r = await g("https://target.example/paid");
  ok(r.status === 200 && r.lionVerdict === "PASS", "target paid after PASS");
  ok(calls[0].includes("wallet-screen-json") && calls[0].includes(encodeURIComponent(payTo)), "screened the header payTo");
  ok(!calls[0].includes(other), "ignored the body payTo");
  ok(!calls.some((u) => u.includes("compliance-bundle")), "did not call the $0.05 bundle");
}

console.log("Test 2: body 402, no header, BLOCK does not pay the target");
{
  const payTo = addr();
  const probe = resp(402, { accepts: [{ payTo, network: "eip155:8453" }] });
  const { calls, probeFetch, payFetch } = mocks({
    probe,
    onPay: (url) => {
      if (url.includes("wallet-screen-json")) return resp(200, { verdict: "BLOCK", flags: ["ofac_sdn_hit"] });
      return resp(200, { ok: true });
    },
  });
  const g = withLionGuard(payFetch, { probeFetch, memoryFile: false });
  let threw = null;
  try { await g("https://target.example/paid"); } catch (e) { threw = e; }
  ok(threw instanceof LionGuardBlockedError && threw.verdict === "BLOCK", "BLOCK throws");
  ok(calls.length === 1 && calls[0].includes("wallet-screen-json"), "screened once, target not paid");
}

console.log("Test 3: second call to the same address uses the recheck; HOLD does not pay");
{
  const payTo = addr();
  const probe = resp(402, {}, { "payment-required": b64url({ accepts: [{ payTo }] }) });
  let screens = 0;
  const { calls, probeFetch, payFetch } = mocks({
    probe,
    onPay: (url) => {
      if (url.includes("wallet-screen-json")) {
        screens++;
        return resp(200, { verdict: "PASS" });
      }
      if (url.includes("counterparty-recheck-json")) {
        screens++;
        return resp(200, { action: "HOLD", verdict: "WARN" });
      }
      return resp(200, { ok: true });
    },
  });
  const g = withLionGuard(payFetch, { probeFetch, memoryFile: false });
  const first = await g("https://target.example/paid");
  ok(first.status === 200 && calls.filter((u) => u.includes("wallet-screen")).length === 1, "first call is the $0.001 screen");
  let threw = null;
  try { await g("https://target.example/paid"); } catch (e) { threw = e; }
  ok(threw instanceof LionGuardBlockedError && threw.verdict === "HOLD", "HOLD throws");
  ok(calls.some((u) => u.includes("counterparty-recheck-json") && u.includes(encodeURIComponent(payTo))), "second call is the recheck");
  ok(calls.filter((u) => u === "https://target.example/paid").length === 1, "target paid only on the PASS, not on HOLD");
  ok(screens === 2, "two LION calls");
}

console.log("Test 4: recheck GO pays the target");
{
  const payTo = addr();
  const probe = resp(402, {}, { "payment-required": b64url({ accepts: [{ payTo }] }) });
  const { calls, probeFetch, payFetch } = mocks({
    probe,
    onPay: (url) => {
      if (url.includes("wallet-screen-json")) return resp(200, { verdict: "PASS" });
      if (url.includes("counterparty-recheck-json")) return resp(200, { action: "GO", verdict: "PASS" });
      return resp(200, { ok: true });
    },
  });
  const g = withLionGuard(payFetch, { probeFetch, memoryFile: false });
  await g("https://target.example/paid");
  const second = await g("https://target.example/paid");
  ok(second.lionVerdict === "GO", "GO proceeds");
  ok(calls.filter((u) => u === "https://target.example/paid").length === 2, "target paid on PASS and on GO");
}

console.log("Test 5: non-402 skips the screen");
{
  const { calls, probeFetch, payFetch } = mocks({
    probe: resp(200, { ok: true }),
    onPay: () => resp(200, { paid: true }),
  });
  const g = withLionGuard(payFetch, { probeFetch, memoryFile: false });
  const r = await g("https://free.example/data");
  ok(r.status === 200 && calls.length === 0, "free response, no LION call");
}

console.log("Test 6: 402 with no payTo fails closed and does not pay");
{
  const { calls, probeFetch, payFetch } = mocks({
    probe: resp(402, {}),
    onPay: () => resp(200, { ok: true }),
  });
  const g = withLionGuard(payFetch, { probeFetch, memoryFile: false });
  let threw = null;
  try { await g("https://target.example/paid"); } catch (e) { threw = e; }
  ok(threw instanceof LionGuardBlockedError, "no payTo throws");
  ok(calls.length === 0, "LION not called and target not paid");
}

console.log("Test 7: screen:false is a passthrough");
{
  const payTo = addr();
  const { calls, probeFetch, payFetch } = mocks({
    probe: resp(402, { accepts: [{ payTo }] }),
    onPay: () => resp(200, { ok: true }),
  });
  const g = withLionGuard(payFetch, { probeFetch, screen: false, memoryFile: false });
  await g("https://target.example/paid");
  ok(calls.length === 1 && calls[0] === "https://target.example/paid", "payFetch called once, no screen");
}

console.log("Test 8: a second process rechecks a remembered address and screens a new one");
{
  const dir = mkdtempSync(join(tmpdir(), "lion-guard-"));
  const memoryFile = join(dir, "screened-payto.json");
  const child = join(dir, "child.mjs");
  const known = "0x" + "11".repeat(20);
  const fresh = "0x" + "22".repeat(20);
  writeFileSync(
    child,
    `import { withLionGuard } from ${JSON.stringify(new URL("./index.mjs", import.meta.url).href)};
const memoryFile = process.argv[2];
const payTo = process.argv[3];
const header = Buffer.from(JSON.stringify({ accepts: [{ payTo }] })).toString("base64url");
const probe = {
  status: 402,
  headers: { get(name) { return String(name).toLowerCase() === "payment-required" ? header : null; } },
  json: async () => ({}),
  clone() { return this; },
};
const calls = [];
const payFetch = async (url) => {
  const u = String(url);
  calls.push(u);
  if (u.includes("wallet-screen-json")) return { status: 200, json: async () => ({ verdict: "PASS" }) };
  if (u.includes("counterparty-recheck-json")) return { status: 200, json: async () => ({ action: "GO" }) };
  return { status: 200, json: async () => ({ ok: true }) };
};
const g = withLionGuard(payFetch, { probeFetch: async () => probe, memoryFile });
await g("https://target.example/paid");
const lion = calls.find((u) => u.includes("wallet-screen-json") || u.includes("counterparty-recheck-json")) || "NONE";
process.stdout.write(lion + "\\n");
`,
  );
  const run = (payTo) => {
    const r = spawnSync(process.execPath, [child, memoryFile, payTo], { encoding: "utf8" });
    ok(r.status === 0, `child exited 0 for ${payTo}`);
    return (r.stdout || "").trim();
  };
  try {
    const first = run(known);
    ok(first.includes("wallet-screen-json") && first.includes(known), "first process pays the $0.001 screen");
    ok(!first.includes("counterparty-recheck-json"), "first process is not a recheck");
    const saved = JSON.parse(readFileSync(memoryFile, "utf8"));
    ok(saved.addresses.includes(known), "address is on disk after the process exits");
    const second = run(known);
    ok(second.includes("counterparty-recheck-json") && second.includes(known), "second process pays the $0.01 recheck");
    ok(!second.includes("wallet-screen-json"), "second process does not buy another screen");
    const third = run(fresh);
    ok(third.includes("wallet-screen-json") && third.includes(fresh), "a new address is still the $0.001 screen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("Test 9: a thrown LION call is not remembered");
{
  const dir = mkdtempSync(join(tmpdir(), "lion-guard-"));
  const memoryFile = join(dir, "screened-payto.json");
  const payTo = "0x" + "33".repeat(20);
  const probe = resp(402, {}, { "payment-required": b64url({ accepts: [{ payTo }] }) });
  let attempts = 0;
  const calls = [];
  const probeFetch = async () => probe;
  const payFetch = async (url) => {
    const u = String(url);
    calls.push(u);
    attempts += 1;
    if (attempts === 1) throw new Error("payer down");
    if (u.includes("wallet-screen-json")) return resp(200, { verdict: "PASS" });
    if (u.includes("counterparty-recheck-json")) return resp(200, { action: "GO" });
    return resp(200, { ok: true });
  };
  const g = withLionGuard(payFetch, { probeFetch, memoryFile });
  let threw = null;
  try { await g("https://target.example/paid"); } catch (e) { threw = e; }
  ok(threw instanceof LionGuardBlockedError, "throw fails closed");
  let written = false;
  try { readFileSync(memoryFile); written = true; } catch { written = false; }
  ok(!written, "failed screen is not written");
  calls.length = 0;
  const second = await g("https://target.example/paid");
  ok(second.lionVerdict === "PASS", "retry after a throw still screens");
  ok(calls.some((u) => u.includes("wallet-screen-json")), "retry is the $0.001 screen");
  ok(!calls.some((u) => u.includes("counterparty-recheck-json")), "a failed screen is not a recheck");
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
