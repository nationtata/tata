const { version } = require("./package.json");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { getNetwork } = require("./tmdb");

const {
  getGroups,
  getChannel,
  loadM3U
} = require("./parse-m3u");

const { getAlternatives } = require("./providers/tata");
const { getVodStreams, getVodSubtitles } = require("./providers/vod");
const { proxyLawStream, proxyLawResourceTracks, serveSubtitle } = require("./providers/subtitle-proxy");

const app = express();
const PORT = process.env.PORT || 7000;

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  if (req.path.endsWith(".json")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

loadM3U();

/* =========================================================
   HELPERS
========================================================= */

function uniqueStreamLinks(streams) {
  const { mergeStreams } = require("./providers/stream-metadata");
  const positions = new Map();
  const result = [];
  for (const stream of streams) {
    const key = typeof stream.url === "string" && stream.url.length
      ? "url:" + stream.url
      : typeof stream.ytId === "string" && stream.ytId.length ? "youtube:" + stream.ytId : null;
    if (key !== null && positions.has(key)) {
      const index = positions.get(key);
      result[index] = mergeStreams(result[index], stream);
    } else {
      if (key !== null) positions.set(key, result.length);
      result.push(stream);
    }
  }
  return result;
}

function absolute(req, url) {
  if (url.startsWith("https://")) return url;
  return `${req.protocol}://${req.get("host")}${url}`;
}

function assetPaths(name, remoteLogo) {
  const encoded = encodeURIComponent(name);

  if (remoteLogo && /^https:\/\//.test(remoteLogo) && !fs.existsSync(path.join(__dirname, "public", "logos", name + ".png"))) {
    return { poster: remoteLogo, background: remoteLogo, logo: remoteLogo };
  }

  const posterFile = path.join(__dirname, "public", "poster", `${name}.jpg`);
  const backgroundFile = path.join(__dirname, "public", "background", `${name}.jpg`);

  return {
    poster: fs.existsSync(posterFile)
      ? `/poster/${encoded}.jpg`
      : `/logos/${encoded}.png`,

    background: fs.existsSync(backgroundFile)
      ? `/background/${encoded}.jpg`
      : (
          fs.existsSync(posterFile)
            ? `/poster/${encoded}.jpg`
            : `/logos/${encoded}.png`
        ),

    logo: `/logos/${encoded}.png`
  };
}

/* =========================================================
   MANIFEST
========================================================= */

app.get("/manifest.json", (req, res) => {

  res.json({

    id: "tata.live",
    version,
    name: "TATA",
    description: "TATA",
    logo: new URL("/tata-badge.png", process.env.RENDER_EXTERNAL_URL || absolute(req, "/")).href,

    resources: [
      { name: "catalog", types: ["tv"] },
      { name: "meta", types: ["tv"], idPrefixes: ["tv-"] },
      { name: "stream", types: ["tv", "movie", "series"], idPrefixes: ["tv-", "tmdb:", "tt"] },
      { name: "subtitles", types: ["movie", "series"], idPrefixes: ["tmdb:", "tt"] }
    ],
    types: ["tv", "movie", "series"],

    catalogs: [
      { type: "tv", id: "ulusal", name: "Ulusal" },
      { type: "tv", id: "haber", name: "Haber" },
      { type: "tv", id: "spor", name: "Spor" },
      { type: "tv", id: "belgesel", name: "Belgesel" },
      { type: "tv", id: "cocuk", name: "Çocuk" }
    ]

  });

});

/* =========================================================
   CATALOG
========================================================= */

const catalogMap = {
  ulusal: "Ulusal",
  haber: "Haber",
  spor: "Spor",
  belgesel: "Belgesel",
  cocuk: "Çocuk"
};

app.get("/catalog/tv/:id.json", (req, res) => {

  const groupName = catalogMap[req.params.id];
  const groups = getGroups();

  const metas = (groups[groupName] || []).map(channel => {

    const assets = assetPaths(channel.name, channel.logo);

    return {
      id: `tv-${channel.id}`,
      type: "tv",
      name: channel.name,
      poster: absolute(req, assets.poster),
      logo: absolute(req, assets.logo),
      background: absolute(req, assets.background),
      posterShape: "square"
    };

  });

  res.json({ metas });

});

/* =========================================================
   META
========================================================= */

app.get("/meta/tv/:id.json", async (req, res) => {

  const id = req.params.id.replace(/^tv-/, "");
  const channel = getChannel(id);

  if (!channel) {
    return res.status(404).json({ meta: null });
  }

  const assets = assetPaths(channel.name, channel.logo);

  const meta = {
    id: `tv-${channel.id}`,
    type: "tv",
    name: channel.name,
    logo: absolute(req, assets.logo),
    poster: absolute(req, assets.poster),
    background: absolute(req, assets.background),
    genres: [channel.group]
  };

  try {

    const network = await getNetwork(channel.name);

    if (network) {

      meta.description =
        network.headquarters ||
        `${channel.name} televizyon kanalı`;

      meta.website = network.homepage || "";
      meta.releaseInfo = "Türkiye";

    }

  } catch (err) {

    console.error("TMDb:", err.message);

  }

  res.json({ meta });

});

/* =========================================================
   STREAM (Multi-Stream)
========================================================= */

app.get("/film/manifest.json", (req, res) => {
  res.json({
    id: "tata.film",
    version,
    name: "TATA",
    description: "TATA",
    logo: new URL("/tata-badge.png", process.env.RENDER_EXTERNAL_URL || absolute(req, "/")).href,
    resources: ["stream", "subtitles"],
    types: ["movie", "series"],
    catalogs: []
  });
});

app.get(["/stream/:type(movie|series)/:id.json", "/film/stream/:type(movie|series)/:id.json"], async (req, res) => {
  try {
    const streams = await getVodStreams(req.params.type, req.params.id);
    for (const stream of streams.filter(item => item.name === "Law")) {
      console.info("[Law API subtitle diagnostic]", JSON.stringify({
        subtitles: (Array.isArray(stream.subtitles) ? stream.subtitles : []).map(sub => ({
          lang: String(sub?.lang || "").slice(0,40),
          hasId: sub?.id != null,
          absoluteHttp: typeof sub?.url === "string" && /^https?:\/\//i.test(sub.url),
          hasHeaders: !!sub?.headers
        }))
      }));
    }
    return res.json({ streams: streams.map(stream => {
      const result = { ...proxyLawStream(stream) };
      result.name = "🎬";
      const resolution = [result.quality, result.description, result.title]
        .map(value => String(value || "").match(/\b(?:480p|720p|1080p|4K)\b/i)?.[0])
        .find(Boolean);
      const metadata = [result.description, result.quality, result.title].filter(value => typeof value === "string").join("\n");
      const audio = metadata.match(/Ses:\s*(?:\p{Regional_Indicator}{2})(?:\s*\/\s*\p{Regional_Indicator}{2})*/u)?.[0];
      const subtitle = metadata.match(/Altyazı:\s*(?:\p{Regional_Indicator}{2})(?:\s*\/\s*\p{Regional_Indicator}{2})*/u)?.[0];
      delete result.description;
      delete result.quality;
      delete result.title;
      const quality = resolution && (resolution.toLowerCase() === "4k" ? "4K" : resolution.toLowerCase());
      const description = [[audio, subtitle].filter(Boolean).join(" • "), quality].filter(Boolean).join("\n");
      if (description) result.description = description;
      if (quality) result.quality = description;
      return result;
    }) });
  } catch (err) {
    console.error("[VOD STREAM ERROR]", err.message);
    return res.json({ streams: [] });
  }
});

// Separate Stremio subtitle resource. The existing stream response and TV routes
// remain unchanged. Subtitle entries retain their original URL and headers.
app.get(["/subtitles/:type(movie|series)/:id.json", "/film/subtitles/:type(movie|series)/:id.json", "/subtitles/:type(movie|series)/:id/:extra.json", "/film/subtitles/:type(movie|series)/:id/:extra.json"], async (req, res) => {
  try {
    const subtitles = await getVodSubtitles(req.params.type, req.params.id);
    return res.json({ subtitles: proxyLawResourceTracks(subtitles) });
  } catch (err) {
    console.error("[VOD SUBTITLES ERROR]", err.message);
    return res.json({ subtitles: [] });
  }
});

// Only opaque subtitle IDs produced by a Law stream are accepted.
app.get("/subtitle-proxy/:id.vtt", serveSubtitle);

app.get("/stream/tv/:id.json", async (req, res) => {

  const id = req.params.id.replace(/^tv-/, "");
  const channel = getChannel(id);

  if (!channel) {
    return res.json({ streams: [] });
  }

  try {

    const alternatives = getAlternatives(id);

    if (!alternatives.length) {
      return res.json({ streams: [] });
    }

    const streams = alternatives.map(alt => ({ name: alt.name, url: alt.url }));

    return res.json({ streams: uniqueStreamLinks(streams) });

  } catch (err) {

    console.error(`[STREAM ERROR] ${channel.name}:`, err.message);

    return res.json({ streams: [] });

  }

});

/* =========================================================
   TMDb IMAGE PROXY
========================================================= */

app.get("/tmdb/image/*", async (req, res) => {

  try {

    const imgPath = req.params[0];

    const response = await fetch(
      `https://image.tmdb.org/t/p/original/${imgPath}`
    );

    if (!response.ok) {
      return res.sendStatus(404);
    }

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "image/jpeg"
    );

    const buffer = Buffer.from(await response.arrayBuffer());

    res.send(buffer);

  } catch {

    res.sendStatus(500);

  }

});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {

  res.json({

    status: "ok",
    version,
    port: PORT,
    tmdb: !!process.env.TMDB_API_KEY,
    uptime: Math.floor(process.uptime())

  });

});

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {

  res.redirect("/manifest.json");

});

/* =========================================================
   START
========================================================= */

const server = app.listen(PORT, "0.0.0.0", () => {

  console.log("");
  console.log("================================");
  console.log("      TATA");
  console.log("================================");
  console.log(`Port       : ${PORT}`);
  console.log(
    `TMDb       : ${
      process.env.TMDB_API_KEY
        ? "Connected"
        : "Missing API Key"
    }`
  );
  console.log("Providers  : Multi-Source Active");
  console.log("================================");
  console.log("");

});

server.on("error", err => {

  console.error("Server listen error:", err);

});
