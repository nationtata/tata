const fs = require("fs");
const path = require("path");

const M3U_FILE = path.join(__dirname, "tata.m3u");

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
  "TEVE2": "TV2",
  "A2 TV": "A2",

  // Haber
  "TV100": "TV 100",
  "SÖZCÜ TV": "SZC",
  "ULKE TV": "ÜLKE",
  "CNN TURK": "CNN TÜRK",
  "BLOOMBERGHT": "BLOOMBERG HT",

  // Spor
  "A SPOR HD": "A SPOR",
  "TRT SPOR HD": "TRT SPOR",
  "TRT SPOR YILDIZ HD": "TRT SPOR YILDIZ",
  "S SPORT HD": "S SPORT",
  "S SPORT2": "S SPORT 2",
  "TIVIBU SPOR": "TİVİBU SPOR",
  "TIVIBU SPOR 1": "TİVİBU SPOR 1",
  "TIVIBU SPOR 2": "TİVİBU SPOR 2",
  "TIVIBU SPOR 3": "TİVİBU SPOR 3",
  "TABII SPOR": "TABİİ SPOR 1",

  // Belgesel
  "TRT BELGESEL HD": "TRT BELGESEL",
  "NAT GEO": "NATIONAL GEOGRAPHIC",
  "NAT GEO WILD HD": "NAT GEO WILD",

  // Çocuk
  "TRT ÇOCUK HD": "TRT ÇOCUK",
  "CARTOON NETWORK HD": "CARTOON NETWORK",
  "CARTOONITO TR": "CARTOONITO"

};

/* =========================================================
   İsim Temizleme
========================================================= */

function normalizeName(name = "") {

  let n = name
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

  if (NAME_MAP[n])
    return NAME_MAP[n];

  return n;

}

/* =========================================================
   ID ÜRET
========================================================= */

function slugify(text) {

  return text
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

/* =========================================================
   KATEGORİ NORMALİZASYONU
========================================================= */

function normalizeGroup(group = "") {

  const g = group.toLowerCase();

  if (g.includes("ulusal"))
    return "Ulusal";

  if (g.includes("spor"))
    return "Spor";

  if (g.includes("haber"))
    return "Haber";

  if (g.includes("belgesel"))
    return "Belgesel";

  if (
    g.includes("çocuk") ||
    g.includes("cocuk")
  )
    return "Çocuk";

  return "Ulusal";

}

/* =========================================================
   M3U YÜKLE
========================================================= */

function loadM3U() {

  const text = fs.readFileSync(
    M3U_FILE,
    "utf8"
  );

  const lines = text.split(/\r?\n/);

  channels = [];

  grouped = {
    Ulusal: [],
    Spor: [],
    Haber: [],
    Belgesel: [],
    Çocuk: []
  };

  let current = null;

  const seen = new Set();

  for (const rawLine of lines) {

    const line = rawLine.trim();

    if (line.startsWith("#EXTINF")) {

      const rawName =
        line.match(/,(.*)$/)?.[1]?.trim() ||
        "Kanal";

      const name = normalizeName(rawName);

      const group = normalizeGroup(
        line.match(/group-title="([^"]+)"/)?.[1] || ""
      );

      current = {

        id: slugify(name),

        name,

        group,

        stream: "",

        tvgName:
          line.match(/tvg-name="([^"]+)"/)?.[1] || rawName,

        tvgLogo:
          line.match(/tvg-logo="([^"]+)"/)?.[1] || ""

      };

    }

    else if (
      current &&
      /^https?:\/\//i.test(line)
    ) {

      current.stream = line;

      if (!seen.has(current.id)) {

        seen.add(current.id);

        channels.push(current);

        grouped[current.group].push(current);

      }

      current = null;

    }

  }

  return channels;

}

/* =========================================================
   GETTER
========================================================= */

loadM3U();

module.exports = {

  loadM3U,

  getChannels: () => channels,

  getGroups: () => grouped,

  getChannel: id =>
    channels.find(c => c.id === id)

};
