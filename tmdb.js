const fs = require("fs");
const path = require("path");

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const map = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "tmdb-map.json"),
    "utf8"
  )
);

// Cache
const networkCache = new Map();

/* =========================================================
   TMDb İstek Yardımcısı
========================================================= */

async function tmdb(endpoint, params = {}) {

  const url = new URL(
    `https://api.themoviedb.org/3/${endpoint}`
  );

  url.searchParams.set("api_key", TMDB_API_KEY);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null)
      url.searchParams.set(k, v);
  });

  const res = await fetch(url);

  if (!res.ok) return null;

  return res.json();

}

/* =========================================================
   Network Bul
========================================================= */

async function searchNetwork(networkName) {

  const data = await tmdb("search/company", {
    query: networkName,
    language: "tr-TR"
  });

  if (!data || !data.results) return null;

  const exact =
    data.results.find(
      x =>
        x.name.toLowerCase() ===
        networkName.toLowerCase()
    ) || data.results[0];

  return exact || null;

}

/* =========================================================
   Kanal -> Network
========================================================= */

async function getNetwork(channelName) {

  if (!TMDB_API_KEY) return null;

  if (networkCache.has(channelName))
    return networkCache.get(channelName);

  const cfg = map[channelName];

  if (!cfg) return null;

  const company = await searchNetwork(cfg.networkName);

  if (!company) return null;

  const network = await tmdb(`network/${company.id}`, {
    language: "tr-TR"
  });

  if (!network) return null;

  networkCache.set(channelName, network);

  return network;

}

/* =========================================================
   Featured İçerik
========================================================= */

async function getFeatured(channelName) {

  const cfg = map[channelName];

  if (!cfg) return null;

  const tv = await tmdb("search/tv", {
    query: cfg.featuredQuery,
    language: "tr-TR"
  });

  if (tv?.results?.length)
    return tv.results[0];

  const movie = await tmdb("search/movie", {
    query: cfg.featuredQuery,
    language: "tr-TR"
  });

  if (movie?.results?.length)
    return movie.results[0];

  return null;

}

/* =========================================================
   Popüler
========================================================= */

async function getPopular(channelName) {

  const network = await getNetwork(channelName);

  if (!network) return [];

  const data = await tmdb("discover/tv", {

    with_networks: network.id,

    sort_by: "popularity.desc",

    language: "tr-TR",

    page: 1

  });

  return data?.results || [];

}

/* =========================================================
   Yeni
========================================================= */

async function getNewest(channelName) {

  const network = await getNetwork(channelName);

  if (!network) return [];

  const data = await tmdb("discover/tv", {

    with_networks: network.id,

    sort_by: "first_air_date.desc",

    language: "tr-TR",

    page: 1

  });

  return data?.results || [];

}

module.exports = {

  getNetwork,

  getFeatured,

  getPopular,

  getNewest

};
