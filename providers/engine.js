const { getChannel } = require("../parse-m3u");
const { checkStream } = require("./health");
const cache = require("./cache");

/* =========================================================
   STREAM DOĞRULAMA
========================================================= */

async function verify(stream) {

  const key = stream.url;

  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const ok = await checkStream(stream.url);

  cache.set(key, ok);

  return ok;

}

/* =========================================================
   TÜM ALTERNATİFLERİ HAZIRLA
========================================================= */

async function resolveChannel(id) {

  const channel = getChannel(id);

  if (!channel) return null;

  const alternatives = [];

  for (const alt of channel.alternatives) {

    const healthy = await verify(alt);

    alternatives.push({

      source: alt.source,

      healthy,

      stream: {
        url: alt.url
      }

    });

  }

  return {

    channel,

    alternatives,

    stream:
      alternatives.find(a => a.healthy)?.stream ||
      alternatives[0]?.stream ||
      null,

    source:
      alternatives.find(a => a.healthy)?.source ||
      alternatives[0]?.source ||
      "Yayın"

  };

}

module.exports = {
  resolveChannel
};
