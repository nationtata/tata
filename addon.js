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

loadM3U();

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

  res.setHeader("Cache-Control", "no-store");

  res.json({
    id: "tata.live",
    version: "6.0.0",
    name: "TATA",
    description: "Premium Live TV",

    resources: ["catalog", "meta", "stream"],
    types: ["tv"],
    idPrefixes: ["tv-"],

    catalogs: [
      { type: "tv", id: "ulusal", name: "Ulusal" },
      { type: "tv", id: "spor", name: "Spor" },
      { type: "tv", id: "haber", name: "Haber" },
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
  spor: "Spor",
  haber: "Haber",
  belgesel: "Belgesel",
  cocuk: "Çocuk"
};

app.get("/catalog/tv/:id.json", (req, res) => {

  const groups = getGroups();
  const groupName = catalogMap[req.params.id];

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

  res.setHeader("Cache-Control", "no-store");

  const id = req.params.id.replace(/^tv-/, "");

  const channel = getChannel(id);

  if (!channel)
    return res.status(404).json({ meta: null });

  const assets = assetPaths(channel.name);

  const meta = {
    id: `tv-${channel.id}`,
    type: "tv",
    name: channel.name,

    logo: absolute(req, assets.logo)
  };

  // Hub verisi varsa hazırla (ileride tüm kanallara yayılacak)
  try {

    const hub = loadHub(channel.name);

    if (hub) {

      const network = await getNetwork(channel.name);

      meta.behaviorHints = {
        defaultVideoId: `tv-${channel.id}`
      };

      meta.description =
        network?.headquarters ||
        `${channel.name} televizyon kanalı`;

      meta.releaseInfo = "Türkiye";

      meta.genres = [hub.group];

    }

  } catch (e) {

    console.error("Hub preload:", e.message);

  }

  res.json({ meta });

});

/* =========================================================
   STREAM
========================================================= */

app.get("/stream/tv/:id.json", async (req, res) => {

  const id = req.params.id.replace(/^tv-/, "");
  const channel = getChannel(id);

  if (!channel) {
    return res.json({ streams: [] });
  }

  try {

    const result = await resolveChannel(id);

    if (!result || !result.stream) {
      return res.json({ streams: [] });
    }

    return res.json({
      streams: [{
        ...result.stream,
        title: `${channel.name} • ${result.source}`
      }]
    });

  } catch (err) {

    console.error(`[STREAM ERROR] ${channel.name}:`, err.message);

    return res.json({ streams: [] });

  }

});

/* =========================================================
   TMDb HUB API
========================================================= */

async function getTMDbShows(networkId, sortBy = "popularity.desc") {

  try {

    const url =
      `https://api.themoviedb.org/3/discover/tv?language=tr-TR`
      + `&with_networks=${networkId}`
      + `&sort_by=${sortBy}`
      + `&include_adult=false`
      + `&page=1`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
        accept: "application/json"
      }
    });

    if (!response.ok) return [];

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

    console.error("TMDb Discover:", err.message);
    return [];

  }

}

/* =========================================================
   HUB ENDPOINT
========================================================= */

app.get("/hub/:channel.json", async (req, res) => {

  const channelName = decodeURIComponent(req.params.channel);

  const hub = loadHub(channelName);

  if (!hub) {
    return res.status(404).json({ hub: null });
  }

  const network = await getNetwork(channelName);

  const popular = await getTMDbShows(
    hub.networkId,
    "popularity.desc"
  );

  const newest = await getTMDbShows(
    hub.networkId,
    "first_air_date.desc"
  );

  res.json({

    hub: {

      name: hub.name,

      group: hub.group,

      networkId: hub.networkId,

      logo: absolute(
        req,
        `/clearlogos/${encodeURIComponent(channelName)}.png`
      ),

      poster: absolute(
        req,
        `/poster/${encodeURIComponent(channelName)}.jpg`
      ),

      backdrop:
        popular[0]?.backdrop ||
        absolute(
          req,
          `/poster/${encodeURIComponent(channelName)}.jpg`
        ),

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
   HUB HELPERS
========================================================= */

// Hub durum kontrolü
app.get("/hub/status.json", (req, res) => {

  res.json({
    status: "ok",
    version: "6.0.0",
    tmdb: !!process.env.TMDB_API_KEY,
    time: Date.now()
  });

});

// Hub'daki bütün kanalları listele
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

/* =========================================================
   TMDb IMAGE PROXY
========================================================= */

// TV'lerde bazı istemciler image.tmdb.org'a doğrudan isteklerde
// sorun çıkarabiliyor. Bu endpoint resmi TMDb görsellerini proxy eder.

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

  } catch (err) {

    console.error("TMDb Image:", err.message);

    res.sendStatus(500);

  }

});

/* =========================================================
   HUB PAGE ROUTES
========================================================= */

// Tarayıcıdan veya TV WebView'dan Hub sayfasını açar
app.get("/hub/page/:channel", (req, res) => {

  const channel = encodeURIComponent(req.params.channel);

  res.redirect(`/hub/index.html?channel=${channel}`);

});

// Hub için özet veri (kartlarda kullanılacak)
app.get("/hub/:channel/featured.json", async (req, res) => {

  const channelName = decodeURIComponent(req.params.channel);

  const hub = loadHub(channelName);

  if (!hub) {
    return res.status(404).json({ featured: [] });
  }

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

/* =========================================================
   HUB SEARCH (ileride 80+ kanal için kullanılacak)
========================================================= */

app.get("/hub/search/:channel", async (req, res) => {

  const channelName = decodeURIComponent(req.params.channel);

  const hub = loadHub(channelName);

  if (!hub) {
    return res.status(404).json({ results: [] });
  }

  const popular = await getTMDbShows(
    hub.networkId,
    "popularity.desc"
  );

  const newest = await getTMDbShows(
    hub.networkId,
    "first_air_date.desc"
  );

  const merged = [...popular, ...newest];

  const unique = [];

  const seen = new Set();

  for (const item of merged) {

    if (seen.has(item.id)) continue;

    seen.add(item.id);

    unique.push(item);

  }

  res.json({
    channel: channelName,
    results: unique
  });

});

/* =========================================================
   PERFORMANCE
========================================================= */

// Statik dosyalar için cache (logo ve posterler daha hızlı açılır)
app.use("/logos", express.static(path.join(__dirname, "public", "logos"), {
  maxAge: "30d",
  etag: true
}));

app.use("/clearlogos", express.static(path.join(__dirname, "public", "clearlogos"), {
  maxAge: "30d",
  etag: true
}));

app.use("/poster", express.static(path.join(__dirname, "public", "poster"), {
  maxAge: "30d",
  etag: true
}));

// JSON endpointleri cache'lenmesin
app.use((req, res, next) => {
  if (
    req.path.endsWith(".json") ||
    req.path.startsWith("/hub")
  ) {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "6.0.0",
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
