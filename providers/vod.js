const { getFilmPlaylistStreams } = require("./film-playlist");
const { getPlaylistStreams, getMetvSeriesStreams, titleKey } = require("./playlist");
const { getMovieStreams } = require("./izlefilm");
const registry = require("../vendor/anthology/providers.json");
const { getLocalIzlelanJobs } = require("./izlelan-adapter");
const { enrichStreams } = require("./stream-metadata");
const { findYouTubeStreams } = require("./youtube");

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
  else if (type === "movie") query.set("append_to_response", "external_ids");
  const resource = isImdb ? "find/" + id : apiType + "/" + id.replace(/^tmdb:/, "");
  const response = await fetch("https://api.themoviedb.org/3/" + resource + "?" + query, {
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) return null;
  const data = await response.json();
  return isImdb ? data[apiType + "_results"]?.[0] : data;
}

const providerKey = Symbol("provider");
const visibleProviderNames = new Set(["ME TV Medya", "Power Sinema"]);

function streamIdentity(stream) {
  return JSON.stringify([stream.url, stream.behaviorHints?.proxyHeaders?.request ?? {}]);
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
  return {
    [providerKey]: provider,
    ...(provider === "ME TV Medya" && stream.metvVariant && { metvVariant: stream.metvVariant }),
    name: visibleProviderNames.has(provider) ? provider : "Yayın",
    ...(stream.description || stream.quality ? { description: stream.description || stream.quality } : {}),
    ...(stream.quality && { quality: stream.quality }),
    ...(stream.title && stream.title !== provider && { title: stream.title }),
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
  try {
    const result = await Promise.resolve().then(lookup);
    if (!Array.isArray(result)) return [];
    const streams = result.map(stream => cleanStream(stream, provider)).filter(Boolean);
    if (result.length && !streams.length) console.warn("[TATA VOD]", provider, type, "invalid-stream-url");
    return streams;
  } catch (error) {
    console.warn("[TATA VOD]", provider, type, error.name);
    return [];
  }
}

// Full-length uploads from the series' and producers' official YouTube channels.
const youtubeSeries = [
  { ids: ["32836", "tt0845088"], title: "arka sokaklar", year: "2006",
    episodes: { "1:1": "TBBRBD8Fudg", "1:2": "JjVOWBu4z48", "1:3": "AF7o7S8TBiQ" } },
  { ids: ["tt2361816"], title: "seksenler", year: "2012",
    episodes: { "1:1": "Wn5piPtkki0" } }
];

const youtubeMovies = [
  { titles: ["Hababam Sınıfı", "The Chaos Class"], year: "1975", ytId: "hf2-8MRPGu8" },
  { titles: ["Süt Kardeşler", "The Foster Brothers"], year: "1976", ytId: "KRy20M7uQM4" },
  { titles: ["Neşeli Günler", "Happy Days"], year: "1978", ytId: "FQ_7cabWOv0" },
  { titles: ["Baskın"], year: "1977", ytId: "HIWwTWZP1H8" }
];

function getYouTubeStreams(type, request, details) {
  let ytId;
  if (type === "series") {
    const id = request.id.replace(/^tmdb:/, "");
    const show = youtubeSeries.find(item => item.ids.includes(id) || (details?.first_air_date?.slice(0, 4) === item.year &&
      [details.name, details.original_name].map(titleKey).includes(titleKey(item.title))));
    ytId = show?.episodes[request.season + ":" + request.episode];
  } else if (details) {
    const names = [details.title, details.original_title].map(titleKey);
    ytId = youtubeMovies.find(item => item.year === details.release_date?.slice(0, 4) &&
      item.titles.some(title => names.includes(titleKey(title))))?.ytId;
  }
  return ytId ? [{ name: "YouTube", ytId, description: "Ses: 🇹🇷" }] : [];
}

async function search(type, request) {
  const knownYouTubeStreams = getYouTubeStreams(type, request);
  const details = await findTmdb(type, request.id).catch(error => {
    if (!knownYouTubeStreams.length) throw error;
    console.warn("[TATA VOD] YouTube series metadata", error.name);
    return null;
  });
  if (!details?.id) return knownYouTubeStreams;
  const youtubeStreams = knownYouTubeStreams.length ? knownYouTubeStreams : getYouTubeStreams(type, request, details);
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
  }, type));
  if (type === "series" && (process.env.TATA_SERIES_M3U_PATH || process.env.TATA_SERIES_M3U_KEY)) {
    jobs.unshift(runProvider("TATA M3U", async () =>
      getPlaylistStreams(await animeDetails, request.season, request.episode), type));
  }
  if (type === "series") {
    jobs.push(runProvider("ME TV Medya", async () =>
      getMetvSeriesStreams(await animeDetails, request.season, request.episode), type));
  }
  if (type === "movie") {
    jobs.push(runProvider("ME TV Medya", () => getFilmPlaylistStreams("metvCinema", details, request.id), type));
    jobs.unshift(runProvider("İzlefilm", () => getMovieStreams(details), type));
    if (process.env.TATA_EXTRA_FILM_M3U_KEY) {
      jobs.unshift(
        runProvider("TATA M3U · Filmler", () => getFilmPlaylistStreams("fullmovies", details, request.id), type),
        runProvider("TATA M3U · RecTV", () => getFilmPlaylistStreams("rectv", details, request.id), type),
        runProvider("TATA M3U · PixelDrain", () => getFilmPlaylistStreams("pixeldrain", details, request.id), type),
        runProvider("TATA M3U · ImgsAPI", () => getFilmPlaylistStreams("imgsapi", details, request.id), type)
      );
    }
    jobs.push(runProvider("Power Sinema", () => getFilmPlaylistStreams("powerCinema", details, request.id), type));
    if (process.env.TATA_FILM_M3U_KEY) {
      jobs.unshift(
        runProvider("TATA M3U · FullHD", () => getFilmPlaylistStreams("fullhdfi", details, request.id), type),
        runProvider("TATA M3U · Vixolity", () => getFilmPlaylistStreams("vixolity", details, request.id), type)
      );
    }
  }
  for (const source of getLocalIzlelanJobs()) {
    jobs.push(runProvider(source.name, () => source.getStreams(String(details.id), type === "series" ? "tv" : "movie", request.season, request.episode), type));
  }
  if (!youtubeStreams.length && process.env.YOUTUBE_DATA_API_KEY) {
    jobs.push(findYouTubeStreams(type, details, request));
  }
  const streams = [];
  let accepting = true;
  let timer;
  try {
    await Promise.race([
      Promise.allSettled(jobs.map(job => job.then(result => {
        if (accepting) streams.push(...result);
      }))),
      new Promise(resolve => { timer = setTimeout(resolve, 5000); })
    ]);
  } finally {
    accepting = false;
    clearTimeout(timer);
  }
  const seen = new Set();
  const enriched = await enrichStreams(streams.filter(stream => {
    if (stream.ytId) return false;
    const identity = streamIdentity(stream);
    const key = JSON.stringify([stream[providerKey], identity]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }), details.original_language);
  return [...youtubeStreams, ...streams.filter(stream => stream.ytId), ...enriched];
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
