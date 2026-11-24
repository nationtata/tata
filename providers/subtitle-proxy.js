"use strict";

// Source-scoped subtitle gateway: only opaque IDs registered by a Law stream
// can be fetched. Clients cannot supply an arbitrary upstream URL.
const { randomBytes } = require("node:crypto");
const { requestMedia } = require("./stream-metadata");

const records = new Map();
const MAX_RECORDS = 1024;
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SUBTITLE_BYTES = 1024 * 1024;

function prune() {
  const now = Date.now();
  for (const [id, item] of records) {
    if (item.expires <= now) records.delete(id);
  }
  while (records.size >= MAX_RECORDS) {
    records.delete(records.keys().next().value);
  }
}

function subtitleBase() {
  try {
    const external = new URL(process.env.RENDER_EXTERNAL_URL || "https://tata-d692.onrender.com");
    if (external.protocol === "https:" && !external.username && !external.password)
      return external.origin;
  } catch {}
  return "https://tata-d692.onrender.com";
}

function register(track, inheritedHeaders) {
  if (!track || typeof track.url !== "string" || !/^https:\/\//i.test(track.url)) return track;
  const id = randomBytes(18).toString("hex");
  const headers = { ...(inheritedHeaders || {}), ...(track.headers || {}) };
  prune();
  records.set(id, { url: track.url, headers, expires: Date.now() + TTL_MS });
  // Keep the original subtitle URL and headers server-side; Nuvio only needs
  // the HTTPS WebVTT URL, language, and track ID.
  const rewritten = { ...track, url: subtitleBase() + "/subtitle-proxy/" + id + ".vtt", type: "vtt" };
  delete rewritten.headers;
  return rewritten;
}

function proxyLawStream(stream) {
  if (stream?.name !== "Law" || !Array.isArray(stream.subtitles)) return stream;
  const headers = stream.behaviorHints?.proxyHeaders?.request || {};
  return {
    ...stream,
    subtitles: stream.subtitles.map(track => register(track, headers))
  };
}

function proxyLawResourceTracks(tracks) {
  return tracks.map(track => String(track?.id || "").startsWith("Law:")
    ? register(track, {})
    : track);
}

function asWebVtt(buffer) {
  if (!buffer || !buffer.length || buffer.length >= MAX_SUBTITLE_BYTES) return null;
  const body = buffer.toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (body.includes("\u0000") || /^\s*</.test(body)) return null;
  if (/^WEBVTT(?:[ \t][^\r\n]*)?(?:\r?\n|$)/.test(body)) return body;
  // SubRip timestamps are converted to WebVTT, keeping all cues and text.
  if (/\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(body)) {
    return "WEBVTT\n\n" + body.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  }
  return null;
}

async function serveSubtitle(req, res) {
  const entry = records.get(req.params.id);
  if (!entry || entry.expires <= Date.now()) return res.sendStatus(404);
  try {
    // requestMedia pins public DNS addresses, rejects credentials/private hosts,
    // bounds redirects, read size and timeout, and uses safe provider headers.
    const response = await requestMedia(entry.url, entry.headers, {
      maxBytes: MAX_SUBTITLE_BYTES,
      deadline: Date.now() + 5500
    });
    if (response.status !== "valid") {
      console.warn("[TATA subtitle gateway] upstream-unavailable", response.status);
      return res.sendStatus(502);
    }
    const vtt = asWebVtt(response.buffer);
    if (!vtt) {
      console.warn("[TATA subtitle gateway] unsupported-or-truncated-subtitle");
      return res.sendStatus(502);
    }
    res.setHeader("Content-Type", "text/vtt; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=120");
    return res.send(vtt);
  } catch {
    console.warn("[TATA subtitle gateway] fetch-error");
    return res.sendStatus(502);
  }
}

module.exports = { proxyLawStream, proxyLawResourceTracks, serveSubtitle, asWebVtt };
