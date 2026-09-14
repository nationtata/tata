const fs = require("fs");
const path = require("path");

/* =========================================================
   M3U DOSYALARI
========================================================= */

const PLAYLISTS = [
  {
    file: path.join(__dirname, "tata.m3u"),
    source: "Ana"
  },
  {
    file: path.join(__dirname, "lists", "alternatif1.m3u"),
    source: "Alternatif 1"
  },
  {
    file: path.join(__dirname, "lists", "alternatif2.m3u"),
    source: "Alternatif 2"
  },
  {
    file: path.join(__dirname, "lists", "alternatif3.m3u"),
    source: "Alternatif 3"
  }
];

let channels = [];
let grouped = {};

/* =========================================================
   İSİM NORMALİZASYONU
========================================================= */

const NAME_MAP = {

  // Ulusal
  "SHOW TV": "SHOW",
  "STAR TV": "STAR",
  "NOW TV": "NOW",
  "BEYAZ TV": "BEYAZ",
  "TV100": "TV 100",
  "CNN TÜRK": "CNN TURK",
  "TRT HABER": "TRT HABER",

  // Spor
  "TIVIBU SPOR": "TİVİBU SPOR",
  "TIVIBU SPOR 2": "TİVİBU SPOR 2",
  "SPORT SMART": "SPORT SMART",
  "SPORT SMART HD": "SPORT SMART",

  // Çocuk
  "CARTOON NETWORK": "CARTOON NETWORK",
  "MINIKA GO": "MINIKA GO"

};

function normalizeName(name = "") {

  const upper = name.trim().toUpperCase();

  return NAME_MAP[upper] || name.trim();

}

function slugify(text) {

  return normalizeName(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Çç]/g, "c")
    .replace(/[Ğğ]/g, "g")
    .replace(/[İIı]/g, "i")
    .replace(/[Öö]/g, "o")
    .replace(/[Şş]/g, "s")
    .replace(/[Üü]/g, "u")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

}

/* =========================================================
   GRUP NORMALİZASYONU
========================================================= */

function normalizeGroup(group = "") {

  const g = group.toLowerCase();

  if (g.includes("ulusal")) return "Ulusal";
  if (g.includes("spor")) return "Spor";
  if (g.includes("haber")) return "Haber";
  if (g.includes("belgesel")) return "Belgesel";
  if (g.includes("çocuk") || g.includes("cocuk")) return "Çocuk";

  return "Diğer";

}

/* =========================================================
   TEK M3U OKUYUCU
========================================================= */

function readPlaylist(file, source, map) {

  if (!fs.existsSync(file)) return;

  const text = fs.readFileSync(file, "utf8");

  const lines = text.split(/\r?\n/);

  let current = null;

  for (const line of lines) {

    if (line.startsWith("#EXTINF")) {

      const rawName =
        line.match(/,(.*)$/)?.[1]?.trim() || "Kanal";

      current = {

        name: normalizeName(rawName),

        group: normalizeGroup(
          line.match(/group-title="([^"]+)"/)?.[1] || ""
        ),

        logo:
          line.match(/tvg-logo="([^"]+)"/)?.[1] || "",

        stream: ""

      };

    }

    else if (current && /^https?:\/\//.test(line)) {

      current.stream = line.trim();

      const id = slugify(current.name);

      if (!map.has(id)) {

        map.set(id, {

          id,

          name: current.name,

          group: current.group,

          logo: current.logo,

          stream: current.stream,

          alternatives: []

        });

      }

      const channel = map.get(id);

      if (!channel.logo && current.logo) {
        channel.logo = current.logo;
      }

      if (
        !channel.alternatives.some(
          a => a.url === current.stream
        )
      ) {

        channel.alternatives.push({

          source,

          url: current.stream

        });

      }

      current = null;

    }

  }

}

/* =========================================================
   TÜM LİSTELERİ YÜKLE
========================================================= */

function loadM3U() {

  const map = new Map();

  grouped = {
    Ulusal: [],
    Spor: [],
    Haber: [],
    Belgesel: [],
    Çocuk: [],
    Diğer: []
  };

  for (const playlist of PLAYLISTS) {

    readPlaylist(
      playlist.file,
      playlist.source,
      map
    );

  }

  channels = [...map.values()];

  for (const channel of channels) {

    if (grouped[channel.group]) {
      grouped[channel.group].push(channel);
    }

  }

  console.log(
    `M3U yüklendi: ${channels.length} kanal`
  );

  return channels;

}

loadM3U();

/* =========================================================
   EXPORT
========================================================= */

module.exports = {

  loadM3U,

  getChannels: () => channels,

  getGroups: () => grouped,

  getChannel: id =>
    channels.find(c => c.id === id)

};
