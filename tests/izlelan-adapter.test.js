"use strict";
const assert = require("node:assert/strict");
const { getLocalIzlelanJobs, IZLELAN_NAMES } = require("../providers/izlelan-adapter");
const providers = getLocalIzlelanJobs();
assert.equal(IZLELAN_NAMES.length, 27);
assert.equal(new Set(IZLELAN_NAMES).size, 27);
assert.equal(new Set(providers.map(x => x.name)).size, providers.length);
for (const p of providers) {
  assert.ok(IZLELAN_NAMES.includes(p.name));
  assert.equal(typeof p.getStreams, "function");
}
const missing = IZLELAN_NAMES.filter(name => !providers.some(p => p.name === name));
if (process.env.REQUIRE_IZLELAN_PROVIDERS === "1") {
  assert.deepEqual(missing, [], "Missing provider modules: " + missing.join(", "));
}
console.log("Installed providers:", providers.length, "/", IZLELAN_NAMES.length);
console.log("Missing:", missing.join(", ") || "none");
