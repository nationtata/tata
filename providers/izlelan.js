"use strict";

// Remote Stremio API bridge. No third-party JavaScript is executed inside TATA.
// Only explicitly requested provider names are admitted.
const UPSTREAM = "https://izlelan.com";
const ALLOWED = /(?:^|[^a-z])(ace|clover|dragon)(?:$|[^a-z])/i;
const MAX_RESPONSE_BYTES = 2_000_000;

async function getIzlelanStreams(type, id, season, episode) {
  if (type !== "movie" && type !== "series") return [];
  const episodeSuffix = type === "series" ? `:${season}:${episode}` : "";
  const upstreamType = type === "series" ? "series" : "movie";
  const path = `/stream/${upstreamType}/${encodeURIComponent(id + episodeSuffix)}.json`;
  try {
    const response = await fetch(UPSTREAM + path, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6500)
    });
    if (!response.ok) {
      console.warn("[TATA IZLELAN]", response.status);
      return [];
    }
    if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) return [];
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data.streams)) return [];
    return data.streams.filter(stream => {
      if (!stream || typeof stream.url !== "string") return false;
      if (!/^https?:\/\//i.test(stream.url)) return false;
      const label = [stream.name, stream.title, stream.description].filter(x => typeof x === "string").join(" ");
      return ALLOWED.test(label);
    }).map(stream => ({
      ...stream,
      // Preserve upstream provider attribution for debugging.
      name: [stream.name, stream.title, stream.description].find(x => typeof x === "string" && ALLOWED.test(x)) || "İzlelan",
    }));
  } catch (error) {
    console.warn("[TATA IZLELAN]", error.name || "error");
    return [];
  }
}

module.exports = { getIzlelanStreams };
