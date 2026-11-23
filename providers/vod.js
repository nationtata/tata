const { inspectMedia } = require("./media-tracks");
const { getFilmPlaylistStreams } = require("./film-playlist");
const { getPlaylistStreams } = require("./playlist");
const { getMovieStreams } = require("./izlefilm");
const registry = require("../vendor/anthology/providers.json");

const PROVIDER_TIMEOUT = 9000;
const MAX_ACTIVE_SEARCHES = 8;
const ongoing = new Map();

function parseRequest(type, id) {
  const match = /^(tmdb:[1-9]\d{0,9}|tt\d{5,12}|[1-9]\d{0,9})(?::(\d{1,3}):([1-9]\d{0,3}))?$/i.exec(id);
  if (!match || (type === "movie" && match[2] !== undefined) ||
      (type === "series" && match[2] === undefined)) return null;
  return { id: match[1].toLowerCase(), season: Number(match[2]), episode: Number(match[3]) };
}

async function findTmdb(type, id, language = "tr-TR", timeout = 3500) {
  const query = new URLSearchParams({ api_key: process.env.TMDB_API_KEY, language });
  const apiType = type === "series" ? "tv" : "movie";
  const isImdb = id.startsWith("tt");
  if (isImdb) query.set("external_source", "imdb_id");
  else if (type === "movie" && process.env.TATA_FILM_M3U_KEY) query.set("append_to_response", "external_ids");
  const resource = isImdb ? "find/" + id : apiType + "/" + id.replace(/^tmdb:/, "");
  const response = await fetch("https://api.themoviedb.org/3/" + resource + "?" + query, {
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) return null;
  const data = await response.json();
  return isImdb ? data[apiType + "_results"]?.[0] : data;
}

const providerKey = Symbol("provider");
const resolutionLabels = new Map([[2160, "4K"], [1080, "1080p"], [720, "720p"], [480, "480p"]]);

function isOriginalOnlyProvider(stream, provider) {
  if (/^vidmoly$/i.test(provider) || /^vidmody$/i.test(provider) ||
      /\bvidmoly\b/i.test([stream.provider, stream.name, stream.title].filter(Boolean).join(" "))) return true;
  const headers = stream.behaviorHints?.proxyHeaders?.request ?? stream.headers ?? {};
  const referrer = Object.entries(headers).find(([key]) => /^referer$/i.test(key))?.[1];
  return [stream.url, referrer].some(value => {
    try { return /^(?:[\w-]+\.)*vidmoly\.(?:net|to|me|biz|sx)$/i.test(new URL(value).hostname); }
    catch { return false; }
  });
}

function streamName(stream, provider) {
  if (isOriginalOnlyProvider(stream, provider)) return "Orijinal";
  const sourceLabel = String(stream.sourceLanguageLabel ?? "").toLocaleLowerCase("tr").replace(/ı/g, "i")
    .normalize("NFKD").replace(/\p{M}/gu, "");
  const tracks = Array.isArray(stream.audioTracks) ? stream.audioTracks.filter(Boolean) : [];
  const tags = [];
  if (/\b(?:orijinal|original)\b/.test(sourceLabel) || tracks.some(track => track.original === true)) tags.push("Orijinal");
  const isTurkish = track => /^(?:tr(?:-tr)?|tur|türkçe|turkish)$/i.test(String(track.lang ?? track.language ?? ""));
  if (/\b(?:dublaj(?:li)?|dub(?:bed)?)\b/.test(sourceLabel) || tracks.some(track => isTurkish(track) && track.dubbed === true) ||
      (!tracks.length && provider === "TATA M3U" && [stream.audio, stream.audioLabel].some(label =>
        typeof label === "string" && /^türkçe\s+dublaj$/iu.test(label.trim())))) {
    tags.push("Dublaj");
  }
  if (/\b(?:alt\s*yazi(?:li)?|subbed|subtitled)\b/.test(sourceLabel) || stream.embeddedSubtitles === true) tags.push("Altyazılı");

  return tags.join(" · ") || "Ses / altyazı bilgisi yok";
}

function streamResolution(stream) {
  const sourceLabel = String(stream.sourceVideoLabel ?? "").trim();
  const explicit = sourceLabel.match(/\b(2160|1080|720|480)\s*p\b/i);
  if (explicit) return resolutionLabels.get(Number(explicit[1]));
  if (/\b(?:4k|uhd)\b/i.test(sourceLabel)) return "4K";
  if (/\b(?:full[\s-]*hd|fhd)\b/i.test(sourceLabel)) return "1080p";
  if (/\bhd\b/i.test(sourceLabel)) return "480p";
  const heights = new Set(Array.isArray(stream.videoHeights) ? stream.videoHeights : []);
  return [...resolutionLabels].filter(([height]) => heights.has(height)).map(([, label]) => label).join(" · ");
}

function cleanStream(stream, provider) {
  if (!stream || typeof stream.url !== "string" || !/^https?:\/\//i.test(stream.url)) return null;
  const headers = stream.behaviorHints?.proxyHeaders?.request ?? stream.behaviorHints?.headers ?? stream.headers;
  const { notWebReady, bingeGroup, proxyHeaders, filename } = stream.behaviorHints ?? {};
  const format = String(stream.format ?? stream.type ?? "").toLowerCase();
  const adaptiveFilename = stream.isHls === true || /^(?:hls|m3u8)$/.test(format) || /#\.m3u8$/i.test(stream.url)
    ? "stream.m3u8"
    : /^(?:dash|mpd)$/.test(format) ? "stream.mpd" : undefined;
  const playbackFilename = filename || adaptiveFilename;
  const subtitles = Array.isArray(stream.subtitles)
    ? stream.subtitles.filter(subtitle => typeof subtitle?.url === "string" && /^https?:\/\//i.test(subtitle.url))
      .map(subtitle => ({
        ...subtitle,
        lang: [subtitle.lang, subtitle.language, subtitle.label].find(value => typeof value === "string" && value.trim()) || "und"
      }))
    : undefined;
  const description = streamResolution(stream);
  return {
    [providerKey]: provider,
    name: streamName(stream, provider),
    ...(description && { description }),
    url: stream.url,
    ...(subtitles && { subtitles }),
    behaviorHints: {
      notWebReady: notWebReady ?? true,
      ...(playbackFilename && { filename: playbackFilename }),
      ...(bingeGroup && { bingeGroup }),
      ...((headers || proxyHeaders?.response) && {
        proxyHeaders: { ...(headers && { request: headers }), ...(proxyHeaders?.response && { response: proxyHeaders.response }) }
      })
    }
  };
}

async function runProvider(provider, lookup, type, originalLanguage) {
  let timer;
  try {
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => {
        console.warn("[TATA VOD]", provider, type, "timeout");
        resolve([]);
      }, PROVIDER_TIMEOUT);
    });
    const result = await Promise.race([Promise.resolve().then(lookup), timeout]);
    if (!Array.isArray(result)) return [];
    const inspected = await Promise.all(result.map(stream => inspectMedia(stream, originalLanguage)));
    const streams = inspected.map(stream => cleanStream(stream, provider)).filter(Boolean);
    if (result.length && !streams.length) console.warn("[TATA VOD]", provider, type, "invalid-stream-url");
    return streams;
  } catch (error) {
    console.warn("[TATA VOD]", provider, type, error.name);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function search(type, request) {
  const details = await findTmdb(type, request.id);
  if (!details?.id) return [];
  const genres = details.genre_ids ?? details.genres?.map(genre => genre.id) ?? [];
  const isAnimation = genres.includes(16);
  const providers = registry.filter(provider => provider[type] && (!provider.anime || isAnimation) &&
    (provider.credentials ?? []).every(key => process.env[key]));
  const animeDetails = isAnimation
    ? findTmdb(type, String(details.id), "en-US", 1800)
      .then(english => ({ ...details, englishTitle: english?.name ?? english?.title }))
      .catch(() => details)
    : Promise.resolve(details);
  const jobs = providers.map(provider => runProvider(provider.name, () => {
    const { getStreams } = require("../vendor/anthology/" + provider.id + "/index.js");
    const id = String(details.id);
    if (provider.metadataArgs) return (provider.anime ? animeDetails : Promise.resolve(details))
      .then(metadata => getStreams({ details: metadata, type, season: request.season, episode: request.episode }));
    if (provider.objectArgs) return getStreams({ id, type, season: request.season, episode: request.episode });
    return getStreams(id, type === "series" ? "tv" : "movie", request.season, request.episode);
  }, type, details.original_language));
  if (type === "series" && (process.env.TATA_SERIES_M3U_PATH || process.env.TATA_SERIES_M3U_KEY)) {
    jobs.unshift(runProvider("TATA M3U", async () =>
      getPlaylistStreams(await animeDetails, request.season, request.episode), type, details.original_language));
  }
  if (type === "movie") {
    jobs.unshift(runProvider("İzlefilm", () => getMovieStreams(details), type, details.original_language));
    if (process.env.TATA_EXTRA_FILM_M3U_KEY) {
      jobs.unshift(
        runProvider("TATA M3U · Filmler", () => getFilmPlaylistStreams("fullmovies", details, request.id), type, details.original_language),
        runProvider("TATA M3U · RecTV", () => getFilmPlaylistStreams("rectv", details, request.id), type, details.original_language),
        runProvider("TATA M3U · PixelDrain", () => getFilmPlaylistStreams("pixeldrain", details, request.id), type, details.original_language),
        runProvider("TATA M3U · ImgsAPI", () => getFilmPlaylistStreams("imgsapi", details, request.id), type, details.original_language)
      );
    }
    if (process.env.TATA_FILM_M3U_KEY) {
      jobs.unshift(
        runProvider("TATA M3U · FullHD", () => getFilmPlaylistStreams("fullhdfi", details, request.id), type, details.original_language),
        runProvider("TATA M3U · Vixolity", () => getFilmPlaylistStreams("vixolity", details, request.id), type, details.original_language)
      );
    }
  }
  const streams = (await Promise.all(jobs)).flat();
  const seen = new Set();
  return streams.filter(stream => {
    const key = JSON.stringify([stream[providerKey], stream.url, stream.behaviorHints?.proxyHeaders?.request ?? {}]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getVodStreams(type, id) {
  if (!process.env.TMDB_API_KEY || !["movie", "series"].includes(type)) return [];
  const request = parseRequest(type, id);
  if (!request) return [];
  const key = type + ":" + id;
  if (ongoing.has(key)) return ongoing.get(key);
  if (ongoing.size >= MAX_ACTIVE_SEARCHES) return [];
  const job = search(type, request).finally(() => ongoing.delete(key));
  ongoing.set(key, job);
  return job;
}

module.exports = { getVodStreams };
