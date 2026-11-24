const { getFilmPlaylistStreams } = require("./film-playlist");
const { getPlaylistStreams, getMetvSeriesStreams, titleKey } = require("./playlist");
const { getMovieStreams } = require("./izlefilm");
const registry = require("../vendor/anthology/providers.json");
const { getLocalIzlelanJobs } = require("./izlelan-adapter");
const { enrichStreams, describe, inspect } = require("./stream-metadata");
const { findYouTubeStreams } = require("./youtube");

const MAX_ACTIVE_SEARCHES = 8;
const LOAD_TIMEOUT_MS = 3000;
const BACKGROUND_TIMEOUT_MS = 45000;
const CACHE_TTL_MS = 120000;
const MAX_CACHE_ENTRIES = 128;
const cache = new Map();
const ongoing = new Map();

function parseRequest(type, id) {
  const match = /^(tmdb:[1-9]\d{0,9}|tt\d{5,12}|[1-9]\d{0,9})(?::(\d{1,3}):([1-9]\d{0,3}))?$/i.exec(id);
  if (!match || (type === "movie" && match[2] !== undefined) ||
      (type === "series" && match[2] === undefined)) return null;
  return { id: match[1].toLowerCase(), season: Number(match[2]), episode: Number(match[3]) };
}

async function findTmdb(type, id, language = "tr-TR", timeout = 3500) {
  const query = new URLSearchParams({ api_key: process.env.TMDB_API_KEY, language });
  const apiType = type === "series" ? "tv" : "movie";
  const isImdb = id.startsWith("tt");
  if (isImdb) query.set("external_source", "imdb_id");
  else if (type === "movie") query.set("append_to_response", "external_ids");
  const resource = isImdb ? "find/" + id : apiType + "/" + id.replace(/^tmdb:/, "");
  const response = await fetch("https://api.themoviedb.org/3/" + resource + "?" + query, {
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) return null;
  const data = await response.json();
  return isImdb ? data[apiType + "_results"]?.[0] : data;
}

const providerKey = Symbol("provider");
function cleanStream(stream, provider) {
  if (!stream || typeof stream.url !== "string" || !/^https?:\/\//i.test(stream.url)) return null;
  const headers = stream.behaviorHints?.proxyHeaders?.request ?? stream.behaviorHints?.headers ?? stream.headers;
  const { notWebReady, bingeGroup, proxyHeaders, filename } = stream.behaviorHints ?? {};
  const format = String(stream.format ?? stream.type ?? "").toLowerCase();
  const adaptiveFilename = stream.isHls === true || /^(?:hls|m3u8)$/.test(format) || /#\.m3u8$/i.test(stream.url)
    ? "stream.m3u8"
    : /^(?:dash|mpd)$/.test(format) ? "stream.mpd" : undefined;
  const playbackFilename = filename || adaptiveFilename;
  const subtitles = Array.isArray(stream.subtitles)
    ? stream.subtitles.filter(subtitle => typeof subtitle?.url === "string" && /^https?:\/\//i.test(subtitle.url))
      .map(subtitle => ({
        ...subtitle,
        lang: [subtitle.lang, subtitle.language, subtitle.label].find(value => typeof value === "string" && value.trim()) || "und"
      }))
    : undefined;
  return {
    [providerKey]: provider,
    ...(provider === "ME TV Medya" && stream.metvVariant && { metvVariant: stream.metvVariant }),
    name: "Yayın",
    ...(stream.description || stream.quality ? { description: stream.description || stream.quality } : {}),
    ...(stream.quality && { quality: stream.quality }),
    ...(stream.title && stream.title !== provider && { title: stream.title }),
    ...((stream.sourceTitle || (stream.name && stream.name !== provider && stream.name !== "Yayın" && stream.name !== "Stream" ? stream.name : "")) && {
      sourceTitle: stream.sourceTitle || stream.name
    }),
    ...(stream.format && { format: stream.format }),
    ...(Array.isArray(stream.audioLangs) && { audioLangs: stream.audioLangs }),
    url: stream.url,
    ...(subtitles && { subtitles }),
    behaviorHints: {
      notWebReady: notWebReady ?? true,
      ...(playbackFilename && { filename: playbackFilename }),
      ...(bingeGroup && { bingeGroup }),
      ...((headers || proxyHeaders?.response) && {
        proxyHeaders: { ...(headers && { request: headers }), ...(proxyHeaders?.response && { response: proxyHeaders.response }) }
      })
    }
  };
}

async function runProvider(provider, lookup, type) {
  try {
    const result = await Promise.resolve().then(lookup);
    if (!Array.isArray(result)) return [];
    const streams = result.map(stream => cleanStream(stream, provider)).filter(Boolean);
    if (result.length && !streams.length) console.warn("[TATA VOD]", provider, type, "invalid-stream-url");
    return streams;
  } catch (error) {
    console.warn("[TATA VOD]", provider, type, error.name);
    return [];
  }
}

// Full-length uploads from the series' and producers' official YouTube channels.
const youtubeSeries = [
  {
    ids: ["65556", "tt3142876"],
    title: "Çalıkuşu",
    year: "2013",
    episodes: {
      "1:1": "d1glHUTqIgY",
      "1:2": "dkbmd2r7xoI",
      "1:3": "78GEJgtjty0",
      "1:4": "Wql3QY901nQ",
      "1:5": "PTsUarjiSHw",
      "1:6": "T5Eec-wtsp0",
      "1:7": "OZUkjI9p5AA",
      "1:8": "HJzKW_FS2m4",
      "1:9": "Z6PhfnCvIEs",
      "1:10": "xdAFBE--Hqg",
      "1:11": "xN6ThbEzKrw",
      "1:12": "nY9wXcpURqw",
      "1:13": "AsVfo5bZsFk",
      "1:14": "sJRfjlbJvXU",
      "1:15": "PuuXVM4Ofrc",
      "1:16": "lQnbvefuzP4",
      "1:17": "oom1MwHQZOs",
      "1:18": "f2Vjr3Vo3SY",
      "1:19": "LCN_UuKyYj8",
      "1:20": "cP2mfv93F8w",
      "1:21": "hZyDacgtNos",
      "1:22": "oX6kdAYioT0",
      "1:23": "S3ffFRMa85o",
      "1:24": "36a-Xsf_LBY",
      "1:25": "dcWAbirWklk",
      "1:26": "6ND684_tKP4",
      "1:27": "nH5lmBW0pco",
      "1:28": "CQLrHFvSpmM",
      "1:29": "tKkQjAJpzUk",
      "1:30": "Sq7IzkL08PY",
    },
  },
  {
    ids: ["34899", "tt1848220"],
    title: "Muhteşem Yüzyıl",
    year: "2011",
    episodes: {
      "1:1": "JBaYiSyH3CY",
      "1:2": "qzAiRaCi0SI",
      "1:3": "6LSagipUf50",
      "1:4": "PM4UwFbqWms",
      "1:5": "37piLFXvizg",
      "1:6": "d6mrFMLXgiE",
      "1:7": "dPxZe6EYE1c",
      "1:8": "PH5zzh-xxEY",
      "1:9": "2YjEo64U4n4",
      "1:10": "t2xOKg5vIDY",
      "1:11": "EeuCs8YPEQc",
      "1:12": "eEvaE5frugQ",
      "1:13": "Bro_AHWDbI4",
      "1:14": "Z_p1QP4hUTQ",
      "1:15": "FEBB3idL-vE",
      "1:16": "VwhaQZr3PcQ",
      "1:17": "mFwES_sUU-U",
      "1:18": "rkJPdBkC12Y",
      "1:19": "pYGn83lKC-A",
      "1:20": "0WWUih9rBnI",
      "1:21": "ZmmVo4ELBQk",
      "1:22": "qpcAtAHJdLA",
      "1:23": "o5OsVuENHN8",
      "1:24": "vywplOxAwLk",
      "2:1": "FwwItlMwsDk",
      "2:2": "5PRP_88Mkbo",
      "2:3": "SaKLFjLj3hg",
      "2:4": "j-QUn8ahvLc",
      "2:5": "DT5-bFGERjI",
      "2:6": "qJETdj4fVH4",
      "2:7": "-mHl6rdLDEU",
      "2:8": "3WwumuH43x0",
      "2:9": "xjfvG-jE9dY",
      "2:10": "bXR27n_yhwM",
      "2:11": "UoAaEjSv11A",
      "2:12": "MxgmqtUTIPQ",
      "2:13": "EJQ1ZYyV_Eo",
      "2:14": "7CxO48bLR7w",
      "2:15": "_8CRS7TM3I4",
      "2:16": "f0j-08N8-jg",
      "2:17": "K8Czmj36Enw",
      "2:18": "V6Fnx-z7yWg",
      "2:19": "xmnp0qobEX8",
      "2:20": "Zv5Pv5qx_us",
      "2:21": "AKniaOUA0Kg",
      "2:22": "dglW_uqhsjQ",
      "2:23": "KkUEI8ZTQrs",
      "2:24": "Ln-rTh9LLzE",
      "2:25": "e86L5CHeg4o",
      "2:26": "PJnj8buAMuw",
      "2:27": "w2dXdqGnLjA",
      "2:28": "hYGQLCf8pWU",
      "2:29": "IlodPKsHfrk",
      "2:30": "fxKy9okQVx0",
      "2:31": "esNO9lAqbV4",
      "2:32": "ne_7QzbjCI8",
      "2:33": "odh2Vpi2NuQ",
      "2:34": "gjpRxmrGb70",
      "2:35": "rWHtj_uxeW8",
      "2:36": "EOpw6RCbbJ8",
      "2:37": "nhIOnw6XO4I",
      "2:38": "tYqQ192i3qA",
      "2:39": "gmZ1nCyZha8",
      "3:1": "QZnfTW61hN0",
      "3:2": "RN79GJEbub4",
      "3:3": "0Ql4oAARisw",
      "3:4": "my6Ogb4TXUk",
      "3:5": "V1aPk2REpEA",
      "3:6": "Vcsf1ePFnbU",
      "3:7": "juj_PbnZMX0",
      "3:8": "sCAVHzbMzUA",
      "3:9": "fuDwCwSXD5o",
      "3:10": "s_gAgh6cx5I",
      "3:11": "XFBaCPr32AE",
      "3:12": "zLyoha7C1Zo",
      "3:13": "gAkAl4pu3Wk",
      "3:14": "QL0J3XnozdE",
      "3:15": "LmcQkhlmEzA",
      "3:16": "uiRO2hPnj4M",
      "3:17": "Qw4fKjQEVcs",
      "3:18": "0eVJFCmU7j4",
      "3:19": "rAEg-HAnLBc",
      "3:20": "jl7rFj028N8",
      "3:21": "1CAPC_LvxxE",
      "3:22": "QBI5kR8U8ew",
      "3:23": "hZMJrM2QFCc",
      "3:24": "SyRATtfJa-M",
      "3:25": "NbPVbQxf6Mc",
      "3:26": "4BmBDmC9Y-s",
      "3:27": "NztJ30gX6AE",
      "3:28": "a7cOLmmg9jM",
      "3:29": "8nDovMy1K-4",
      "3:30": "CSXuaPGnF68",
      "3:31": "7cYxlE-2Y7I",
      "3:32": "TRcgsTrMKsU",
      "3:33": "N3mPFCYu9HM",
      "3:34": "B_Oko6_W1zg",
      "3:35": "71qsXX-BYHM",
      "3:36": "KJU-ymk6Rcc",
      "3:37": "Tdg4on6vtqs",
      "3:38": "8V76tAg_2eQ",
      "3:39": "HoYwtWszlzI",
      "3:40": "f14JOWn7srQ",
      "4:1": "Z4X-gWCi8sA",
      "4:2": "d0ufZ46bhj0",
      "4:3": "qWJrhPRYnGg",
      "4:4": "D2fZp-PQVI4",
      "4:5": "r-DzLB47R68",
      "4:6": "kDlShi-M0Ok",
      "4:7": "iznRiR_03fk",
      "4:8": "N8UPAQOYRyk",
      "4:9": "BkFPPjPiydg",
      "4:10": "HwhdUikUcFA",
      "4:11": "0tiy8MV0vdw",
      "4:12": "TJzD-HtLZNM",
      "4:13": "hKLZd4_REnc",
      "4:14": "NtGi7Os4nrg",
      "4:15": "sXHmYK1lCyE",
      "4:16": "WLrhqoKkJPM",
      "4:17": "3GoZGtz6-Sw",
      "4:18": "negFFtXL81g",
      "4:19": "RYl-JkTHsjc",
      "4:20": "jdM0DRpbGaA",
      "4:21": "s47SZar-RKs",
      "4:22": "-cJL1n8UIjY",
      "4:23": "RXfh5uM5bFI",
      "4:24": "UwUcGNAN0z0",
      "4:25": "q5LbzNU-KMM",
      "4:26": "Tgyc4fzSkiQ",
      "4:27": "M-3ko4DHKtE",
      "4:28": "IzgX9lUySe4",
      "4:29": "UbNvUNrnVQg",
      "4:30": "DBZzJUuWKFk",
      "4:31": "jJRHJYYmTko",
      "4:32": "XXW725YozRY",
      "4:33": "HHXKp-rAq7E",
      "4:34": "ATZ11hxr4JE",
      "4:35": "my_UXEH94Lk",
      "4:36": "fpXHA6WX81s",
    },
  },
  {
    ids: ["49340", "tt0302199"],
    title: "Tatlı Hayat",
    year: "2001",
    episodes: {
      "1:1": "5RYuMOpmt9A",
      "1:2": "xGLHjTDhyN8",
      "1:3": "xY5Rd1yZPow",
      "1:4": "7Rb0oGvl1Kk",
      "1:5": "BOFTh-iLDYI",
      "1:6": "MDj8xoOywnw",
      "1:7": "IgHjS3MTIAA",
      "1:8": "HuqaFlqctXU",
      "1:9": "eGKEdIzSX2A",
      "1:10": "OANMiyFRvzU",
      "1:11": "Wx8Vk1Hcx8M",
      "1:12": "Q6Z7NuFj3nI",
      "1:13": "O54JFulDmUM",
      "1:14": "fnHKhzsoyQk",
      "1:15": "uEV62o6qdzY",
      "1:16": "LO2wnrKEmYI",
      "1:17": "Lredr2x3brg",
      "1:18": "n9tzroK4J30",
      "1:19": "U_4nnp3Wm6U",
      "1:20": "5TeIKBvldCA",
      "1:21": "cMUrG0YqtXs",
      "1:22": "aXRLg1G4x8M",
      "1:23": "pVrzEDyB-PM",
      "1:24": "7tX3TgmHYRE",
      "1:25": "mYYuuLCKZ4g",
      "1:26": "IiKOlvsrR9s",
      "1:27": "DD0wrGpsejs",
      "1:28": "bJ4D0NqlhOY",
      "1:29": "ciDVEtA1oBU",
      "1:30": "fhoegAeOeKM",
      "1:31": "qoVQhZ8Cs-A",
      "1:32": "FRoRdKPJ_Mc",
      "1:33": "jiJzgQCkUQ8",
      "1:34": "UGK3-ffvhXk",
      "1:35": "-Op1Ng3Jb04",
      "2:1": "KqN0tJzryYA",
      "2:2": "nkwcVwMSHq8",
      "2:3": "4UO8_gViA3g",
      "2:4": "nBECn2NIjds",
      "2:5": "3CQopZ0FLXQ",
      "2:6": "3mUnhLHbuKA",
      "2:7": "UVS2x5Boec4",
      "2:8": "uRIsed4uTwE",
      "2:9": "RZGwdTedWU4",
      "2:10": "U2YJO0vVpnc",
      "2:11": "6FRdPthbNv0",
      "2:12": "yvMuBdwwGWk",
      "2:13": "cMOFnCqFr_s",
      "2:14": "siOEJU8DeZw",
      "2:15": "TZuW5OBVIKk",
      "2:16": "YLrlSwShlLs",
      "2:17": "ruj8-kQbBLE",
      "2:18": "Hvlm_c5RNWw",
      "2:19": "QOw5FgzvBis",
      "2:20": "T7LlzHdLGuY",
      "2:21": "F8cCp6OF3_Y",
      "2:22": "pF92eUH3To4",
      "2:23": "hlwRoL8I1cE",
      "2:24": "yBBv-98-FkY",
      "2:25": "481xUire0kU",
      "2:26": "2KsT7wBc-C4",
      "2:27": "7FzpS6G23ko",
      "2:28": "HqIU5kS6-5U",
      "2:29": "RwbtlfQzQQk",
      "2:30": "JtyYwL64OuQ",
      "2:31": "m49ykRGM8uY",
      "2:32": "eB1sLK5yk-8",
      "2:33": "F7krXk4rtyc",
      "2:34": "lpPNKU2nQu0",
      "2:35": "pM_fZRaecTQ",
      "2:36": "dCgfgnGu-38",
      "2:37": "RuNQT45u888",
      "2:38": "w_DwF41gt9E",
      "2:39": "odoqEuPhVfQ",
      "2:40": "icUDvpjdYMw",
      "2:41": "p4XenZP4YXs",
      "2:42": "eog5kLmbh0c",
      "2:43": "2uK2HkNCEjM",
      "2:44": "hvB2GB5doYQ",
      "2:45": "NqcUyDLpaSQ",
      "2:46": "UK2CBH2zhBw",
      "2:47": "Y2r1ysDSAXo",
      "2:48": "s0ZKs5aoR2w",
      "2:49": "0Iw1JohC4Hg",
      "2:50": "Idnp4Gw0vYg",
      "2:51": "dEbv9EZfrXc",
      "2:52": "T1h3cp95p-4",
      "2:53": "Jf1ofVaV4i4",
      "2:54": "v6azuceAGYI",
      "2:55": "h6FdMdGr-J8",
      "2:56": "tsTrdmE9a8o",
      "2:57": "tHwhbx5ALHI",
      "2:58": "Xhoq9MW8iy8",
      "2:59": "zIEmLOVd0tg",
      "2:60": "RLvxDGMRPJA",
      "2:61": "JWDw4wxwvVw",
      "2:62": "VqxS9Ulj1bw",
      "2:63": "MzuTKVFLX48",
      "2:65": "8qC_WLm0_OU",
      "2:66": "LRtBurLUGZ4",
      "2:67": "LJXoVS7pHkM",
      "2:68": "R_hH-sy1tJM",
      "2:69": "EFwh6-iaG5o",
      "2:70": "nf9Jnv7wK8w",
      "2:71": "kXQ-JzC_Cpk",
    },
  },
  {
    ids: ["40417", "tt1831164"],
    title: "Leyla ile Mecnun",
    year: "2011",
    episodes: {
      "1:1": "yK3dj4v3t6k",
      "1:2": "El53LO9CpMc",
      "1:3": "3Yt0V-azaoQ",
      "1:4": "iI3Fm0JJA84",
      "1:5": "942WjgyhF1s",
      "1:6": "OXgWO_o9mM0",
      "1:7": "J5-StCjoLSY",
      "1:8": "XkaXFvxkPn4",
      "1:9": "5ZljSGMvK0A",
      "1:10": "dHmL1uBfmOA",
      "1:11": "Zgpdu4by5j4",
      "1:12": "Lj4F3swNZj4",
      "1:13": "Etj-81viHGw",
      "1:14": "Ay46v16dz-4",
      "1:15": "NIYsxx3bu2E",
      "1:16": "3YXWikDA8_4",
      "1:17": "tax2G8xrZNw",
      "1:18": "dw5nv5DPPW4",
      "1:19": "CApZl9NyoUg",
      "1:20": "1afj0rLe9gg",
      "2:1": "PxS2g3AbHps",
      "2:2": "-qQfiuTgK7Y",
      "2:3": "r6YBpH0fLDs",
      "2:4": "PlO10FaF2RE",
      "2:5": "qepSFEtAhvc",
      "2:6": "KP1D88rFkNY",
      "2:7": "CfDNS1cIang",
      "2:8": "2ifN45R0zp4",
      "2:9": "-IRKLamoQZM",
      "2:10": "9FrYRkToK6E",
      "2:11": "hbdfGelIqTM",
      "2:12": "pnOom-3rpjI",
      "2:13": "WfFmvBkCqLw",
      "2:14": "pU1U9CFYlj0",
      "2:15": "sQGQaS1wKZU",
      "2:16": "fJLsbsimaRI",
      "2:17": "fdH4NsIgFYA",
      "2:18": "EG8lLTxU32k",
      "2:19": "DFVISelEWt8",
      "2:20": "kqpWrk1eU4E",
      "2:21": "Z9tEO0cTkJE",
      "2:22": "WOb4-IXttew",
      "2:23": "dsZdYyQFgA4",
      "2:24": "ydvE5iEXQIY",
      "2:25": "8a1aKcSrdh8",
      "2:26": "3Xwl4mx0LhM",
      "2:27": "gjRhbCjhWGw",
      "2:28": "TajDwUrZFQI",
      "2:29": "S1srF0vTGaY",
      "2:30": "QyFHOGbjY5E",
      "2:31": "_T-YDGhm5JE",
      "2:32": "IWhWEMEzDf8",
      "2:33": "zT8sxuq7jIk",
      "2:34": "wYZ2866N8F8",
      "2:35": "IM4rRPkcLmg",
      "2:36": "tI31wKTRAm0",
      "2:37": "EcZpdIJVpb0",
      "2:38": "_rVC0eAre7Y",
      "2:39": "QP-Fi1YWbkg",
      "2:40": "B4V366fjZDs",
      "2:41": "xqsR0MBU2Ys",
      "3:1": "WBxg8QrrOSw",
      "3:2": "aas-lXdxjJ4",
      "3:3": "GMHRh0WqZBE",
      "3:4": "TvVa4z1nZOg",
      "3:5": "OxcFMRtxaXA",
      "3:6": "08ptjBrh9Js",
      "3:7": "SMoWIJ5eKS4",
      "3:8": "_zjFcJNcwhA",
      "3:9": "hS6kZqhH1cI",
      "3:10": "snVFKWCEnKQ",
      "3:11": "FQ7Kt7gk1UA",
      "3:12": "XzNHO94hxRY",
      "3:13": "0znpWXs-LtQ",
      "3:14": "iTfet04XndA",
      "3:15": "DWnZr8ZYmMI",
      "3:16": "cAc4qhW5GEU",
      "3:17": "JoQgBT9oeL8",
      "3:18": "to_6BzxO40s",
      "3:19": "FTGtlNS1gbs",
      "3:20": "jkFiYsvwAfI",
      "3:21": "0KbhwjsxGc0",
      "3:22": "bhw-x7XQsz4",
      "3:23": "r2DuA5zwX8k",
      "3:24": "YPne8yNlFgM",
      "3:25": "d4YGBGlP5PE",
      "3:26": "5rPnE4OM6tc",
      "3:27": "i7IhYw9PJfM",
      "3:28": "PF0FK4bvAXI",
      "3:29": "SUH7M6Q-au4",
      "3:30": "buIkKSw5oOU",
      "3:31": "dYZrd9UXx1o",
      "3:32": "lkIO8gp4zEc",
      "3:33": "Hqr0UaGJy1A",
      "3:34": "M2UqB6IVXbs",
      "3:35": "xybz-m9fK98",
      "3:36": "XRQDyl4vzKA",
      "3:37": "udg6kGTakKg",
      "3:38": "QsXeysn9q88",
      "3:39": "jUy9d7MQ4xc",
      "3:40": "HcJucZf0xuc",
      "3:41": "iiOw5PjTz9s",
      "3:42": "sd03ltZpx8M",
      "3:43": "z0ynFYyHmSM",
    },
  },
  {
    ids: ["44761", "tt0264700"],
    title: "İkinci Bahar",
    year: "1998",
    episodes: {
      "1:1": "u5hnBZoO0Fk",
      "1:2": "5U7SY_nEC1U",
      "1:3": "Dofa0ZORGIs",
      "1:4": "xC-TRXbv_hk",
      "1:5": "EOaU5RpTso8",
      "1:6": "xPxqcs4ZKpg",
      "1:7": "wzoglmWFyto",
      "1:8": "QclXpyEiBbw",
      "2:1": "XC63rmW8IU0",
      "2:2": "vlN4PjvNUM8",
      "2:3": "LjxAcTY_iqg",
      "2:4": "6m07_zx5JlM",
      "2:5": "KhR2oQW0ook",
      "2:6": "np2pCdQS4rk",
      "2:7": "MdXoyxfMO1s",
      "2:8": "VR5ZFDCHMR8",
      "2:9": "l2fVrVv5F4w",
      "2:10": "zYsVUn5UVV4",
      "2:11": "EKTOSdip3rY",
      "2:12": "N8jEynTVkho",
      "2:13": "3cJQEAbd4Pg",
      "2:14": "fRrjmRR9mdo",
      "2:15": "ddbQ-9UFDPg",
      "3:1": "EkpH4IOoApo",
      "3:2": "w05I6QCpblQ",
      "3:3": "o8pJKy8kUNg",
      "3:4": "3IkIDZwGV6I",
      "3:5": "DX0ln6-x1h4",
      "3:6": "xxMPSwae7fE",
      "3:7": "GyZbiV7uYho",
      "3:8": "sVx-cBbC_l8",
      "3:9": "mdQYI0uzz44",
      "3:10": "IQCcs127oZI",
      "3:11": "8UEnImxNXaw",
      "3:12": "Um88Nm4Xj0U",
      "3:13": "3o_K_m9IXCg",
      "3:14": "Aen2YZNl3xc",
    },
  },
  { ids: ["32519", "tt1534360"], title: "Ezel", year: "2009",
    episodes: {"1:1":"T6UZhrunjSo","1:2":"4tulyH8Y91Q","1:3":"Jqm1MDxUNlo","1:4":"yl-iudreN-g","1:5":"TFjjfXJ9ojA","1:6":"6UOKx0PN8SA","1:7":"3HKbPaVJdHc","1:8":"JkVmwURfbZk","1:9":"q51gAOF7_P8","1:10":"qguf6giAFCg","1:11":"Tfwe8DJ6b4I","1:12":"gfT9SITvE3M","1:13":"w7BPGxjolrs","1:14":"FQxSrdWQbEo","1:15":"xvQMt9HiG4A","1:17":"w-wRMzMn6qU","1:18":"h4RopbsiSB4","1:19":"DBaP104n1h0","1:20":"eLUAd79XBr0","1:21":"3-I05yXRqI0","1:22":"o-3takMegcQ","1:23":"zeJczALttXU","1:24":"nK7dm5tzqiM","1:25":"ALIUflBdufw","1:26":"8x1S_u2l4ho","1:27":"P-7HmIfeLMI","1:28":"NG9H8LUynss","1:29":"QbfysxB-8QE","1:30":"Owz1RzIlBlg","1:31":"Plyw6wBtZes","1:32":"xq2Mi829nUA","2:1":"v4aS0GZKDto","2:3":"BB8JXsUz2wE","2:4":"T2OWCV4MLwc","2:5":"OhcVR71Y0j8","2:6":"8R9VubnGbos","2:7":"ebwSq7o2caI","2:8":"ZQuqGX4_hfs","2:9":"T8DBgllWHI4","2:10":"g0GkFahZd9s","2:11":"7OilsFQKlVw","2:12":"y94sH-Z7wJE","2:13":"h1DBLm_3rD8","2:14":"wUUAyhSU7lg","2:15":"5ghh5wU3d50","2:16":"47yVO6qZSko","2:17":"d6TFwq-yjKM","2:18":"X_beWVH_Ivo","2:19":"IWMzM123cI0","2:20":"GFWaIwJmLF0","2:21":"uGChILKue6M","2:22":"-IOEQLllM5U","2:23":"5y_cXJ02h88","2:24":"04Yf6X1J_c4","2:25":"5FUuV_8obVg","2:26":"sZlYB3ux0EM","2:27":"KaUN_1P4uJY","2:28":"2TAGbSWLUeo","2:29":"A2HFOc8jwDo","2:30":"FriFNqR1S5M","2:31":"TodXUxWs5UM","2:32":"gpfzDe284X0","2:33":"tnKugzIhm1Y","2:34":"afSba-e8Go4","2:35":"xhpO5vgKUUc","2:36":"-LNRjb9aNQU","2:37":"cE7kjEXsw08","2:38":"bGuffAKOZ6s","1:16":"lHQJuM03K70","2:2":"E0sRzb8rbY8"} },
  { ids: ["32836", "tt0845088"], title: "Arka Sokaklar", year: "2006", youtubeChannel: "UCJBBp-6JoqjOeLzTxzol_7A",
    episodes: { "1:1": "TBBRBD8Fudg", "1:2": "JjVOWBu4z48", "1:3": "AF7o7S8TBiQ" } },
  { ids: ["tt2361816"], title: "Seksenler", year: "2012", youtubeChannel: "UCYRPB4TbD2RYHlIQdLgEeYA",
    episodes: { "1:1": "Wn5piPtkki0" } }
];

const youtubeMovies = [
  { titles: ["Hababam Sınıfı", "The Chaos Class"], year: "1975", ytId: "hf2-8MRPGu8" },
  { titles: ["Süt Kardeşler", "The Foster Brothers"], year: "1976", ytId: "KRy20M7uQM4" },
  { titles: ["Neşeli Günler", "Happy Days"], year: "1978", ytId: "FQ_7cabWOv0" },
  { titles: ["Baskın"], year: "1977", ytId: "HIWwTWZP1H8" }
];

function getYouTubeStreams(type, request, details) {
  let ytId;
  if (type === "series") {
    const id = request.id.replace(/^tmdb:/, "");
    const show = youtubeSeries.find(item => item.ids.includes(id) || (details?.first_air_date?.slice(0, 4) === item.year &&
      [details.name, details.original_name].map(titleKey).includes(titleKey(item.title))));
    ytId = show?.episodes[request.season + ":" + request.episode];
  } else if (details) {
    const names = [details.title, details.original_title].map(titleKey);
    ytId = youtubeMovies.find(item => item.year === details.release_date?.slice(0, 4) &&
      item.titles.some(title => names.includes(titleKey(title))))?.ytId;
  }
  return ytId ? [{ name: "YouTube", ytId, description: "Ses: 🇹🇷" }] : [];
}

async function finishYouTube(lookup, deadline) {
  if (!lookup) return [];
  let timer;
  try {
    return await Promise.race([lookup, new Promise(resolve => {
      timer = setTimeout(() => resolve([]), Math.max(0, deadline - Date.now()));
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function search(type, request, publish, remove) {
  const deadline = Date.now() + BACKGROUND_TIMEOUT_MS;
  const knownYouTubeStreams = getYouTubeStreams(type, request);
  publish(knownYouTubeStreams);
  const knownShow = type === "series" && youtubeSeries.find(item => item.ids.includes(request.id.replace(/^tmdb:/, "")));
  const earlyYouTube = !knownYouTubeStreams.length && knownShow && process.env.YOUTUBE_DATA_API_KEY
    ? findYouTubeStreams(type, { id: knownShow.ids[0], name: knownShow.title, youtubeChannel: knownShow.youtubeChannel }, request)
    : undefined;
  const details = await findTmdb(type, request.id, "tr-TR", 3500).catch(error => {
    if (!knownYouTubeStreams.length && !earlyYouTube) throw error;
    console.warn("[TATA VOD] YouTube series metadata", error.name);
    return null;
  });
  if (!details?.id) { if (earlyYouTube) publish(await finishYouTube(earlyYouTube, deadline)); return; }
  const youtubeStreams = knownYouTubeStreams.length ? knownYouTubeStreams : getYouTubeStreams(type, request, details);
  publish(youtubeStreams);
  const genres = details.genre_ids ?? details.genres?.map(genre => genre.id) ?? [];
  const isAnimation = genres.includes(16);
  const providers = registry.filter(provider => provider[type] && (!provider.anime || isAnimation) &&
    (provider.credentials ?? []).every(key => process.env[key]));
  const animeDetails = isAnimation
    ? findTmdb(type, String(details.id), "en-US", 1800)
      .then(english => ({ ...details, englishTitle: english?.name ?? english?.title }))
      .catch(() => details)
    : Promise.resolve(details);
  const jobs = providers.map(provider => runProvider(provider.name, () => {
    const { getStreams } = require("../vendor/anthology/" + provider.id + "/index.js");
    const id = String(details.id);
    if (provider.metadataArgs) return (provider.anime ? animeDetails : Promise.resolve(details))
      .then(metadata => getStreams({ details: metadata, type, season: request.season, episode: request.episode }));
    if (provider.objectArgs) return getStreams({ id, type, season: request.season, episode: request.episode });
    return getStreams(id, type === "series" ? "tv" : "movie", request.season, request.episode);
  }, type));
  if (type === "series" && (process.env.TATA_SERIES_M3U_PATH || process.env.TATA_SERIES_M3U_KEY)) {
    jobs.unshift(runProvider("TATA M3U", async () =>
      getPlaylistStreams(await animeDetails, request.season, request.episode), type));
  }
  if (type === "series") {
    jobs.push(runProvider("ME TV Medya", async () =>
      getMetvSeriesStreams(await animeDetails, request.season, request.episode), type));
  }
  if (type === "movie") {
    jobs.push(runProvider("ME TV Medya", () => getFilmPlaylistStreams("metvCinema", details, request.id), type));
    jobs.unshift(runProvider("İzlefilm", () => getMovieStreams(details), type));
    if (process.env.TATA_EXTRA_FILM_M3U_KEY) {
      jobs.unshift(
        runProvider("TATA M3U · Filmler", () => getFilmPlaylistStreams("fullmovies", details, request.id), type),
        runProvider("TATA M3U · RecTV", () => getFilmPlaylistStreams("rectv", details, request.id), type),
        runProvider("TATA M3U · PixelDrain", () => getFilmPlaylistStreams("pixeldrain", details, request.id), type),
        runProvider("TATA M3U · ImgsAPI", () => getFilmPlaylistStreams("imgsapi", details, request.id), type)
      );
    }
    jobs.push(runProvider("Power Sinema", () => getFilmPlaylistStreams("powerCinema", details, request.id), type));
    if (process.env.TATA_FILM_M3U_KEY) {
      jobs.unshift(
        runProvider("TATA M3U · FullHD", () => getFilmPlaylistStreams("fullhdfi", details, request.id), type),
        runProvider("TATA M3U · Vixolity", () => getFilmPlaylistStreams("vixolity", details, request.id), type)
      );
    }
  }
  for (const source of getLocalIzlelanJobs()) {
    jobs.push(runProvider(source.name, () => source.getStreams(String(details.id), type === "series" ? "tv" : "movie", request.season, request.episode), type));
  }
  const discoveredYouTube = finishYouTube(earlyYouTube ?? (!youtubeStreams.length && process.env.YOUTUBE_DATA_API_KEY
    ? findYouTubeStreams(type, details, request) : undefined), deadline);
  await Promise.allSettled([
    discoveredYouTube.then(publish),
    ...jobs.map(async job => {
      const result = await job;
      publish(result.map(stream => describe(stream, {}, details.original_language)));
      if (result.length) {
        const enriched = await enrichStreams(result, details.original_language, { deadline, onInvalid: remove }).catch(() => []);
        publish(enriched);
      }
    })
  ]);
}

async function getVodStreams(type, id) {
  if (!["movie", "series"].includes(type)) return [];
  const request = parseRequest(type, id);
  if (!request) return [];
  const key = type + ":" + id;
  let entry = cache.get(key);
  if (entry && !ongoing.has(key) && Date.now() - entry.updated > CACHE_TTL_MS) {
    cache.delete(key);
    entry = undefined;
  }
  if (!entry) {
    if (ongoing.size >= MAX_ACTIVE_SEARCHES) return getYouTubeStreams(type, request);
    for (const k of cache.keys()) {
      if (cache.size < MAX_CACHE_ENTRIES) break;
      if (!ongoing.has(k)) cache.delete(k);
    }
    entry = { streams: new Map(), rejected: new Set(), updated: Date.now(), accepting: true };
    cache.set(key, entry);
    const publish = results => {
      if (!entry.accepting || !Array.isArray(results)) return;
      for (const stream of results) {
        const identity = stream.url ? "url:" + stream.url : stream.ytId ? "yt:" + stream.ytId : null;
        if (!identity || entry.rejected.has(identity)) continue;
        const previous=entry.streams.get(identity);
        // A late provider's provisional TMDB label must not replace an inspected result.
        const inspected=!!stream.__verifiedAudio;
        if(previous?.__verifiedAudio && !inspected)continue;
        entry.streams.set(identity,stream);
      }
      entry.updated = Date.now();
    };
    const remove = stream => {
      if (!entry.accepting || !stream?.url) return;
      const identity = "url:" + stream.url;
      entry.rejected.add(identity);
      entry.streams.delete(identity);
      entry.updated = Date.now();
    };
    let backgroundTimer;
    const job = Promise.race([
      Promise.resolve().then(() => search(type, request, publish, remove)).catch(error => console.warn("[TATA VOD]", error.name)),
      new Promise(resolve => { backgroundTimer = setTimeout(resolve, BACKGROUND_TIMEOUT_MS); })
    ]).finally(() => {
      clearTimeout(backgroundTimer);
      entry.accepting = false;
      entry.updated = Date.now();
      ongoing.delete(key);
    });
    ongoing.set(key, job);
  }
  if (!entry.streams.size && ongoing.has(key)) {
    let timer;
    await Promise.race([
      ongoing.get(key),
      new Promise(resolve => { timer = setTimeout(resolve, LOAD_TIMEOUT_MS); })
    ]).finally(() => clearTimeout(timer));
  }
  return Array.from(entry.streams.values());
}

module.exports = { getVodStreams };
