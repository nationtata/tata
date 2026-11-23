const { spawn } = require("node:child_process");
const { path: ffprobe } = require("@ffprobe-installer/ffprobe");
const { playbackTracks } = require("../vendor/anthology/shared/playback-tracks");

const allowedHosts = new Set(["ha.vixolity.com", "load.prectv63.lol", "imgsapi.pro", "pixeldrain.com",
  "video.anizume.com", "video.konununuzmani.com", "irtau1.online", "four.pichive.online",
  "four.dplayer82.site", "rovideo.xyz", "replacement.cdnrectv.xyz"]);
const sampleSize = 2 * 1024 * 1024;
const languageAliases = { eng: "en", tur: "tr", jpn: "ja", kor: "ko", zho: "zh", chi: "zh",
  fra: "fr", fre: "fr", deu: "de", ger: "de", spa: "es", ita: "it", rus: "ru", ara: "ar", por: "pt", hin: "hi" };
let active = 0;

function playableUrl(value, base) {
  const url = new URL(value, base);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHosts.has(url.hostname)) return null;
  return url;
}

async function readPrefix(url, limit, headers, signal, range) {
  if (!url) return Buffer.alloc(0);
  const response = await fetch(url, {
    headers: { ...headers, ...(range && { Range: "bytes=0-" + (limit - 1) }) },
    redirect: "error", signal
  });
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    if (!response.ok) return Buffer.alloc(0);
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value.subarray(0, limit - size));
      chunks.push(chunk);
      size += chunk.length;
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.cancel().catch(() => {});
  }
}

function probeBytes(bytes, signal) {
  const mp4 = /^(?:ftyp|styp|moov|moof)$/.test(bytes.toString("ascii", 4, 8));
  const transport = bytes[0] === 0x47 && bytes[188] === 0x47;
  if (!mp4 && !transport || signal.aborted) return Promise.resolve([]);
  return new Promise(resolve => {
    const child = spawn(ffprobe, ["-v", "error", "-protocol_whitelist", "pipe",
      "-f", mp4 ? "mov" : "mpegts", "-show_entries",
      "stream=codec_type,height:stream_tags=language,title", "-of", "json", "-i", "pipe:0"],
    { stdio: ["pipe", "pipe", "ignore"], windowsHide: true, signal, timeout: 850 });
    let stdout = "";
    child.stdout.on("data", chunk => {
      if (stdout.length < 32768) stdout += chunk;
      else child.kill();
    });
    child.stdin.on("error", () => {});
    child.on("error", () => resolve([]));
    child.on("close", () => {
      try { resolve(JSON.parse(stdout).streams ?? []); } catch { resolve([]); }
    });
    child.stdin.end(bytes);
  });
}

function mergeTracks(stream, manifest, streams, originalLanguage) {
  const original = String(originalLanguage ?? "").toLowerCase();
  const declared = playbackTracks(manifest);
  const audioTracks = [...(stream.audioTracks ?? []), ...declared.audioTracks.map(track => ({
    ...track,
    original: track.original || Boolean(original && track.lang.split("-")[0] === original),
    dubbed: track.dubbed || Boolean(original && original !== "tr" && track.lang === "tr")
  }))];
  const heights = [...(stream.videoHeights ?? []), ...declared.videoHeights];
  for (const item of streams) {
    if (item.codec_type === "video" && Number.isInteger(item.height)) heights.push(item.height);
    if (item.codec_type === "audio") {
      const tag = String(item.tags?.language ?? "").toLowerCase().split("-")[0];
      const lang = languageAliases[tag] ?? tag;
      const label = String(item.tags?.title ?? "");
      audioTracks.push({
        lang,
        label,
        original: Boolean(original && lang === original) || /\borijinal\b|\boriginal\b/i.test(label),
        dubbed: lang === "tr" && (Boolean(original && original !== "tr") || /dublaj|dubbed/i.test(label))
      });
    }
  }
  return {
    ...stream,
    audioTracks,
    videoHeights: [...new Set(heights)],
    embeddedSubtitles: stream.embeddedSubtitles === true || declared.embeddedSubtitles ||
      streams.some(item => item.codec_type === "subtitle")
  };
}

async function inspectMedia(stream, originalLanguage) {
  if (active >= 6 || !stream?.url || (stream.audioTracks?.length && stream.embeddedSubtitles === true)) return stream;
  let url;
  try { url = playableUrl(stream.url); } catch { return stream; }
  if (!url) return stream;

  const rawHeaders = stream.behaviorHints?.proxyHeaders?.request ?? stream.behaviorHints?.headers ?? stream.headers ?? {};
  const headers = Object.fromEntries(Object.entries(rawHeaders).filter(([key]) => /^(referer|origin|user-agent)$/i.test(key)));
  const signal = AbortSignal.timeout(2200);
  const hls = stream.isHls === true || /^(hls|m3u8)$/i.test(stream.format ?? stream.type ?? "") || /\.m3u8$/i.test(url.pathname + url.hash);
  let manifest = "";
  active++;
  try {
    let bytes;
    if (hls) {
      manifest = (await readPrefix(url, 65536, headers, signal, false)).toString("utf8");
      if (!manifest.trimStart().startsWith("#EXTM3U")) return stream;
      const variant = manifest.match(/^#EXT-X-STREAM-INF:[^\r\n]*\r?\n([^#\r\n][^\r\n]*)/m)?.[1];
      const playlistUrl = variant ? playableUrl(variant.trim(), url) : url;
      const media = variant
        ? (await readPrefix(playlistUrl, 65536, headers, signal, false)).toString("utf8")
        : manifest;
      if (!media.trimStart().startsWith("#EXTM3U")) return mergeTracks(stream, manifest, [], originalLanguage);
      const segment = media.match(/^#EXTINF:[^\r\n]*\r?\n([^#\r\n][^\r\n]*)/m)?.[1];
      const init = media.match(/^#EXT-X-MAP:[^\r\n]*URI="([^"]+)"/m)?.[1];
      if (!segment) return mergeTracks(stream, manifest, [], originalLanguage);
      const [part, header] = await Promise.all([
        readPrefix(playableUrl(segment.trim(), playlistUrl), sampleSize, headers, signal, true),
        init ? readPrefix(playableUrl(init, playlistUrl), 256 * 1024, headers, signal, true) : Buffer.alloc(0)
      ]);
      bytes = Buffer.concat([header, part]);
    } else {
      bytes = await readPrefix(url, sampleSize, headers, signal, true);
    }
    return mergeTracks(stream, manifest, await probeBytes(bytes, signal), originalLanguage);
  } catch {
    return manifest.trimStart().startsWith("#EXTM3U") ? mergeTracks(stream, manifest, [], originalLanguage) : stream;
  } finally {
    active--;
  }
}

module.exports = { inspectMedia };
