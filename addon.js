
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { getNetwork } = require("./tmdb");
const { loadHub } = require("./hub");

const {
  getGroups,
  getChannel,
  loadM3U
} = require("./parse-m3u");

const { resolveChannel } = require("./providers/engine");

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors());

app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  if (req.path.endsWith(".json") || req.path.startsWith("/hub")) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

loadM3U();

/* ========================================================= */

function absolute(req, url) {
  return `${req.protocol}://${req.get("host")}${url}`;
}

function assetPaths(name) {

  const encoded = encodeURIComponent(name);

  const posterFile = path.join(
    __dirname,
    "public",
    "poster",
    `${name}.jpg`
  );

  const clearFile = path.join(
    __dirname,
    "public",
    "clearlogos",
    `${name}.png`
  );

  return {
    poster: fs.existsSync(posterFile)
      ? `/poster/${encoded}.jpg`
      : `/logos/${encoded}.png`,

    logo: fs.existsSync(clearFile)
      ? `/clearlogos/${encoded}.png`
      : `/logos/${encoded}.png`
  };

}

/* =========================================================
   MANIFEST
========================================================= */

app.get("/manifest.json", (req, res) => {

  res.json({

    id: "tata.live",
    version: "7.0.0",
    name: "TATA",
    description: "Premium Live TV",

    resources: ["catalog", "meta", "stream"],

    // TV + Movie birlikte çalışacak
    types: ["tv", "movie"],

    idPrefixes: ["tv-", "hub-"],

    catalogs: [

      // Mevcut TV katalogları
      { type: "tv", id: "ulusal", name: "Ulusal" },
      { type: "tv", id: "spor", name: "Spor" },
      { type: "tv", id: "haber", name: "Haber" },
      { type: "tv", id: "belgesel", name: "Belgesel" },
      { type: "tv", id: "cocuk", name: "Çocuk" },

      // Deneme kataloğu
      {
        type: "movie",
        id: "channel-hubs",
        name: "Kanal Hub (Beta)"
      }

    ]

  });

});

/* =========================================================
   META
========================================================= */

app.get("/meta/tv/:id.json", (req, res) => {

  const id = req.params.id.replace(/^tv-/, "");

  const channel = getChannel(id);

  if (!channel)
    return res.status(404).json({ meta: null });

  const assets = assetPaths(channel.name);

  res.json({

    meta: {

      id: `tv-${channel.id}`,

      type: "tv",

      name: channel.name,

      logo: absolute(req, assets.logo)

    }

  });

});

/* =========================================================
   STREAM
========================================================= */

app.get("/stream/tv/:id.json", async (req, res) => {

  const id = req.params.id.replace(/^tv-/, "");

  const channel = getChannel(id);

  if (!channel)
    return res.json({ streams: [] });

  try {

    const result = await resolveChannel(id);

    if (!result || !result.stream)
      return res.json({ streams: [] });

    res.json({

      streams: [

        {

          ...result.stream,

          title: `${channel.name} • ${result.source}`

        }

      ]

    });

  } catch (err) {

    console.error(err);

    res.json({ streams: [] });

  }

});

/* =========================================================
   TMDb
========================================================= */

async function getTMDbShows(networkId, sortBy) {

  try {

    const apiKey = process.env.TMDB_API_KEY;

    const url =
      `https://api.themoviedb.org/3/discover/tv`
      + `?api_key=${apiKey}`
      + `&language=tr-TR`
      + `&with_networks=${networkId}`
      + `&sort_by=${sortBy}`
      + `&include_adult=false`
      + `&page=1`;

    const response = await fetch(url);

    if (!response.ok)
      return [];

    const data = await response.json();

    return (data.results || []).slice(0, 12).map(item => ({

      id: item.id,

      name: item.name,

      overview: item.overview,

      firstAirDate: item.first_air_date,

      poster: item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : null,

      backdrop: item.backdrop_path
        ? `https://image.tmdb.org/t/p/original${item.backdrop_path}`
        : null

    }));

  } catch (err) {

    console.error(err);

    return [];

  }

}

/* =========================================================
   HUB
========================================================= */

