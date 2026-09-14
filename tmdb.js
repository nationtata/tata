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
const featuredCache = new Map();
const popularCache = new Map();
const newestCache = new Map();

/* =========================================================
   TMDb İstek Yardımcısı
========================================================= */

async function tmdb(endpoint, params = {}) {

  if (!TMDB_API_KEY) return null;

  const url = new URL(
    `https://api.themoviedb.org/3/${endpoint}`
  );

  url.searchParams.set("api_key", TMDB_API_KEY);

  Object.entries(params).forEach(([key, value]) => {

    if (value !== undefined && value !== null)
      url.searchParams.set(key, value);

  });

  const response = await fetch(url);

  if (!response.ok) return null;

  return response.json();

}

/* =========================================================
   Network Bilgisi
========================================================= */

async function getNetwork(channelName) {

  if (networkCache.has(channelName))
    return networkCache.get(channelName);

  const cfg = map[channelName];

  if (!cfg || !cfg.networkId)
    return null;

  const network = await tmdb(
    `network/${cfg.networkId}`,
    {
      language: "tr-TR"
    }
  );

  if (!network) return null;

  networkCache.set(channelName, network);

  return network;

}

/* =========================================================
   Featured İçerik
========================================================= */

async function getFeatured(channelName) {

  if (featuredCache.has(channelName))
    return featuredCache.get(channelName);

  const cfg = map[channelName];

  if (!cfg || !cfg.featuredQuery)
    return null;

  let result = null;

  const tv = await tmdb("search/tv", {
    query: cfg.featuredQuery,
    language: "tr-TR"
  });

  if (tv?.results?.length) {

    result = tv.results[0];

  } else {

    const movie = await tmdb("search/movie", {
      query: cfg.featuredQuery,
      language: "tr-TR"
    });

    if (movie?.results?.length)
      result = movie.results[0];

  }

  featuredCache.set(channelName, result);

  return result;

}

/* =========================================================
   Popüler İçerikler
========================================================= */

async function getPopular(channelName) {

  if (popularCache.has(channelName))
    return popularCache.get(channelName);

  const cfg = map[channelName];

  if (!cfg) return [];

  let results = [];

  if (cfg.networkId) {

    const data = await tmdb("discover/tv", {
      with_networks: cfg.networkId,
      sort_by: "popularity.desc",
      language: "tr-TR",
      page: 1
    });

    results = data?.results || [];

  }

  if (!results.length && cfg.featuredQuery) {

    const data = await tmdb("search/tv", {
      query: cfg.featuredQuery,
      language: "tr-TR"
    });

    results = data?.results || [];

  }

  results = results.slice(0, 12);

  popularCache.set(channelName, results);

  return results;

}

/* =========================================================
   Yeni İçerikler
========================================================= */

async function getNewest(channelName) {

  if (newestCache.has(channelName))
    return newestCache.get(channelName);

  const cfg = map[channelName];

  if (!cfg) return [];

  let results = [];

  if (cfg.networkId) {

    const data = await tmdb("discover/tv", {
      with_networks: cfg.networkId,
      sort_by: "first_air_date.desc",
      language: "tr-TR",
      page: 1
    });

    results = data?.results || [];

  }

  if (!results.length && cfg.featuredQuery) {

    const data = await tmdb("search/tv", {
      query: cfg.featuredQuery,
      language: "tr-TR"
    });

    results = data?.results || [];

  }

  results = results.slice(0, 12);

  newestCache.set(channelName, results);

  return results;

}

/* =========================================================
   Kanal Yapılandırması
========================================================= */

function getConfig(channelName) {

  return map[channelName] || null;

}

/* =========================================================
   Cache Temizleme
========================================================= */

function clearCache() {

  networkCache.clear();
  featuredCache.clear();
  popularCache.clear();
  newestCache.clear();

}

/* =========================================================
   Export
========================================================= */

module.exports = {

  getNetwork,
  getFeatured,
  getPopular,
  getNewest,
  getConfig,
  clearCache

};
