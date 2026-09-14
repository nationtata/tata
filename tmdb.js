const cache = new Map();

const SEARCH_CACHE_TIME = 1000 * 60 * 60 * 12; // 12 saat

async function tmdb(url) {
  const key = process.env.TMDB_API_KEY;

  if (!key) return null;

  const response = await fetch(
    `https://api.themoviedb.org/3${url}${url.includes("?") ? "&" : "?"}api_key=${key}`
  );

  if (!response.ok) return null;

  return response.json();
}

function normalize(name = "") {
  return name
    .toLowerCase()
    .replace(/[ç]/g, "c")
    .replace(/[ğ]/g, "g")
    .replace(/[ıi]/g, "i")
    .replace(/[ö]/g, "o")
    .replace(/[ş]/g, "s")
    .replace(/[ü]/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

async function searchNetwork(channelName) {

  const key = normalize(channelName);

  const cached = cache.get(key);

  if (cached && Date.now() - cached.time < SEARCH_CACHE_TIME) {
    return cached.data;
  }

  const data = await tmdb("/network?language=tr-TR");

  if (!data?.results) return null;

  const match =
    data.results.find(n => normalize(n.name) === key) ||
    data.results.find(n => normalize(n.name).includes(key)) ||
    data.results.find(n => key.includes(normalize(n.name)));

  cache.set(key, {
    time: Date.now(),
    data: match || null
  });

  return match || null;
}

async function getNetwork(channelName) {

  const network = await searchNetwork(channelName);

  if (!network) return null;

  const detail = await tmdb(`/network/${network.id}?language=tr-TR`);

  if (!detail) return null;

  return {
    id: detail.id,
    name: detail.name,
    headquarters: detail.headquarters || "",
    homepage: detail.homepage || "",
    logo:
      detail.logo_path
        ? `https://image.tmdb.org/t/p/w500${detail.logo_path}`
        : null
  };

}

module.exports = {
  getNetwork
};
