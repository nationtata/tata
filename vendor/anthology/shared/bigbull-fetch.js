module.exports = hosts => async (input, options = {}) => {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !hosts.some(host => url.hostname === host || url.hostname.endsWith("." + host))) {
    throw new Error("Unsupported provider URL");
  }
  return fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(3500) });
};
