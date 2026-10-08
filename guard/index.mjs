// @lionx402/guard — screen-before-you-pay for autonomous x402 agents.
//
// x402 verifies the payment, never who you are paying. Before USDC leaves the wallet,
// Guard reads payTo from the PAYMENT-REQUIRED header (body.accepts only if the header
// is absent), pays LION's $0.001 OFAC screen, and proceeds only on PASS.
// The same payTo again in this process pays the $0.01 recheck and proceeds only on GO.
//
// Zero mandatory dependencies. You bring a payment-capable fetch. Guard does not
// re-implement payment and does not call the $0.05 compliance bundle.

const DEFAULT_LION = "https://lionx402.com";

// Addresses already screened in this process. The next payment to one of them is a recheck.
const seenPayTo = new Map();

export class LionGuardBlockedError extends Error {
  constructor(verdict, flags, receipt, payTo) {
    super(`LION Guard BLOCKED payment to ${payTo || "unknown payTo"} — verdict=${verdict}, flags=[${(flags || []).join(", ")}]`);
    this.name = "LionGuardBlockedError";
    this.verdict = verdict;
    this.flags = flags || [];
    this.receipt = receipt || null;
    this.payTo = payTo || null;
  }
}

function headerGet(res, name) {
  const h = res && res.headers;
  if (!h) return null;
  if (typeof h.get === "function") return h.get(name);
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) {
    if (String(k).toLowerCase() === want) return v;
  }
  return null;
}

function decodePaymentRequired(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const s = value.trim();
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const json = typeof Buffer !== "undefined"
      ? Buffer.from(b64, "base64").toString("utf8")
      : decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function payToFromChallenge(challenge) {
  const acc = challenge && Array.isArray(challenge.accepts) ? challenge.accepts[0] : null;
  if (!acc || !acc.payTo) return null;
  return { payTo: String(acc.payTo), network: acc.network || null, asset: acc.asset || null };
}

async function extractCounterparty(probe) {
  const header = headerGet(probe, "payment-required");
  const fromHeader = payToFromChallenge(decodePaymentRequired(header));
  if (fromHeader) return fromHeader;
  let body = null;
  try { body = await probe.clone().json(); } catch { /* non-JSON 402 */ }
  return payToFromChallenge(body);
}

function readDecision(j, kind) {
  if (!j || typeof j !== "object") return { verdict: "UNKNOWN", flags: [], receipt: null };
  const flags = Array.isArray(j.flags) ? j.flags : [];
  const verdict = kind === "recheck" ? (j.action || "UNKNOWN") : (j.verdict || "UNKNOWN");
  return { verdict, flags, receipt: j };
}

function mayProceed(kind, verdict) {
  if (kind === "recheck") return verdict === "GO";
  return verdict === "PASS";
}

/**
 * Wrap a payment-capable fetch with LION screen-before-you-pay.
 *
 * @param {Function} payFetch  A fetch that auto-pays x402 challenges.
 * @param {Object}   [opts]
 * @param {string}   [opts.lionBaseUrl="https://lionx402.com"]
 * @param {boolean}  [opts.failClosed=true]   Block the payment unless the screen says PASS, or the recheck says GO.
 * @param {boolean}  [opts.screen=true]       Set false to bypass screening.
 * @param {Function} [opts.onReceipt]         (receipt, payTo, verdict) => void
 * @param {Function} [opts.probeFetch=fetch]  Non-paying fetch used to read the target's 402.
 * @returns {Function} guardedFetch(url, init)
 */
export function withLionGuard(payFetch, opts = {}) {
  if (typeof payFetch !== "function") throw new TypeError("withLionGuard(payFetch): payFetch must be a payment-capable fetch function");
  const lion = String(opts.lionBaseUrl || DEFAULT_LION).replace(/\/+$/, "");
  const failClosed = opts.failClosed !== false;
  const screen = opts.screen !== false;
  const probeFetch = opts.probeFetch || globalThis.fetch;

  return async function guardedFetch(url, init = {}) {
    if (!screen) return payFetch(url, init);

    const probe = await probeFetch(url, { ...init, headers: { accept: "application/json", ...(init.headers || {}) } });
    if (probe.status !== 402) return probe;

    const cp = await extractCounterparty(probe);
    if (!cp) {
      if (failClosed) throw new LionGuardBlockedError("UNKNOWN", ["no_payto_in_402"], null, null);
      return payFetch(url, init);
    }

    const key = cp.payTo.toLowerCase();
    const again = seenPayTo.has(key);
    const kind = again ? "recheck" : "screen";
    const path = again ? "/api/x402/counterparty-recheck-json" : "/api/x402/wallet-screen-json";
    const screenUrl = `${lion}${path}?address=${encodeURIComponent(cp.payTo)}`;

    let sjson = null;
    try {
      const sres = await payFetch(screenUrl, { headers: { accept: "application/json" } });
      sjson = await sres.json();
    } catch (e) {
      if (failClosed) throw new LionGuardBlockedError("SCREEN_ERROR", ["lion_screen_failed:" + (e && e.message || e)], null, cp.payTo);
      return payFetch(url, init);
    }
    seenPayTo.set(key, true);

    const { verdict, flags, receipt } = readDecision(sjson, kind);
    if (typeof opts.onReceipt === "function") { try { opts.onReceipt(receipt, cp.payTo, verdict); } catch { /* user cb */ } }

    if (mayProceed(kind, verdict)) {
      const paid = await payFetch(url, init);
      try { paid.lionReceipt = receipt; paid.lionVerdict = verdict; } catch { /* Response may be immutable */ }
      return paid;
    }
    if (failClosed) throw new LionGuardBlockedError(verdict, flags, receipt, cp.payTo);
    const paid = await payFetch(url, init);
    try { paid.lionReceipt = receipt; paid.lionVerdict = verdict; } catch { /* */ }
    return paid;
  };
}

/**
 * One-liner: build a LION-guarded payment fetch from a viem account.
 * Requires the optional peer dependency `x402-fetch`.
 */
export async function createLionGuardedFetch({ account, ...opts } = {}) {
  if (!account) throw new TypeError("createLionGuardedFetch({ account }): a viem account is required");
  let mod;
  try { mod = await import("x402-fetch"); }
  catch { throw new Error("createLionGuardedFetch requires the optional peer dependency 'x402-fetch'. `npm i x402-fetch`, or use withLionGuard(yourPayFetch)."); }
  const payFetch = mod.wrapFetchWithPayment(globalThis.fetch, account);
  return withLionGuard(payFetch, opts);
}

export default withLionGuard;
