// Candidate metadata must originate from the provider, not the requested TMDB record.
const norm = v => String(v ?? "").normalize("NFKD").toLowerCase().replace(/ı/g,"i").replace(/\p{M}/gu,"").replace(/[^\p{L}\p{N}]/gu,"");
const list = v => (Array.isArray(v) ? v : [v]).filter(Boolean);
function matchesIdentity(expected, candidate) {
  if (!candidate || candidate.type !== expected.type) return false;
  if (expected.type === "series" && (candidate.season !== expected.season || candidate.episode !== expected.episode)) return false;
  let matchedId = false;
  for (const key of ["tmdbId","imdbId"]) {
    if (expected[key] && candidate[key]) {
      if (String(expected[key]) !== String(candidate[key])) return false;
      matchedId = true;
    }
  }
  if (matchedId) return true;
  const names = list(expected.titles).map(norm).filter(Boolean);
  if (!list(candidate.titles).map(norm).some(t => t && names.includes(t))) return false;
  if (!expected.year || String(expected.year) !== String(candidate.year)) return false;
  const countries = list(expected.countries).map(x => String(x).toUpperCase());
  const actual = list(candidate.countries).map(x => String(x).toUpperCase());
  if (!countries.length || !actual.length || !actual.some(x => countries.includes(x))) return false;
  if (expected.originalLanguage && candidate.originalLanguage && expected.originalLanguage !== candidate.originalLanguage) return false;
  return true;
}
module.exports = { matchesIdentity };
