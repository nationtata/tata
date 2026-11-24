"use strict";

// Provider modules are intentionally not downloaded or executed from remote URLs.
// Only locally reviewed modules explicitly installed in providers/izlelan/ are loaded.
// Missing modules are skipped so existing TATA providers remain unaffected.
const path = require("path");
const fs = require("fs");
const NAMES = ["ace","clover","enel","imu","joyboy","kalgara","katakuri","noland","roger","sengoku","shiki","smoker","teach","toki","xebec","turkdizi","doflamingo","lili","sabo","law","kuma","beckman"];

function getLocalIzlelanJobs() {
  const jobs = [];
  for (const name of NAMES) {
    const filename = path.join(__dirname, "izlelan", name + ".js");
    if (!fs.existsSync(filename)) continue;
    try {
      const provider = require(filename);
      const getStreams = typeof provider === "function"
        ? provider
        : provider.getStreams || provider.default?.getStreams;
      if (typeof getStreams !== "function") {
        console.warn("[TATA IZLELAN]", name, "missing-getStreams");
        continue;
      }
      jobs.push({ name: name[0].toUpperCase() + name.slice(1), getStreams });
    } catch (error) {
      console.warn("[TATA IZLELAN]", name, "load-failed", error.name);
    }
  }
  return jobs;
}

module.exports = { getLocalIzlelanJobs, IZLELAN_NAMES: NAMES.map(name => name[0].toUpperCase() + name.slice(1)) };
