const fs = require("fs");
const path = require("path");

const HUB_DIR = path.join(__dirname, "hub");

const cache = new Map();

function loadHub(channelName) {
  if (cache.has(channelName)) {
    return cache.get(channelName);
  }

  const fileName = `${channelName.toLowerCase().replace(/\s+/g, "")}.json`;
  const filePath = path.join(HUB_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

  cache.set(channelName, data);

  return data;
}

module.exports = {
  loadHub
};
