const SITE = "https://izlefilm.net";
const TIMEOUT = 4500;

function unescapeHtml(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|quot|amp|apos|lt|gt);/gi, (entity, token) => {
    const names = { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">" };
    const key = token.toLowerCase();
    if (key in names) return names[key];
    const point = key.startsWith("#x") ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

function normalize(value = "") {
  return value.toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFKD")
    .replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

async function request(url, read) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "error"
    });
    return response.ok ? await response[read]() : null;
  } catch {
    return null;
  }
}

async function movieDetails(id) {
  const key = process.env.TMDB_API_KEY;
  const match = /^(?:tmdb:([1-9]\d*)|(tt\d+))$/.exec(id);
  if (!key || !match) return null;

  const api = "https://api.themoviedb.org/3";
  const query = new URLSearchParams({ api_key: key, language: "tr-TR" });
  if (match[1]) return request(api + "/movie/" + match[1] + "?" + query, "json");

  query.set("external_source", "imdb_id");
  const result = await request(api + "/find/" + match[2] + "?" + query, "json");
  return result?.movie_results?.[0] ?? null;
}

function matchesMovie(html, movie, names) {
  const year = movie.release_date?.slice(0, 4);
  for (const [, data] of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const doc = JSON.parse(data);
      for (const item of doc["@graph"] ?? [doc]) {
        if (item["@type"] !== "Movie") continue;
        if (![item.name, item.alternateName].some(name => typeof name === "string" && names.has(normalize(name)))) continue;
        const posterMatches = typeof item.image === "string" && movie.poster_path && item.image.endsWith(movie.poster_path);
        const pageYear = html.match(/<h1\b[^>]*>[^<]*<span>\((\d{4})\)<\/span>/i)?.[1];
        if (posterMatches || (year && year === pageYear)) return true;
      }
    } catch {
      // Ignore malformed structured data blocks.
    }
  }
  return false;
}

async function readPlayer(url, title) {
  if (!/^https:\/\/ok\.ru\/videoembed\/\d+(?:\?[^#]*)?$/.test(url)) return null;
  const html = await request(url, "text");
  const data = html?.match(/\bdata-options="([^"]+)"/)?.[1];
  if (!data) return null;

  try {
    let metadata = JSON.parse(unescapeHtml(data)).flashvars?.metadata;
    if (typeof metadata === "string") metadata = JSON.parse(metadata);
    const stream = new URL(metadata.hlsManifestUrl);
    if (stream.protocol !== "https:" || !stream.hostname.endsWith(".okcdn.ru") || stream.username || stream.password) return null;
    return {
      name: "TATA · İzlefilm",
      title,
      url: stream.href,
      isHls: true,
      headers: { Referer: url, Origin: "https://ok.ru" }
    };
  } catch {
    return null;
  }
}

async function getMovieStreams(id) {
  const movie = typeof id === "object" ? id : await movieDetails(id);
  if (!movie) return [];
  const titles = [...new Set([movie.title, movie.original_title].filter(Boolean))];
  const names = new Set(titles.map(normalize).filter(Boolean));
  if (!names.size) return [];

  const searchPages = await Promise.all(titles.map(title =>
    request(SITE + "/arama?q=" + encodeURIComponent(title), "text")
  ));
  const paths = searchPages.flatMap(html => [...(html ?? "").matchAll(
    /href="(?:https:\/\/izlefilm\.net)?(\/film\/[a-z0-9-]+)"/gi
  )].map(([, path]) => path));
  const pages = await Promise.all([...new Set(paths)].slice(0, 8).map(path =>
    request(SITE + path, "text")
  ));

  const players = new Map();
  for (const page of pages) {
    if (!page || !matchesMovie(page, movie, names)) continue;
    for (const [, src, label] of page.matchAll(/data-player-url="([^"]+)"\s+data-player-title="([^"]+)"/g)) {
      players.set(unescapeHtml(src), unescapeHtml(label));
    }
  }

  const streams = await Promise.all([...players].slice(0, 12).map(([url, title]) => readPlayer(url, title)));
  return [...new Map(streams.filter(Boolean).map(stream => [stream.url, stream])).values()];
}

module.exports = { getMovieStreams };
