const fs = require("fs");
const path = require("path");

const map = JSON.parse(
  fs.readFileSync(path.join(__dirname, "tmdb-map.json"), "utf8")
);

const cache = new Map();

async function getNetwork(channelName) {

  const item = map[channelName];

  if (!item) return null;

  if (cache.has(channelName)) {
    return cache.get(channelName);
  }

  const apiKey = process.env.TMDB_API_KEY;

  const url =
    `https://api.themoviedb.org/3/network/${item.id}` +
    `?api_key=${apiKey}&language=tr-TR`;

  const res = await fetch(url);

  if (!res.ok) return null;

  const data = await res.json();

  cache.set(channelName, data);

  return data;
}

module.exports = { getNetwork };
