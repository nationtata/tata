const { titleKey } = require("./playlist");

const officialChannels = [
  "UCJBBp-6JoqjOeLzTxzol_7A", // Arka Sokaklar
  "UCYRPB4TbD2RYHlIQdLgEeYA", // Seksenler
  "UCUALYmnkEmx8vlxIbpr2gmw", // Arzu Film
  "UCUX_iQoFXw2nYzIuuYdeWhg"  // Erler Film
];
const cache = new Map();
const pending = new Map();
const clip = /\b(?:fragman|tanitim|sahne|ozet|derleme|roportaj|kamera arkasi|trailer|teaser|shorts|clip|recap|part|kisim|parca|bolumden|kesit|sneak peek)\b/i;
const fold = value => String(value ?? "").toLocaleLowerCase("tr").normalize("NFKD")
  .replace(/\p{M}/gu, "").replace(/ı/g, "i").trim();
const noise = /\b(?:full hd|full film|full episode|tek parca|tam film|tam bolum|turk filmi|turkce dublaj|4k|1080p|720p|hd)\b/g;
const seasonEpisode = /(?:\b(\d+)\.?\s*sezon\s*[-,.:]*\s*(\d+)\.?\s*bolum\b|\bs(\d+)\s*e(\d+)\b)/;
const episodeOnly = /\b(\d+)\.?\s*bolum\b/;

function titleMatches(video, type, details, request) {
  const title = fold(video.snippet?.title);
  const names = [details.name, details.title, details.original_name, details.original_title]
    .map(value => titleKey(fold(value))).filter(Boolean);
  if (!names.length || clip.test(title.replace(/\btek parca\b/g, ""))) return false;
  if (type === "movie") {
    const year = details.release_date?.slice(0, 4);
    if (!/^\d{4}$/.test(year || "") || !new RegExp("\\b" + year + "\\b").test(title)) return false;
    const name = titleKey(title.split("|", 1)[0].replace(year, "").replace(noise, ""));
    return names.includes(name);
  }
  const match = title.match(seasonEpisode);
  const episode = match || title.match(episodeOnly);
  if (!episode) return false;
  const seasonNumber = match ? Number(match[1] || match[3]) : 1;
  const episodeNumber = match ? Number(match[2] || match[4]) : Number(episode[1]);
  const name = titleKey(title.replace(episode[0], "").replace(noise, ""));
  return names.includes(name) && seasonNumber === request.season && episodeNumber === request.episode;
}

function playable(video, type, channels) {
  const status = video.status;
  if (status?.privacyStatus !== "public" || status.embeddable !== true || !channels.has(video.snippet?.channelId)) return false;
  const region = video.contentDetails?.regionRestriction;
  if (region?.blocked?.includes("TR") || (region?.allowed && !region.allowed.includes("TR"))) return false;
  const duration = video.contentDetails?.duration?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!duration) return false;
  const minutes = Number(duration[1] || 0) * 60 + Number(duration[2] || 0);
  return minutes >= (type === "movie" ? 40 : 25);
}

async function callYouTube(resource, params, apiKey, signal) {
  const query = new URLSearchParams(params);
  const response = await fetch("https://www.googleapis.com/youtube/v3/" + resource + "?" + query, { signal, headers: { "X-Goog-Api-Key": apiKey } });
  if (!response.ok) throw new Error("YouTube " + resource + " HTTP " + response.status);
  return response.json();
}

async function lookUp(type, details, request, apiKey, channels) {
  const signal = AbortSignal.timeout(35000);
  const title = details.name || details.title;
  const suffix = type === "movie" ? details.release_date?.slice(0, 4)
    : request.season + ". Sezon " + request.episode + ". Bölüm";
  if (!title || !suffix) return [];
  const found = await callYouTube("search", {
    part: "snippet", type: "video", maxResults: "30", q: title + " " + suffix,
    regionCode: "TR", videoEmbeddable: "true",
    ...(details.youtubeChannel && { channelId: details.youtubeChannel })
  }, apiKey, signal);
  const ids = (found.items ?? []).filter(item => channels.has(item.snippet?.channelId))
    .map(item => item.id?.videoId).filter(id => /^[\w-]{11}$/.test(id || ""));
  if (!ids.length) return [];
  const videos = await callYouTube("videos", { part: "snippet,contentDetails,status", id: ids.join(",") }, apiKey, signal);
  return (videos.items ?? []).filter(video => ids.includes(video.id) &&
    playable(video, type, channels) && titleMatches(video, type, details, request))
    .slice(0, 2).map(video => ({
      name: "YouTube", ytId: video.id,
      ...(video.snippet.defaultAudioLanguage?.toLowerCase().split("-")[0] === "tr" && { description: "Ses: 🇹🇷" })
    }));
}

async function findYouTubeStreams(type, details, request) {
  const apiKey = process.env.YOUTUBE_DATA_API_KEY;
  if (!apiKey) return [];
  const extraChannels = (process.env.TATA_YOUTUBE_CHANNEL_IDS || "").split(",").map(id => id.trim())
    .filter(id => /^UC[\w-]{22}$/.test(id));
  const channels = new Set([...officialChannels, ...extraChannels]);
  const key = JSON.stringify([type, details.id, request.season, request.episode]);
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.streams;
  if (pending.has(key)) return waitForResults(pending.get(key));
  const job = lookUp(type, details, request, apiKey, channels).then(streams => {
    if (cache.size >= 512) cache.delete(cache.keys().next().value);
    cache.set(key, { streams, expires: Date.now() + (streams.length ? 21600000 : 900000) });
    return streams;
  }).catch(error => {
    console.warn("[TATA YouTube]", type, details.id, error.name,
      /^YouTube (?:search|videos) HTTP \d{3}$/.test(error.message) ? error.message : "");
    return [];
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return waitForResults(job);
}

async function waitForResults(job) {
  let timer;
  try {
    return await Promise.race([job, new Promise(resolve => {
      timer = setTimeout(() => resolve([]), 8500);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { findYouTubeStreams };
