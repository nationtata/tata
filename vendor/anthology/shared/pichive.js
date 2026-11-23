function sliceBalanced(body, open) {
  var depth = 0;
  var inString = false;
  var escaped = false;
  for (var i = open; i < body.length; i++) {
    var c = body.charAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return body.slice(open, i + 1);
    }
  }
  return null;
}

function jsonAfter(body, marker, offset) {
  var at = body.indexOf(marker, offset || 0);
  if (at < 0) return null;
  var open = body.indexOf("{", at + marker.length - 1);
  var slice = open < 0 ? null : sliceBalanced(body, open);
  if (!slice) return null;
  try {
    return JSON.parse(slice);
  } catch (e) {
    return null;
  }
}

var K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function sha256Words(str) {
  var msg = [];
  for (var i = 0; i < str.length; i++) msg.push(str.charCodeAt(i) & 0xff);
  var len = msg.length;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  var bits = len * 8;
  msg.push(0, 0, 0, 0, (bits >>> 24) & 0xff, (bits >>> 16) & 0xff, (bits >>> 8) & 0xff, bits & 0xff);
  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  var w = [];
  for (var off = 0; off < msg.length; off += 64) {
    for (var j = 0; j < 16; j++) w[j] = (msg[off + 4 * j] << 24) | (msg[off + 4 * j + 1] << 16) | (msg[off + 4 * j + 2] << 8) | msg[off + 4 * j + 3];
    for (var t = 16; t < 64; t++) {
      var x = w[t - 15], y = w[t - 2];
      var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (var r = 0; r < 64; r++) {
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K256[r] + w[r]) | 0;
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0 >>> 0, h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0, h5 >>> 0, h6 >>> 0, h7 >>> 0];
}
function pichiveSign(html, url) {
  var u = String(url || "");
  if ((u.indexOf("/nm.php") === -1 && u.indexOf("/nsub.php") === -1) || u.indexOf("&p=") !== -1) return u;
  var gm = /"gate"\s*:\s*\{\s*"n"\s*:\s*"([^"]+)"(?:\s*,\s*"b"\s*:\s*(\d+))?/.exec(String(html || ""));
  if (!gm) return u;
  var n = gm[1], bits = parseInt(gm[2], 10) || 12;
  var fn = /window\.NP_GATE\s*=\s*function\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*\{([\s\S]*?)\};/.exec(String(html || ""));
  if (!fn) {
    for (var i = 0; i < 5000000; i++) if ((sha256Words(n + ":" + i)[0] >>> (32 - bits)) === 0) return u + "&p=" + i;
    return u;
  }
  var nVar = fn[1], body = fn[3];
  var cm = /var\s+(\w+)\s*=\s*String\.fromCharCode\(([\d,\s]+)\)/.exec(body);
  var nm = /var\s+(\w+)\s*=\s*(?:\w+\.toString\((\d*)\)|String\(\w+\))/.exec(body);
  var im = /\(\s*\w+\(([^)]+)\)\[(\d+)\]\s*(>>>|&)\s*(\d+)\s*\)\s*===?\s*0/.exec(body);
  if (!cm || !nm || !im) return u;
  var saltVar = cm[1], salt = cm[2].split(",").map(function (x) { return String.fromCharCode(parseInt(x.trim(), 10)); }).join("");
  var nonceVar = nm[1], radix = parseInt(nm[2], 10) || 10, parts = im[1].split("+").map(function (s) { return s.trim(); });
  var wordIdx = parseInt(im[2], 10) || 0, op = im[3], rhs = parseInt(im[4], 10) >>> 0;
  for (var k = 0; k < 5000000; k++) {
    var nonce = k.toString(radix), msg = "";
    for (var p = 0; p < parts.length; p++) {
      var tok = parts[p];
      if (tok === nVar) msg += n;
      else if (tok === saltVar) msg += salt;
      else if (tok === nonceVar) msg += nonce;
      else msg += tok.replace(/^["']|["']$/g, "");
    }
    var w = sha256Words(msg)[wordIdx] >>> 0;
    if ((op === ">>>" ? (w >>> rhs) : ((w & rhs) >>> 0)) === 0) return u + "&p=" + nonce;
  }
  return u;
}

module.exports = { sliceBalanced, jsonAfter, pichiveSign };
