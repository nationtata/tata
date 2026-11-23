const streamBase = "https://tata-d692.onrender.com/stream/";

async function getStreams(id, type, season, episode) {
  const input = id && typeof id === "object" ? id : { tmdbId: id, mediaType: type, season, episode };
  const mediaId = String(input.tmdbId ?? input.id ?? "");
  const mediaType = String(input.mediaType ?? input.type ?? "").toLowerCase();
  if (!/^(?:(?:tmdb:)?[1-9]\d*|tt\d+)$/i.test(mediaId)) return [];
  if (!["movie", "tv", "series"].includes(mediaType)) return [];

  const isMovie = mediaType === "movie";
  const seasonNumber = Number(input.season);
  const episodeNumber = Number(input.episode);
  if (!isMovie && (!Number.isInteger(seasonNumber) || seasonNumber < 0 ||
      !Number.isInteger(episodeNumber) || episodeNumber < 1)) return [];

  const routeId = (mediaId.includes(":") || /^tt/i.test(mediaId) ? mediaId : "tmdb:" + mediaId) +
    (isMovie ? "" : ":" + seasonNumber + ":" + episodeNumber);

  try {
    const response = await fetch(streamBase + (isMovie ? "movie/" : "series/") + routeId + ".json");
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data?.streams)) return [];
    return data.streams.filter(stream => stream?.name === "TATA" &&
      typeof stream.url === "string" && /^https?:\/\//i.test(stream.url)).map(stream => {
      const hints = stream.behaviorHints;
      const filename = hints?.filename ?? stream.url.split(/[?#]/, 1)[0];
      const format = filename.match(/\.(m3u8|mpd|mp4|mkv)$/i)?.[1]?.toLowerCase();
      return {
        name: "TATA",
        url: stream.url,
        ...(format && { format }),
        ...(hints?.proxyHeaders?.request && { headers: hints.proxyHeaders.request }),
        ...(Array.isArray(stream.subtitles) && { subtitles: stream.subtitles })
      };
    });
  } catch {
    return [];
  }
}

module.exports = { getStreams };
