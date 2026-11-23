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
console.log("İzlelan adapter smoke test passed; installed modules:", providers.map(p => p.name).join(", ") || "none");
