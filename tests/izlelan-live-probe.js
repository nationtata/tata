"use strict";
const { getLocalIzlelanJobs } = require("../providers/izlelan-adapter");
(async () => {
  const all = getLocalIzlelanJobs();
  if (all.length !== 27) throw new Error("Expected all 27 providers");
  const jobs = all.filter(job => ["Ace", "Clover", "Dragon"].includes(job.name));
  if (jobs.length !== 3) throw new Error("Missing baseline providers");
  const results = await Promise.all(jobs.map(async ({name,getStreams}) => {
    try {
      const streams = await Promise.race([
        Promise.resolve().then(() => getStreams("603", "movie")),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000))
      ]);
      const count = Array.isArray(streams) ? streams.length : -1;
      console.log(name + ": " + count + " streams");
      return {name,count};
    } catch (e) {
      console.log(name + ": " + (e.name || "error") + " " + (e.message || ""));
      return {name,count:-1};
    }
  }));
  console.log("PROBE_RESULTS=" + JSON.stringify(results));
  // A nonzero result is evidence of source availability; zero can be content-specific.
})().catch(e => { console.error(e); process.exitCode = 1; });
