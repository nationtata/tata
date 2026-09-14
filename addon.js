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

const { resolveChannel } = require("./providers/engine");
const { getAlternatives } = require("./providers/tata");

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

function absolute(req, url) {
  return `${req.protocol}://${req.get("host")}${url}`;
}

function assetPaths(name) {
  const encoded = encodeURIComponent(name);

  const posterFile = path.join(__dirname, "public", "poster", `${name}.jpg`);
  const clearFile = path.join(__dirname, "public", "clearlogos", `${name}.png`);

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
    types: ["tv"],
    idPrefixes: ["tv-"],

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

    const assets = assetPaths(channel.name);

    return {
      id: `tv-${channel.id}`,
      type: "tv",
      name: channel.name,
      poster: absolute(req, assets.poster),
      logo: absolute(req, assets.logo),
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

  const assets = assetPaths(channel.name);

  const meta = {
    id: `tv-${channel.id}`,
    type: "tv",
    name: channel.name,
    logo: absolute(req, assets.logo),
    poster: "",
    background: "",
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

  }

  catch (err) {

    console.error("TMDb:", err.message);

  }

  res.json({ meta });

});

/* =========================================================
   STREAM (Multi-Stream)
========================================================= */

app.get("/stream/tv/:id.json", async (req, res) => {

  const id = req.params.id.replace(/^tv-/, "");

  const channel = getChannel(id);

  if (!channel) {
    return res.json({ streams: [] });
  }

  try {

    // Engine ana yayını doğrulamaya devam ediyor.
    await resolveChannel(id);

    const alternatives = getAlternatives(id);

    if (!alternatives.length) {
      return res.json({ streams: [] });
    }

    const streams = alternatives.map((alt, index) => ({

      url: alt.url,

      title:
        index === 0
          ? `${channel.name} • ▶ Ana`
          : `${channel.name} • ▶ ${alt.title.replace("▶ ", "")}`

    }));

    return res.json({ streams });

  }

  catch (err) {

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

  }

  catch {

    res.sendStatus(500);

  }

});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {

  res.json({

    status: "ok",
    version: "7.0.0",
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
  console.log("      TATA Premium Live TV");
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