app.get("/hub/:channel.json", async (req, res) => {

  const channelName = decodeURIComponent(req.params.channel);

  const hub = loadHub(channelName);

  if (!hub)
    return res.status(404).json({ hub: null });

  const network = await getNetwork(channelName);

  const popular = await getTMDbShows(
    hub.networkId,
    "popularity.desc"
  );

  const newest = await getTMDbShows(
    hub.networkId,
    "first_air_date.desc"
  );

  const assets = assetPaths(channelName);

  res.json({

    hub: {

      name: hub.name,

      group: hub.group,

      networkId: hub.networkId,

      logo: absolute(req, assets.logo),

      poster: absolute(req, assets.poster),

      backdrop:
        popular[0]?.backdrop ||
        absolute(req, assets.poster),

      description:
        network?.headquarters ||
        `${channelName} televizyon kanalı`,

      website: network?.homepage || "",

      popular,

      newest

    }

  });

});

/* =========================================================
   HUB ROUTES
========================================================= */

// Önce sabit route'lar

app.get("/hub/status.json", (req, res) => {

  res.json({
    status: "ok",
    version: "6.1.0",
    tmdb: !!process.env.TMDB_API_KEY,
    time: Date.now()
  });

});

app.get("/hub/list.json", (req, res) => {

  const groups = getGroups();

  const channels = Object.values(groups)
    .flat()
    .map(ch => ({
      name: ch.name,
      id: ch.id,
      group: ch.group,
      hub: absolute(
        req,
        `/hub/${encodeURIComponent(ch.name)}.json`
      )
    }));

  res.json({ channels });

});

app.get("/hub/page/:channel", (req, res) => {

  const channel = encodeURIComponent(req.params.channel);

  res.redirect(`/hub/index.html?channel=${channel}`);

});

app.get("/hub/:channel/featured.json", async (req, res) => {

  const channelName = decodeURIComponent(req.params.channel);

  const hub = loadHub(channelName);

  if (!hub)
    return res.status(404).json({ featured: [] });

  const popular = await getTMDbShows(
    hub.networkId,
    "popularity.desc"
  );

  const newest = await getTMDbShows(
    hub.networkId,
    "first_air_date.desc"
  );

  res.json({
    channel: channelName,
    featured: {
      popular,
      newest
    }
  });

});

// En sona parametreli route geliyor

app.get("/hub/:channel.json", async (req, res) => {

  const channelName = decodeURIComponent(req.params.channel);

  const hub = loadHub(channelName);

  if (!hub)
    return res.status(404).json({ hub: null });

  const network = await getNetwork(channelName);

  const popular = await getTMDbShows(
    hub.networkId,
    "popularity.desc"
  );

  const newest = await getTMDbShows(
    hub.networkId,
    "first_air_date.desc"
  );

  const assets = assetPaths(channelName);

  res.json({
    hub: {
      name: hub.name,
      group: hub.group,
      networkId: hub.networkId,
      logo: absolute(req, assets.logo),
      poster: absolute(req, assets.poster),
      backdrop:
        popular[0]?.backdrop ||
        absolute(req, assets.poster),
      description:
        network?.headquarters ||
        `${channelName} televizyon kanalı`,
      website: network?.homepage || "",
      popular,
      newest
    }
  });

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

    if (!response.ok)
      return res.sendStatus(404);

    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "image/jpeg"
    );

    const buffer = Buffer.from(
      await response.arrayBuffer()
    );

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

    version: "6.1.0",

    port: PORT,

    tmdb: !!process.env.TMDB_API_KEY,

    uptime: Math.floor(process.uptime())

  });

});

/* ========================================================= */

app.get("/", (req, res) => {

  res.redirect("/manifest.json");

});

app.listen(PORT, () => {

  console.log("");
  console.log("================================");
  console.log("      TATA Premium Live TV");
  console.log("================================");
  console.log(`Port       : ${PORT}`);
  console.log(`TMDb       : ${process.env.TMDB_API_KEY ? "Connected" : "Missing API Key"}`);
  console.log("Hub API    : Enabled");
  console.log("Providers  : Engine Active");
  console.log("================================");
  console.log("");

});
