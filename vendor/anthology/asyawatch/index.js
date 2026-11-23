// AsyaWatch site schema documented by nikyokki's GPL-3.0 CloudStream provider.
const SITE = "https://asyawatch.com";
const HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Accept: "application/json, text/html, */*",
  "X-Requested-With": "XMLHttpRequest",
  Referer: SITE + "/"
};

function onSite(path) {
  if (typeof path !== "string" || !path) return null;
  try {
    const url = new URL(path, SITE);
    return url.origin === SITE && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

async function read(url, format, method = "GET") {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      method, headers: HEADERS, redirect: "error", signal: AbortSignal.timeout(3200)
    });
    return response.ok ? await response[format]() : null;
  } catch {
    return null;
  }
}

function decode(data) {
  if (typeof data !== "string") return data;
  try { return JSON.parse(Buffer.from(data, "base64").toString("utf8")); }
  catch { return null; }
}

function pageData(html) {
  try {
    const script = html?.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
    return decode(JSON.parse(script).props?.pageProps?.secureData);
  } catch {
    return null;
  }
}

function titleKey(name) {
  return String(name ?? "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/ı/g, "i").replace(/[^\p{L}\p{N}]/gu, "");
}

async function findTitle(name) {
  const url = onSite("/api/bg/searchcontent");
  url.searchParams.set("searchterm", name);
  const result = decode((await read(url, "json", "POST"))?.response);
  return Array.isArray(result?.result) ? result.result : [];
}

function related(data) {
  return data?.RelatedResults ?? data?.relatedResults ?? {};
}

function episodePath(data, season, episode) {
  const seasons = related(data).getSerieSeasonAndEpisodes?.seasons ?? [];
  const match = seasons.find(s => Number(s.seasonNo ?? s.season_no) === season);
  const entry = match?.episodes?.find(e => Number(e.episodeNo ?? e.episode_no) === episode);
  return entry?.usedSlug ?? entry?.used_slug;
}

function sources(data, movie) {
  const r = related(data);
  if (!movie) return r.getEpisodeSources?.result ?? [];
  return (r.getMoviePartsById?.result ?? []).flatMap(part =>
    r["getMoviePartSourcesById_" + part.id]?.result ?? []
  );
}

function mediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        !/\.(?:m3u8|mp4|webm)$/i.test(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function resolveSource(source) {
  const value = source.source_content ?? source.sourceContent ?? "";
  if (typeof value !== "string") return null;
  const raw = (value.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? value).replace(/&amp;/g, "&");
  const title = "AsyaWatch · " + (source.quality_name ?? source.qualityName ?? "Türkçe");
  const direct = mediaUrl(raw);
  if (direct) return { url: direct, title, headers: { Referer: SITE + "/" } };

  let embed;
  try { embed = new URL(raw, SITE); } catch { return null; }
  if (embed.protocol !== "https:" || embed.username || embed.password || embed.port) return null;
  if (embed.hostname === "ok.ru" && /^\/videoembed\/\d+$/.test(embed.pathname)) {
    const html = await read(embed, "text");
    try {
      const options = html?.match(/\bdata-options="([^"]+)"/)?.[1];
      if (!options) return null;
      let meta = JSON.parse(options.replace(/&quot;/g, '"').replace(/&amp;/g, "&")).flashvars?.metadata;
      if (typeof meta === "string") meta = JSON.parse(meta);
      const hls = new URL(meta?.hlsManifestUrl);
      if (hls.protocol === "https:" && hls.hostname.endsWith(".okcdn.ru")) return { url: hls.href, title };
    } catch { return null; }
  }
  if (/^(?:www\.)?vidmoly\.(?:net|to|me|biz|sx)$/.test(embed.hostname)) {
    const html = (await read(embed, "text"))?.replace(/\\\//g, "/") ?? "";
    const url = mediaUrl(html.match(/https:\/\/[^"' <>\r\n\\]+\.m3u8(?:\?[^"' <>\r\n\\]+)?/i)?.[0]);
    if (url) return { url, title, headers: { Referer: embed.origin + "/" } };
  }
  return null;
}

async function getStreams(id, mediaType, season, episode) {
  const movie = mediaType === "movie";
  const key = process.env.TMDB_API_KEY;
  if (!key || !/^\d+$/.test(id)) return [];

  const api = new URL("https://api.themoviedb.org/3/" + (movie ? "movie/" : "tv/") + id);
  api.searchParams.set("api_key", key);
  api.searchParams.set("append_to_response", "translations");
  const info = await read(api, "json");
  if (!info?.id) return [];
  const translations = info.translations?.translations ?? [];
  const titles = [...new Set([
    info.title ?? info.name, info.original_title ?? info.original_name,
    ...translations.filter(t => t.iso_639_1 === "tr" || t.iso_639_1 === "en")
      .map(t => t.data?.title ?? t.data?.name)
  ].filter(Boolean))].slice(0, 5);
  const keys = new Set(titles.map(titleKey));
  const results = (await Promise.all(titles.map(findTitle))).flat();
  const paths = [...new Set(results.filter(item => keys.has(titleKey(item.title)))
    .map(item => onSite(item.slug)?.pathname)
    .filter(path => path?.startsWith(movie ? "/film/" : "/dizi/")))].slice(0, 4);

  const pages = await Promise.all(paths.map(path => read(onSite(path), "text")));
  const candidates = pages.map(pageData).filter(Boolean);
  const year = (info.release_date ?? info.first_air_date)?.slice(0, 4);
  const match = candidates.find(data => {
    const item = data.ContentItem ?? data.contentItem;
    if (!item) return false;
    const siteYear = item.releaseYear ?? item.release_year;
    return (!year || (siteYear ? String(siteYear) === year : candidates.length === 1)) &&
      [item.originalTitle, item.original_title, item.cultureTitle, item.culture_title]
        .some(title => keys.has(titleKey(title)));
  });
  if (!match) return [];

  const episodeData = movie ? match : pageData(await read(onSite(episodePath(match, season, episode)), "text"));
  return (await Promise.all(sources(episodeData, movie).slice(0, 8).map(resolveSource))).filter(Boolean);
}

module.exports = { getStreams };
