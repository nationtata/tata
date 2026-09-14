const { getChannel } = require("../parse-m3u");

/* =========================================================
   ANA YAYINI DÖNDÜR
========================================================= */

async function resolveTata(id) {

  const channel = getChannel(id);

  if (!channel) return null;

  // Önce Ana listeyi bul
  const primary = channel.alternatives.find(
    alt => alt.source === "Ana"
  );

  if (primary) {
    return primary.url;
  }

  // Ana yoksa ilk alternatifi kullan
  if (channel.alternatives.length) {
    return channel.alternatives[0].url;
  }

  return null;

}

/* =========================================================
   TÜM ALTERNATİFLER
========================================================= */

function getAlternatives(id) {

  const channel = getChannel(id);

  if (!channel) return [];

  return channel.alternatives.map((alt, index) => ({
    title:
      index === 0
        ? "▶ Ana"
        : `▶ ${alt.source}`,
    url: alt.url
  }));

}

module.exports = {
  resolveTata,
  getAlternatives
};
