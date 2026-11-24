const { getFilmPlaylistStreams } = require("./film-playlist");
const { getPlaylistStreams } = require("./playlist");
const { getMovieStreams } = require("./izlefilm");
const registry = require("../vendor/anthology/providers.json");
const { getLocalIzlelanJobs, IZLELAN_NAMES } = require("./izlelan-adapter");
const { enrichStreams } = require("./stream-metadata");
const izProviderNames = new Set(IZLELAN_NAMES);
// Fail closed: unreviewed providers must not return title-matched content.
const strictIdentity = process.env.TATA_STRICT_IDENTITY !== "0";
const identityProviders = new Set();

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
  return {
    [providerKey]: provider,
    name: izProviderNames.has(provider) ? provider : "TATA",
    ...(stream.description || stream.quality ? { description: stream.description || stream.quality } : {}),
    ...(stream.quality && { quality: stream.quality }),
    ...(stream.title && { title: stream.title }),
    ...(stream.format && { format: stream.format }),
    ...(Array.isArray(stream.audioLangs) && { audioLangs: stream.audioLangs }),
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

async function runProvider(provider, lookup, type) {
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
    const streams = result.map(stream => cleanStream(stream, provider)).filter(Boolean);
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
  const providers = registry.filter(provider => (!strictIdentity || identityProviders.has(provider.id)) && provider[type] && (!provider.anime || isAnimation) &&
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
  }, type));
  if (!strictIdentity && type === "series" && (process.env.TATA_SERIES_M3U_PATH || process.env.TATA_SERIES_M3U_KEY)) {
    jobs.unshift(runProvider("TATA M3U", async () =>
      getPlaylistStreams(await animeDetails, request.season, request.episode), type));
  }
  if (type === "movie") {
    if (!strictIdentity) jobs.unshift(runProvider("İzlefilm", () => getMovieStreams(details), type));
    if (!strictIdentity && process.env.TATA_EXTRA_FILM_M3U_KEY) {
      jobs.unshift(
        runProvider("TATA M3U · Filmler", () => getFilmPlaylistStreams("fullmovies", details, request.id), type),
        runProvider("TATA M3U · RecTV", () => getFilmPlaylistStreams("rectv", details, request.id), type),
        runProvider("TATA M3U · PixelDrain", () => getFilmPlaylistStreams("pixeldrain", details, request.id), type),
        runProvider("TATA M3U · ImgsAPI", () => getFilmPlaylistStreams("imgsapi", details, request.id), type)
      );
    }
    if (process.env.TATA_FILM_M3U_KEY) {
      jobs.unshift(
        ...(!strictIdentity ? [runProvider("TATA M3U · FullHD", () => getFilmPlaylistStreams("fullhdfi", details, request.id), type)] : []),
        runProvider("TATA M3U · Vixolity", () => getFilmPlaylistStreams("vixolity", details, request.id), type)
      );
    }
  }
  for (const source of strictIdentity ? [] : getLocalIzlelanJobs()) {
    jobs.push(runProvider(source.name, () => source.getStreams(String(details.id), type === "series" ? "tv" : "movie", request.season, request.episode), type));
  }
  const streams = (await Promise.all(jobs)).flat();
  const seen = new Set();
  return enrichStreams(streams.filter(stream => {
    const key = JSON.stringify([stream[providerKey], stream.url, stream.behaviorHints?.proxyHeaders?.request ?? {}]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }), details.original_language);
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
