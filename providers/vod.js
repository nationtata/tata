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

async function findTmdb(type, id) {
  const query = new URLSearchParams({ api_key: process.env.TMDB_API_KEY, language: "tr-TR" });
  const apiType = type === "series" ? "tv" : "movie";
  const isImdb = id.startsWith("tt");
  if (isImdb) query.set("external_source", "imdb_id");
  const resource = isImdb ? "find/" + id : apiType + "/" + id.replace(/^tmdb:/, "");
  const response = await fetch("https://api.themoviedb.org/3/" + resource + "?" + query, {
    signal: AbortSignal.timeout(3500)
  });
  if (!response.ok) return null;
  const data = await response.json();
  return isImdb ? data[apiType + "_results"]?.[0] : data;
}

function streamLabels(stream, provider) {
  const audio = [stream.audio, stream.audioLabel, stream.language, stream.name, stream.title, stream.description]
    .filter(value => typeof value === "string").join(" ").toLocaleLowerCase("tr");
  const languages = [];
  const audioTracks = Array.isArray(stream.audioTracks) ? stream.audioTracks : [];
  if (audioTracks.some(track => track?.original === true ||
      /\b(?:orijinal|original)\b/i.test(String(track?.label ?? track?.name ?? ""))) ||
      /\b(?:orijinal|original)\b/u.test(audio)) {
    languages.push("Orijinal");
  }
  if (stream.embeddedSubtitles === true) languages.push("Altyazılı");
  const hasTurkishDub = audioTracks.length
    ? audioTracks.some(track => {
      const language = String(track?.language ?? track?.lang ?? "").toLocaleLowerCase("tr");
      const label = String(track?.label ?? track?.name ?? "").toLocaleLowerCase("tr");
      const isTurkish = /^(?:tr(?:-tr)?|tur|türkçe|turkish)$/.test(language) ||
        /(?:türkçe|turkish)\s+(?:dublaj|dub)/.test(label);
      return isTurkish && (track?.dubbed === true || /(?:dublaj|dubbed|\bdub\b)/.test(label));
    })
    : [stream.audio, stream.audioLabel].some(value => typeof value === "string" &&
      /^(?:türkçe|turkish)\s+(?:dublaj(?:lı)?|dub(?:bed)?)$/u.test(value.trim().toLocaleLowerCase("tr")));
  if (hasTurkishDub) languages.push("Dublaj");

  return {
    name: provider,
    title: languages.join(" · ")
  };
}

function cleanStream(stream, provider) {
  if (!stream || typeof stream.url !== "string" || !/^https?:\/\//i.test(stream.url)) return null;
  const headers = stream.behaviorHints?.proxyHeaders?.request ?? stream.behaviorHints?.headers ?? stream.headers;
  const { notWebReady, bingeGroup, proxyHeaders } = stream.behaviorHints ?? {};
  return {
    ...streamLabels(stream, provider),
    url: stream.url,
    ...(Array.isArray(stream.subtitles) && { subtitles: stream.subtitles }),
    behaviorHints: {
      notWebReady: notWebReady ?? true,
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
  const providers = registry.filter(provider => provider[type] && (!provider.anime || isAnimation) &&
    (provider.credentials ?? []).every(key => process.env[key]));
  const jobs = providers.map(provider => runProvider(provider.name, () => {
    const { getStreams } = require("../vendor/anthology/" + provider.id + "/index.js");
    const id = String(details.id);
    if (provider.objectArgs) return getStreams({ id, type, season: request.season, episode: request.episode });
    return getStreams(id, type === "series" ? "tv" : "movie", request.season, request.episode);
  }, type));
  if (type === "movie") {
    jobs.unshift(runProvider("İzlefilm", () => getMovieStreams(details), type));
  }
  const streams = (await Promise.all(jobs)).flat();
  const seen = new Set();
  return streams.filter(stream => {
    const key = JSON.stringify([stream.name, stream.url, stream.behaviorHints?.proxyHeaders?.request ?? {}]);
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
