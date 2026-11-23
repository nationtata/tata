"use strict";
const assert = require("node:assert/strict");
const { getLocalIzlelanJobs } = require("../providers/izlelan-adapter");

const providers = getLocalIzlelanJobs();
assert.ok(Array.isArray(providers));
assert.equal(new Set(providers.map(x => x.name)).size, providers.length);
for (const p of providers) {
  assert.ok(["Ace", "Clover", "Dragon"].includes(p.name));
  assert.equal(typeof p.getStreams, "function");
}
const expected = ["Ace", "Clover", "Dragon"];
const missing = expected.filter(name => !providers.some(p => p.name === name));
if (process.env.REQUIRE_IZLELAN_PROVIDERS === "1") {
  assert.deepEqual(missing, [], "Missing provider modules: " + missing.join(", "));
}
console.log("Adapter structural check passed.");
console.log("Installed:", providers.map(p => p.name).join(", ") || "none");
console.log("Missing:", missing.join(", ") || "none");
