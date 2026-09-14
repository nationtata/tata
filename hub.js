const fs = require("fs");
const path = require("path");

const { getGroups } = require("./parse-m3u");

const map = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "tmdb-map.json"),
    "utf8"
  )
);

// Cache
const hubCache = new Map();

/* =========================================================
   Kanalın Kategorisini Bul
========================================================= */

function findGroup(channelName) {

  const groups = getGroups();

  for (const [groupName, channels] of Object.entries(groups)) {

    if (channels.some(ch => ch.name === channelName)) {
      return groupName;
    }

  }

  return "Diğer";

}

/* =========================================================
   Varsayılan Açıklama
========================================================= */

function defaultDescription(channelName, group) {

  const text = {
    "Ulusal": "Ulusal televizyon kanalı.",
    "Spor": "Canlı spor yayınları ve spor programları.",
    "Haber": "24 saat haber ve gündem yayınları.",
    "Belgesel": "Belgesel ve kültür içerikleri.",
    "Çocuk": "Çocuk programları ve çizgi filmler."
  };

  return `${channelName} • ${text[group] || "Canlı televizyon kanalı."}`;

}

/* =========================================================
   Hub Oluştur
========================================================= */

function loadHub(channelName) {

  if (hubCache.has(channelName))
    return hubCache.get(channelName);

  const cfg = map[channelName] || {};

  const hub = {

    name: channelName,

    group: findGroup(channelName),

    networkId: cfg.networkId || null,

    featuredQuery:
      cfg.featuredQuery || channelName,

    description:
      cfg.description ||
      defaultDescription(
        channelName,
        findGroup(channelName)
      )

  };

  hubCache.set(channelName, hub);

  return hub;

}

/* =========================================================
   Tüm Hub'lar
========================================================= */

function getAllHubs() {

  const groups = getGroups();

  const hubs = [];

  Object.values(groups)
    .flat()
    .forEach(ch => {

      hubs.push(loadHub(ch.name));

    });

  return hubs;

}

/* =========================================================
   Kategori Hub'ları
========================================================= */

function getHubsByGroup(groupName) {

  const groups = getGroups();

  return (groups[groupName] || [])
    .map(ch => loadHub(ch.name));

}

/* =========================================================
   Cache Temizle
========================================================= */

function clearHubCache() {

  hubCache.clear();

}

/* =========================================================
   Export
========================================================= */

module.exports = {

  loadHub,

  getAllHubs,

  getHubsByGroup,

  clearHubCache

};
