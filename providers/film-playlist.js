const { readEncryptedPlaylist, titleKey } = require("./playlist");

const sources = {
  fullhdfi: "fullhdfi.m3u.gz.enc",
  vixolity: "vixolity.m3u.gz.enc"
};
const indexes = new Map();

function add(index, key, row) {
  if (!key) return;
  const rows = index.get(key) ?? [];
  rows.push(row);
  index.set(key, rows);
}

function indexFilms(text, source) {
  const imdb = new Map();
  const titles = new Map();
  let pending;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const name = line.replace(/^#EXTINF:(?:"[^"]*"|[^,])*,/, "").trim();
      const year = name.match(/\s*\(((?:19|20)\d{2})\)/);
      pending = { title: titleKey(year ? name.slice(0, year.index) : name), year: year?.[1], headers: {} };
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
    if (source === "vixolity") {
      const id = url.hostname === "ha.vixolity.com" && url.pathname.match(/^\/(?:vs|mm)\/+(tt\d+)\/{0,2}$/i)?.[1];
      if (!id) continue;
      row.imdbId = id.toLowerCase();
      add(imdb, row.imdbId, row);
    } else if (!["rapidvid.org", "s.rapidvid.org", "vidmoxy.net"].includes(url.hostname)) {
      continue;
    }
    add(titles, row.title, row);
  }
  return { imdb, titles };
}

async function resolveFilm(row) {
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
  const key = process.env.TATA_FILM_M3U_KEY;
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
  const matches = source === "vixolity" && id
    ? imdb.get(id) ?? []
    : names.flatMap(name => titles.get(name) ?? []).filter(row =>
      source === "vixolity" ? Boolean(year && row.year === year) : !row.year || row.year === year);
  if (source === "vixolity" && new Set(matches.map(row => row.imdbId)).size > 1) return [];
  const distinct = [...new Map(matches.map(row => [row.url, row])).values()].slice(0, 5);
  const resolved = await Promise.allSettled(distinct.map(resolveFilm));
  return resolved.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}

module.exports = { getFilmPlaylistStreams };
