// Beckman uses the same SonAnime search and episode API as the existing provider.
const sonanime = require("../sonanime");

async function getStreams(request) {
  const streams = await sonanime.getStreams(request);
  return streams.map(stream => ({
    ...stream,
    name: "Beckman",
    provider: "beckman"
  }));
}

module.exports = { getStreams };
