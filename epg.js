const fs = require("fs");
const path = require("path");

const EPG_FILE = path.join(__dirname, "epg.xml");

let epg = {};

function normalize(name = "") {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Çç]/g, "c")
    .replace(/[Ğğ]/g, "g")
    .replace(/[İIı]/g, "i")
    .replace(/[Öö]/g, "o")
    .replace(/[Şş]/g, "s")
    .replace(/[Üü]/g, "u")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function parseTime(str) {
  if (!str) return null;

  const m = str.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/
  );

  if (!m) return null;

  return new Date(
    `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`
  );
}

function loadEPG() {
  epg = {};

  if (!fs.existsSync(EPG_FILE)) {
    console.log("EPG bulunamadı.");
    return;
  }

  const xml = fs.readFileSync(EPG_FILE, "utf8");

  const regex =
    /<programme[^>]*start="([^"]+)"[^>]*stop="([^"]+)"[^>]*channel="([^"]+)"[^>]*>[\s\S]*?<title[^>]*>(.*?)<\/title>/g;

  let match;

  while ((match = regex.exec(xml)) !== null) {
    const id = normalize(match[3]);

    if (!epg[id]) epg[id] = [];

    epg[id].push({
      title: match[4].trim(),
      start: parseTime(match[1]),
      stop: parseTime(match[2])
    });
  }
}

function getCurrent(channelName) {
  const id = normalize(channelName);

  const list = epg[id] || [];

  const now = new Date();

  let current = null;
  let next = null;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];

    if (now >= item.start && now < item.stop) {
      current = item;
      next = list[i + 1] || null;
      break;
    }
  }

  if (!current) {
    return {
      now: null,
      next: null
    };
  }

  const progress =
    (now - current.start) /
    (current.stop - current.start);

  return {
    now: {
      title: current.title,
      start: current.start,
      stop: current.stop,
      progress: Math.max(0, Math.min(1, progress))
    },
    next
  };
}

loadEPG();

module.exports = {
  loadEPG,
  getCurrent
};
