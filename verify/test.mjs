// Test the LION verifier against real attested fixtures, a tamper case, and (when online)
// functional equivalence with the live helper served by LION.
//   node test.mjs
import { lionVerifyAttestation, lionVerifyReceipt } from "./lion-verify.mjs";
import { readFileSync } from "node:fs";

let failures = 0;
const ok = (name, cond) => { console.log((cond ? "  PASS " : "  FAIL ") + name); if (!cond) failures++; };

const bundle = JSON.parse(readFileSync(new URL("./fixtures/sample-bundle.json", import.meta.url)));
const receipt = JSON.parse(readFileSync(new URL("./fixtures/sample-receipt.json", import.meta.url)));

// 1. a normal attested response verifies
const a = await lionVerifyAttestation(bundle);
ok("attested bundle verifies offline (ok:true)", a.ok === true);

// 2. a portable compliance receipt verifies, including its embedded source_response
const b = await lionVerifyReceipt(receipt);
ok("compliance receipt verifies (ok:true)", b.ok === true);
ok("receipt also re-verifies embedded source_response", b.source_verified === true);

// 3. tampering is detected
const tampered = JSON.parse(JSON.stringify(bundle));
tampered.__tamper = "evil";
const c = await lionVerifyAttestation(tampered);
ok("tampered body is rejected (ok:false)", c.ok === false);

// 4. functional equivalence with the LIVE served helper (drift guard; skipped offline)
try {
  const liveSrc = await fetch("https://lionx402.com/api/x402/compliance-bundle-json?verify_helper=1").then(r => r.text());
  const live = await import("data:text/javascript," + encodeURIComponent(liveSrc));
  const mine = await lionVerifyAttestation(bundle);
  const theirs = await live.lionVerifyAttestation(bundle);
  ok("matches live ?verify_helper=1 (same ok + payload hash)",
    mine.ok && theirs.ok && mine.payload_sha256 === theirs.payload_sha256);
} catch (e) {
  console.log("  SKIP live drift-check (offline): " + (e && e.message));
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
