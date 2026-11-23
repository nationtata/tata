const { playbackTracks } = require("../shared/playback-tracks");
const site = "https://www.tranimeizle.live";
const headers = { Referer: site + "/" };

async function request(path, options = {}) {
  try {
    const response = await fetch(site + path, {
      ...options, headers: { ...headers, ...options.headers },
      redirect: "error", signal: AbortSignal.timeout(1600)
    });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

async function json(path, options) {
  const response = await request(path, options);
  return response?.json().catch(() => null);
}

const key = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const segment = value => typeof value === "string" && /^[\w-]+$/.test(value);

async function getStreams({ details, season, episode }) {
  const titles = [...new Set([details.englishTitle, details.name, details.original_name].filter(Boolean))];
  const keys = new Set(titles.map(key));
  const results = await Promise.all(titles.map(query => json("/api/search/catalog", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ indexName: "anime", params: { query, hitsPerPage: 12 } }] })
  })));
  const matches = results.flatMap(result => result?.results ?? []).flatMap(result => result.hits ?? []);
  const slugs = new Set(matches.filter(item => keys.has(key(item?.title?.primary)) && segment(item.slug)).map(item => item.slug));
  if (slugs.size !== 1) return [];
  const [slug] = slugs;
  const listing = await json("/api/anime/" + slug + "/episodes?limit=3000&offset=0");
  const item = listing?.items?.find(item => segment(item?.slug) &&
    Number(item.number) === episode && Number(item.slug.match(/(\d+)-sezon/)?.[1] ?? 1) === season);
  if (!item) return [];
  const info = await json("/api/episode/" + item.slug);
  const ids = [...new Set((info?.videos ?? []).map(video => video?.id).filter(segment))].slice(0, 6);
  const streams = await Promise.all(ids.map(async id => {
    const watch = await request("/api/watch/" + id);
    if (!watch) return null;
    const path = (await watch.text()).trim();
    if (!/^\/w\/[A-Za-z0-9_-]+$/.test(path)) return null;
    const cookie = watch.headers.getSetCookie().map(value => value.match(/^wid=[^;\r\n]+/)?.[0]).find(Boolean);
    if (!cookie) return null;
    const playbackHeaders = { ...headers, Cookie: cookie };
    const manifest = await request(path, { headers: playbackHeaders });
    const master = await manifest?.text();
    return master?.trimStart().startsWith("#EXTM3U")
      ? { url: site + path + "#.m3u8", headers: playbackHeaders, ...playbackTracks(master) }
      : null;
  }));
  return streams.filter(Boolean);
}

module.exports = { getStreams };
