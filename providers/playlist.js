const { readFile } = require("node:fs/promises");
const { createDecipheriv } = require("node:crypto");
const { gunzipSync } = require("node:zlib");
const { join } = require("node:path");

async function readPlaylist(path, key) {
  if (path) return readFile(path, "utf8");
  return readEncryptedPlaylist("series.m3u.gz.enc", key);
}

async function readEncryptedPlaylist(filename, key) {
  const data = await readFile(join(__dirname, "..", "assets", filename));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return gunzipSync(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()])).toString("utf8");
}

const titleKey = value => String(value ?? "").normalize("NFKD").toLowerCase()
  .replace(/ı/g, "i").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");

function indexPlaylist(text) {
  const episodes = new Map();
  let pending;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF:")) {
      const group = line.match(/\bgroup-title="([^"]+)"/i)?.[1];
      const name = line.replace(/^#EXTINF:(?:"[^"]*"|[^,])*,/, "");
      const numbers = name.replace(/ı/g, "i").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
      const season = numbers.match(/(?:\bsezon\s*(\d+)|\b(\d+)\.\s*s(?:ezon)?\b)/);
      const episode = numbers.match(/(?:\bbolum\s*(\d+)|\b(\d+)\.\s*bolum\b)/);
      pending = group && season && episode ? {
        key: [titleKey(group), Number(season[1] || season[2]), Number(episode[1] || episode[2])].join(":"),
        dubbed: /\bdublaj\b/.test(numbers),
        headers: {}
      } : null;
      continue;
    }
    if (!pending) continue;
    const option = line.match(/^#EXTVLCOPT:http-(user-agent|referrer)=(.+)$/i);
    if (option) {
      pending.headers[option[1].toLowerCase() === "referrer" ? "Referer" : "User-Agent"] = option[2];
    } else if (/^https?:\/\//i.test(line)) {
      const rows = episodes.get(pending.key) ?? [];
      rows.push({
        url: line,
        headers: pending.headers,
        ...(pending.dubbed && { audio: "Türkçe Dublaj" })
      });
      episodes.set(pending.key, rows);
      pending = null;
    } else if (line && !line.startsWith("#")) {
      pending = null;
    }
  }
  return episodes;
}

let indexed;
async function getPlaylistStreams(details, season, episode) {
  const path = process.env.TATA_SERIES_M3U_PATH;
  const key = process.env.TATA_SERIES_M3U_KEY;
  if (!path && !key) return [];
  indexed ??= readPlaylist(path, key).then(indexPlaylist).catch(error => {
    indexed = undefined;
    throw error;
  });
  const episodes = await indexed;
  const titles = [details.name, details.original_name, details.englishTitle].map(titleKey).filter(Boolean);
  return [...new Set(titles)].flatMap(title => episodes.get([title, season, episode].join(":")) ?? []);
}

module.exports = { getPlaylistStreams, readEncryptedPlaylist, titleKey };
