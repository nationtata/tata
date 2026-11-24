const { readEncryptedPlaylist, titleKey } = require("./playlist");

const sources = {
  fullhdfi: "fullhdfi.m3u.gz.enc",
  vixolity: "vixolity.m3u.gz.enc",
  fullmovies: "fullmovies.m3u.gz.enc",
  rectv: "rectv.m3u.gz.enc",
  pixeldrain: "pixeldrain.m3u.gz.enc",
  imgsapi: "imgsapi.m3u.gz.enc"
};
const indexes = new Map();
const powerCinemaUrl = "https://raw.githubusercontent.com/GitLatte/patr0n/refs/heads/site/lists/power-sinema.m3u";
const powerCinemaRefreshMs = 30 * 60 * 1000;
let powerCinemaIndex;
let powerCinemaRefresh;
let powerCinemaExpiresAt = 0;

async function getPowerCinemaIndex() {
  if (powerCinemaIndex && Date.now() < powerCinemaExpiresAt) return powerCinemaIndex;
  if (!powerCinemaRefresh) {
    powerCinemaRefresh = (async () => {
      const response = await fetch(powerCinemaUrl, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error("Power Sinema HTTP " + response.status);
      const index = indexFilms(await response.text(), "powerCinema");
      if (!index.imdb.size) throw new Error("Power Sinema playlist has no IMDb entries");
      powerCinemaIndex = index;
      powerCinemaExpiresAt = Date.now() + powerCinemaRefreshMs;
      return index;
    })().catch(error => {
      powerCinemaExpiresAt = Date.now() + 60000;
      if (!powerCinemaIndex) throw error;
      return powerCinemaIndex;
    }).finally(() => { powerCinemaRefresh = undefined; });
  }
  return powerCinemaRefresh;
}
const directSources = new Set(["fullmovies", "rectv", "pixeldrain", "imgsapi"]);

function add(index, key, row) {
  if (!key) return;
  const rows = index.get(key) ?? [];
  rows.push(row);
  index.set(key, rows);
}

function indexFilms(text, source) {
  const direct = directSources.has(source);
  const imdb = new Map();
  const titles = new Map();
  let pending;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      let name = line.replace(/^#EXTINF:(?:"[^"]*"|[^,])*,/, "").trim();
      if (direct) name = name.replace(/\s*\[(?:Türkçe\s+)?(?:Dublaj(?:\s*&\s*Altyazı)?|Altyazı(?:lı)?|Orijinal)\]/giu, "")
        .replace(/\s+-\s+(?:Dublaj|Altyazı(?:lı)?|Orijinal)$/iu, "")
        .replace(/\s+\((?:PixelDrain|(?:Türkçe\s+)?(?:Dublaj|Altyazı(?:lı)?|Orijinal)\s+-\s+(?:\d{3,4}p|4K))\)$/iu, "")
        .trim();
      const year = name.match(/\s*\(((?:19|20)\d{2})\)/);
      const baseTitle = year ? name.slice(0, year.index) : name;
      const aliases = direct ? baseTitle.split(/\s+-\s+/).map(titleKey).filter(Boolean) : [];
      pending = { title: titleKey(baseTitle), aliases, year: year?.[1], headers: {} };
      continue;
    }
    if (!pending) continue;
    const option = line.match(/^#EXTVLCOPT:http-(user-agent|referrer)=(.+)$/i);
    if (option) {
      pending.headers[option[1].toLowerCase() === "referrer" ? "Referer" : "User-Agent"] = option[2];
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const record = pending;
    pending = null;
    let url;
    try { url = new URL(line); } catch { continue; }
    if (url.protocol !== "https:" || url.username || url.password || url.port) continue;
    const row = { ...record, url: url.href, host: url.hostname };
    if (direct) {
      const pixel = source === "pixeldrain" && url.hostname === "pixeldrain.com" && /^\/api\/file\/[\w-]+\/?$/.test(url.pathname);
      const imageHls = source === "imgsapi" && url.hostname === "imgsapi.pro" && /^\/[\w.-]+\/?$/.test(url.pathname);
      if (!pixel && !imageHls && !/\.(?:m3u8|mp4)$/i.test(url.pathname)) continue;
      row.direct = true;
      row.isHls = imageHls || /\.m3u8$/i.test(url.pathname);
    } else if ((source === "vixolity" || source === "powerCinema")) {
      const id = url.hostname === "ha.vixolity.com" && url.pathname.match(/^\/(?:vs|mm)\/+(tt\d+)\/{0,2}$/i)?.[1];
      if (!id) continue;
      row.imdbId = id.toLowerCase();
      add(imdb, row.imdbId, row);
      if (source === "powerCinema") continue;
    } else if (!["rapidvid.org", "s.rapidvid.org", "vidmoxy.net"].includes(url.hostname)) {
      continue;
    }
    for (const title of new Set([row.title, ...row.aliases])) add(titles, title, row);
  }
  return { imdb, titles };
}

async function resolveFilm(row) {
  if (row.direct) return { url: row.url, isHls: row.isHls, headers: row.headers };
  if (row.host === "ha.vixolity.com") return {
    url: row.url,
    isHls: true,
    headers: { Referer: "https://ha.vixolity.com/", Origin: "https://ha.vixolity.com", ...row.headers }
  };
  const headers = { ...row.headers, Referer: row.url };
  if (row.host === "vidmoxy.net") {
    const { resolveVidmoxy } = require("../vendor/anthology/hdfilmizle");
    const result = await resolveVidmoxy(row.url, row.headers.Referer);
    return result && { url: result.streamUrl, isHls: true, subtitles: result.subtitles, headers };
  }
  const { resolveAtom } = require("../vendor/anthology/fullhdfilmizlesene");
  const [result] = await resolveAtom(row.url, "", row.headers) ?? [];
  return result && { ...result, isHls: true, headers };
}

async function getFilmPlaylistStreams(source, details, requestId) {
  if (source === "powerCinema") {
    const id = requestId.startsWith("tt") ? requestId : details.external_ids?.imdb_id ?? details.imdb_id;
    if (!id) return [];
    const { imdb } = await getPowerCinemaIndex();
    const matches = [...new Map((imdb.get(id) ?? []).map(row => [row.url, row])).values()];
    return Promise.all(matches.slice(0, 5).map(resolveFilm));
  }
  const key = directSources.has(source)
    ? process.env.TATA_EXTRA_FILM_M3U_KEY : process.env.TATA_FILM_M3U_KEY;
  if (!key) return [];
  if (!indexes.has(source)) {
    indexes.set(source, readEncryptedPlaylist(sources[source], key).then(text => indexFilms(text, source)).catch(error => {
      indexes.delete(source);
      throw error;
    }));
  }
  const { imdb, titles } = await indexes.get(source);
  const id = requestId.startsWith("tt") ? requestId : details.external_ids?.imdb_id ?? details.imdb_id;
  const year = details.release_date?.slice(0, 4);
  const names = [...new Set([details.title, details.original_title, details.englishTitle].map(titleKey).filter(Boolean))];
  let matches = source === "vixolity" && id
    ? imdb.get(id) ?? []
    : names.flatMap(name => titles.get(name) ?? []).filter(row =>
      source === "vixolity" ? Boolean(year && row.year === year) : !row.year || row.year === year);
  if (source === "vixolity" && new Set(matches.map(row => row.imdbId)).size > 1) return [];
  if (directSources.has(source)) {
    const exact = matches.filter(row => names.includes(row.title));
    if (exact.length) matches = exact;
    if (new Set(matches.map(row => row.title)).size > 1) return [];
  }
  const distinct = [...new Map(matches.map(row => [row.url, row])).values()].slice(0, 5);
  const resolved = await Promise.allSettled(distinct.map(resolveFilm));
  return resolved.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}

module.exports = { getFilmPlaylistStreams };
