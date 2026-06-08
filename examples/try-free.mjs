// LION — free first touch. Real, Ed25519-attested data in ~10 seconds.
// No wallet, no API key, no signup, no `npm install`. Node 18+ only (built-in fetch).
//
//   node try-free.mjs                # defaults to coinbase.com
//   node try-free.mjs stripe.com
//
// Calls the FREE `lion_quick_intel` tool over MCP and prints the data plus the
// attestation you can verify offline. Free responses are attested too — LION's
// integrity proof is not paywalled. When you want deeper data, see QUICKSTART.md
// and pay-lion.mjs (pay-per-call USDC on Base, no account).

const entity = process.argv[2] || "coinbase.com";
const MCP = "https://lionx402.com/api/mcp";

async function rpc(method, params) {
  const r = await fetch(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const raw = await r.text();
  // MCP may answer as plain JSON or as a single SSE `data:` frame — handle both.
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("unexpected MCP response: " + raw.slice(0, 200));
  return JSON.parse(m[0]);
}

console.log(`LION free quick-intel → ${entity}\n`);

const res = await rpc("tools/call", { name: "lion_quick_intel", arguments: { entity } });
const block = res?.result?.content?.[0]?.text;
if (!block) {
  console.error("No content returned:", JSON.stringify(res).slice(0, 300));
  process.exit(1);
}
const obj = JSON.parse(block);

console.log("data:");
console.log(JSON.stringify(obj.data, null, 2));
console.log(`\nsource: ${obj.source}  |  confidence: ${obj.confidence}  |  as_of: ${obj.as_of}  |  free_tier: ${obj.free_tier}`);

const att = obj.attestation || {};
console.log("\nattestation — verify OFFLINE that this exact response is untampered:");
console.log(`  alg:        ${att.alg}`);
console.log(`  signer:     ${att.signer}`);
console.log(`  payload_sha256: ${att.payload_sha256}`);
console.log(`  signature:  ${(att.signature || "").slice(0, 28)}…`);

console.log("\nNext steps:");
console.log("  • `lion_declare_need` tells you the exact paid call for deeper data.");
console.log("  • Paid calls cost ~$0.002–$0.01 in USDC on Base — see QUICKSTART.md / pay-lion.mjs.");
console.log("  • No-code: drop this into Claude Desktop / Cursor →");
console.log('      { "mcpServers": { "lionx402": { "url": "https://lionx402.com/api/mcp" } } }');
