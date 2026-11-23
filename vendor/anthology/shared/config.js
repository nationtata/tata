const config = require("../domains.json");
config.urls.tmdb = { api_base: "https://api.themoviedb.org/3", api_key: process.env.TMDB_API_KEY };
config.urls.youtube = { base: "https://www.youtube.com", innertube_key: process.env.YOUTUBE_INNERTUBE_KEY };
function val(path) {
  return path.split(".").reduce((current, key) => current?.[key], config);
}
function wrapAll(exports, ready) {
  return Object.fromEntries(Object.entries(exports).map(([key, fn]) =>
    [key, typeof fn === "function" ? async (...args) => {
      await ready?.();
      return fn(...args);
    } : fn]
  ));
}
module.exports = { loadConfig: async () => config, val, wrapAll };
