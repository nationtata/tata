const { playbackTracks } = require("../shared/playback-tracks");
const site = "https://www.anizume.com";
const headers = { Referer: site + "/", Origin: site };

async function read(url, method) {
  try {
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(2200) });
    return response.ok ? await response[method]() : null;
  } catch {
    return null;
  }
}

const key = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

async function getStreams({ details, type, season, episode }) {
  const series = type === "series";
  const kind = series ? "anime" : "film";
  const titles = [...new Set([details.englishTitle, details.name, details.original_name, details.title, details.original_title].filter(Boolean))];
  const keys = new Set(titles.map(key));
  const results = await Promise.all(titles.map(title => read(site + "/api/search?q=" + encodeURIComponent(title), "json")));
  const matches = results.flatMap(result => (series ? result?.animes : result?.films) ?? [])
    .filter(item => item && [item.title, item.subtitle].some(title => keys.has(key(title))));
  const paths = new Set();
  for (const item of matches) {
    const path = String(item.url || "").match(new RegExp("^(?:https://www\\.anizume\\.com)?(/" + kind + "/[a-z0-9-]+)/?$", "i"))?.[1];
    if (path) paths.add(path);
  }
  if (paths.size !== 1) return [];
  const [path] = paths;
  const page = site + path + (series ? "/sezon-" + season + "/bolum-" + episode : "");
  const html = await read(page, "text");
  const data = html?.match(/<script\b[^>]*\bid=["']anime-sources["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!data) return [];
  let sources;
  try { sources = JSON.parse(data); } catch { return []; }
  if (!Array.isArray(sources)) return [];
  const urls = [...new Set(sources.map(source => source?.SourceUrl)
    .filter(url => typeof url === "string" && /^https:\/\/video\.anizume\.com\/[\w./%~-]+\.m3u8(?:\?[^\s#]*)?$/i.test(url)))].slice(0, 6);
  const streams = await Promise.all(urls.map(async url => {
    const master = await read(url, "text");
    return master?.trimStart().startsWith("#EXTM3U") ? { url, headers, ...playbackTracks(master) } : null;
  }));
  return streams.filter(Boolean);
}

module.exports = { getStreams };
