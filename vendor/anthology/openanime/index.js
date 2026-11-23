const site = "https://openani.me";
const headers = { Referer: site + "/", Origin: site, "Client-Protocol-Model": "RCSA-14402/05" };
const key = title => String(title || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

async function read(url) {
  try {
    const r = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(2800) });
    return r.ok ? JSON.parse((await r.text()).split("\n")[0]) : null;
  } catch {
    return null;
  }
}

async function getStreams({ details, season, episode }) {
  const titles = [...new Set([details.englishTitle, details.name, details.original_name].filter(Boolean))];
  const expected = new Set(titles.map(key));
  const results = await Promise.all(titles.map(title => read("https://api.openani.me/anime/search?q=" + encodeURIComponent(title))));
  const slugs = new Set(results.flatMap(result => Array.isArray(result) ? result : [])
    .filter(item => /^[a-z0-9-]+$/i.test(item?.slug || "") &&
      [item.english, item.romaji, item.turkish].some(title => expected.has(key(title))))
    .map(item => item.slug));
  if (slugs.size !== 1) return [];
  const [slug] = slugs;
  const page = site + "/anime/" + slug + "/" + season + "/" + episode;
  const payload = await read(page + "/__data.json");
  const tables = (payload?.nodes ?? []).map(node => node?.data).filter(Array.isArray);
  const cdn = tables.flat().find(value => typeof value === "string" &&
    /^https:\/\/[a-z0-9-]+\.(?:yeshi|zyapbot)\.eu\.org(?:\/animes)?\/?$/i.test(value));
  if (!cdn) return [];
  const origin = new URL(cdn).origin;
  const files = new Map();
  for (const table of tables) {
    for (const entry of table) {
      if (!Number.isInteger(entry?.file) || !Number.isInteger(entry?.resolution)) continue;
      const file = table[entry.file];
      if (typeof file === "string" && /^[a-z0-9_-]+\.mp4$/i.test(file)) files.set(file, Number(table[entry.resolution]));
    }
  }
  return [...files].slice(0, 6).map(([file, height]) => ({
    videoHeights: [height],
    url: origin + "/animes/" + slug + "/" + season + "/" + file,
    headers: { Referer: site + "/", Origin: site }
  }));
}

module.exports = { getStreams };
