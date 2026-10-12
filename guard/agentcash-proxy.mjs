#!/usr/bin/env node
// Sits in front of AgentCash. AgentCash 0.17.1 has no pre-pay hook: its
// beforePayment only checks the balance and the max amount. This process is
// the install. A fetch tools/call is probed without paying. A 402 is screened
// by paying LION through a raw `agentcash fetch` (not through this proxy).
// PASS or GO forwards the original call. Anything else is returned as a tool
// error and the target is not paid.
//
// Stdout is MCP JSON-RPC only. Logs go to stderr.

import { spawn } from "node:child_process";
import { LionGuardBlockedError, withLionGuard } from "./index.mjs";

const LION = "https://lionx402.com";
const GUARDED_TOOLS = new Set(["fetch", "fetch_with_auth"]);

export async function guardMcpFetch(message, deps) {
  if (!message || message.method !== "tools/call") return { forward: true };
  const name = message.params && message.params.name;
  if (!GUARDED_TOOLS.has(name)) return { forward: true };
  const args = (message.params && message.params.arguments) || {};
  if (!args.url) return { forward: true };

  const headers = { accept: "application/json", ...(args.headers || {}) };
  const init = { method: args.method || "GET", headers };
  if (args.body != null && init.method !== "GET" && init.method !== "HEAD") {
    init.body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
    const hasType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
    if (!hasType) headers["content-type"] = "application/json";
  }

  const payFetch = async (url) => {
    const u = String(url);
    if (u.startsWith(deps.lionBase || LION)) return deps.payLion(u);
    return { status: 200, json: async () => ({ deferred: true }) };
  };
  const guarded = withLionGuard(payFetch, {
    probeFetch: deps.probeFetch,
    memoryFile: deps.memoryFile,
    lionBaseUrl: deps.lionBase || LION,
  });

  try {
    const res = await guarded(args.url, init);
    if (!res || res.lionVerdict == null) return { forward: true };
    return { forward: true, verdict: res.lionVerdict };
  } catch (e) {
    const verdict = e instanceof LionGuardBlockedError ? e.verdict : "SCREEN_ERROR";
    const payTo = e instanceof LionGuardBlockedError ? e.payTo : null;
    const text = payTo
      ? `LION Guard blocked payment to ${payTo}: ${verdict}. The target was not paid.`
      : `LION Guard blocked the payment: ${verdict}. The target was not paid.`;
    return {
      forward: false,
      response: {
        jsonrpc: "2.0",
        id: message.id ?? null,
        result: {
          content: [{ type: "text", text }],
          isError: true,
        },
      },
    };
  }
}

function parseJsonStdout(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("agentcash fetch returned no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export function payLionWithAgentCash(url, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(
      "npx",
      ["-y", "agentcash@latest", "fetch", url, "--format", "json"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      let parsed;
      try {
        parsed = parseJsonStdout(out);
      } catch (e) {
        reject(e);
        return;
      }
      if (code !== 0 || !parsed.success) {
        reject(new Error((parsed.error && parsed.error.message) || "agentcash fetch failed"));
        return;
      }
      resolve({ status: 200, json: async () => parsed.data });
    });
  });
}

function writeLine(stream, obj) {
  return new Promise((resolve) => {
    const line = JSON.stringify(obj) + "\n";
    if (stream.write(line)) resolve();
    else stream.once("drain", resolve);
  });
}

async function main() {
  const child = spawn("npx", ["-y", "agentcash@latest", ...process.argv.slice(2)], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  let outChain = Promise.resolve();
  const writeOut = (buf) => {
    outChain = outChain.then(
      () =>
        new Promise((resolve) => {
          if (process.stdout.write(buf)) resolve();
          else process.stdout.once("drain", resolve);
        }),
    );
    return outChain;
  };

  let childBuf = "";
  child.stdout.on("data", (chunk) => {
    childBuf += chunk.toString("utf8");
    let nl;
    while ((nl = childBuf.indexOf("\n")) !== -1) {
      const line = childBuf.slice(0, nl + 1);
      childBuf = childBuf.slice(nl + 1);
      writeOut(line);
    }
  });
  child.on("exit", (code) => {
    if (childBuf) writeOut(childBuf);
    outChain.then(() => process.exit(code ?? 0));
  });

  let inBuf = "";
  const queue = [];
  let working = false;
  async function drain() {
    if (working) return;
    working = true;
    try {
      while (queue.length) {
        const line = queue.shift();
        let message = null;
        try {
          message = JSON.parse(line);
        } catch {
          message = null;
        }
        if (!message) {
          child.stdin.write(line + "\n");
          continue;
        }
        const decision = await guardMcpFetch(message, {
          probeFetch: globalThis.fetch,
          payLion: payLionWithAgentCash,
        });
        if (decision.forward) child.stdin.write(line + "\n");
        else if (decision.response) await writeLine(process.stdout, decision.response);
      }
    } finally {
      working = false;
      if (queue.length) drain();
    }
  }
  process.stdin.on("data", (chunk) => {
    inBuf += chunk.toString("utf8");
    let nl;
    while ((nl = inBuf.indexOf("\n")) !== -1) {
      queue.push(inBuf.slice(0, nl).replace(/\r$/, ""));
      inBuf = inBuf.slice(nl + 1);
    }
    drain().catch((e) => {
      process.stderr.write(`lion-guard: ${e && e.message ? e.message : e}\n`);
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith("agentcash-proxy.mjs")) {
  main().catch((e) => {
    process.stderr.write(`lion-guard: ${e && e.message ? e.message : e}\n`);
    process.exit(1);
  });
}
