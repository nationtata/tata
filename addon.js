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

  const posterFile = path.join(__dirname, "public/poster", `${name}.jpg`);
  const clearFile = path.join(__dirname, "public/clearlogos", `${name}.png`);

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
    version: "4.0.0",
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

  if (!channel) {
    return res.status(404).json({ meta: null });
  }

  const assets = assetPaths(channel.name);

  // Varsayılan meta (diğer tüm kanallar için)
  const meta = {
    id: `tv-${channel.id}`,
    type: "tv",
    name: channel.name,
    logo: absolute(req, assets.logo)
  };

  // Şimdilik sadece TRT 1'i TMDb ile zenginleştiriyoruz
  if (channel.name === "TRT 1") {
    try {
      const network = await getNetwork("TRT 1");

      if (network) {
        meta.description =
          network.headquarters ||
          "Türkiye'nin ilk ulusal televizyon kanalı.";

        meta.releaseInfo = "1968";

        meta.genres = ["Ulusal"];

        if (network.homepage) {
          meta.website = network.homepage;
        }

        // Arka planı kendi hazırladığın premium posterden alıyoruz.
        // Böylece detay sayfası siyah kalıyor ve mevcut görünüm bozulmuyor.
        meta.background = absolute(req, "/poster/TRT 1.jpg");
      }
    } catch (err) {
      console.error("TMDb error:", err);
    }
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
   HOME
========================================================= */

app.get("/", (req, res) => {
  res.redirect("/manifest.json");
});

app.listen(PORT, () => {
  console.log(`TATA running on port ${PORT}`);
});
