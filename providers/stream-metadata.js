"use strict";
const https = require("node:https");
const dns = require("node:dns").promises;
const net = require("node:net");
const cache = new Map();
const pending = new Map();
let active = 0;
const unique = xs => [...new Set(xs.filter(Boolean))];
const flags = {tr:"🇹🇷",en:"🇬🇧",ja:"🇯🇵",ko:"🇰🇷",de:"🇩🇪",fr:"🇫🇷",es:"🇪🇸",ar:"🇸🇦",ru:"🇷🇺",zh:"🇨🇳",it:"🇮🇹",pt:"🇵🇹",id:"🇮🇩",st:"🇱🇸",hi:"🇮🇳",nl:"🇳🇱",pl:"🇵🇱",th:"🇹🇭",vi:"🇻🇳",uk:"🇺🇦",sv:"🇸🇪",fa:"🇮🇷",he:"🇮🇱",cs:"🇨🇿",da:"🇩🇰",tl:"🇵🇭",fil:"🇵🇭",fi:"🇫🇮",hr:"🇭🇷",hu:"🇭🇺",el:"🇬🇷",no:"🇳🇴",nb:"🇳🇴",nn:"🇳🇴",ro:"🇷🇴",bg:"🇧🇬",sk:"🇸🇰",sl:"🇸🇮",sr:"🇷🇸",bs:"🇧🇦",mk:"🇲🇰",sq:"🇦🇱",et:"🇪🇪",lv:"🇱🇻",lt:"🇱🇹",ms:"🇲🇾",bn:"🇧🇩",ta:"🇮🇳",te:"🇮🇳",ml:"🇮🇳",ur:"🇵🇰",pa:"🇮🇳",gu:"🇮🇳",mr:"🇮🇳",kn:"🇮🇳",sw:"🇰🇪",af:"🇿🇦",is:"🇮🇸",ca:"🇪🇸",eu:"🇪🇸",gl:"🇪🇸",ka:"🇬🇪",hy:"🇦🇲",az:"🇦🇿",kk:"🇰🇿",uz:"🇺🇿",mn:"🇲🇳",ne:"🇳🇵",si:"🇱🇰",km:"🇰🇭",lo:"🇱🇦",my:"🇲🇲",be:"🇧🇾",am:"🇪🇹",so:"🇸🇴",cy:"🏴",ga:"🇮🇪",mt:"🇲🇹"};
function language(value) {
  const s = String(value || "").trim().toLowerCase();
  const aliases = {ces:"cs",cze:"cs",dan:"da",tgl:"tl",fil:"tl",fin:"fi",hrv:"hr",hun:"hu",ell:"el",gre:"el",nor:"no",nob:"nb",nno:"nn",ron:"ro",rum:"ro",bul:"bg",slk:"sk",slo:"sk",slv:"sl",srp:"sr",bos:"bs",msa:"ms",may:"ms",ben:"bn",tam:"ta",tel:"te",urd:"ur",est:"et",lav:"lv",lit:"lt",tur:"tr",turkish:"tr","türkçe":"tr",turkce:"tr",eng:"en",english:"en","ingilizce":"en",jpn:"ja",japanese:"ja",japonca:"ja",kor:"ko",korean:"ko",deu:"de",ger:"de",fra:"fr",fre:"fr",spa:"es",ara:"ar",rus:"ru",zho:"zh",chi:"zh",ita:"it",por:"pt",ind:"id",indonesian:"id",sot:"st",sotho:"st",hin:"hi",nld:"nl",dut:"nl",pol:"pl",tha:"th",vie:"vi",ukr:"uk",swe:"sv",fas:"fa",per:"fa",heb:"he"};
  return aliases[s] || (/^[a-z]{2}(?:-[a-z]{2})?$/.test(s) ? s.split("-")[0] : "");
}
function trackLanguage(value) {
 const direct=language(value);if(direct)return direct;
 const words=String(value||"").toLowerCase().split(/[^\p{L}]+/u);
 for(const word of words){if(word.length>=3){const lang=language(word);if(lang)return lang;}}
 return /日本語/.test(String(value))?"ja":"";
}
// Normalize provider and HLS subtitles without guessing a language from the film.
function normalizeSubtitles(items) {
  const found = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const lang = [item.lang, item.language, item.langCode, item.label, item.name, item.title]
      .map(trackLanguage).find(Boolean) || "und";
    const key = JSON.stringify([url, lang]);
    const previous = found.get(key) || {};
    found.set(key, { ...previous, ...item, url, lang, id: String(previous.id ?? item.id ?? found.size) });
  }
  return [...found.values()];
}
function attributes(line) {
  const result = {};
  for (const m of line.matchAll(/(?:^|,)([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) result[m[1]] = m[2].replace(/^"|"$/g,"");
  return result;
}
function codecs(value) {
  const s = String(value || "").toLowerCase();
  return [/\b(?:hvc1|hev1|hevc|h265|x265|dvhe|dvh1)\b/.test(s)?"HEVC":/\b(?:av01|av1)\b/.test(s)?"AV1":/\b(?:vp09|vp9)\b/.test(s)?"VP9":/\b(?:avc1|h264|x264)\b/.test(s)?"H.264":"",
  /\b(?:ec-3|eac3)\b/.test(s)?"DD+":/\b(?:ac-3|ac3)\b/.test(s)?"Dolby Digital":/\b(?:mp4a|aac)\b/.test(s)?"AAC":/\bflac\b/.test(s)?"FLAC":/\bdts\b/.test(s)?"DTS":""];
}
function qualityClass(value) {
  const s=String(value||"").trim().toLowerCase();
  if(s==="4k"||s==="uhd")return "4K";
  if(s==="2k"||s==="fhd")return "1080p";
  if(s==="hd")return "720p";
  if(s==="sd")return "480p";
  const n=Number(s.replace(/p$/,""));
  return n>0?(n>2600?"4K":n>=900?"1080p":n>=600?"720p":"480p"):"";
}
function parseHls(body) {
  if (!/^\s*#EXTM3U/.test(body)) return {};
  const audio=[], subs=[], subtitleTracks=[], variants=[], channels=[];
  let unknownAudio=false;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const a=attributes(line.slice(13));
      if(a.TYPE==="AUDIO"){const lang=trackLanguage(a.LANGUAGE)||trackLanguage(a.NAME); audio.push(lang); if(!lang)unknownAudio=true; if(a.CHANNELS)channels.push(a.CHANNELS);}
      if(a.TYPE==="SUBTITLES"){
        const lang=trackLanguage(a.LANGUAGE)||trackLanguage(a.NAME);
        subs.push(lang);
        if(a.URI) subtitleTracks.push({ url:a.URI, lang:lang||"und", ...(a.NAME && {name:a.NAME}) });
      }
    }
    if(line.startsWith("#EXT-X-STREAM-INF:"))variants.push(attributes(line.slice(18)));
  }
  variants.sort((a,b)=>Number(b.RESOLUTION?.split("x")[1]||0)-Number(a.RESOLUTION?.split("x")[1]||0)||Number(b.BANDWIDTH||0)-Number(a.BANDWIDTH||0));
  const v=variants[0]||{}, h=Number(v.RESOLUTION?.split("x")[1]), [videoCodec,audioCodec]=codecs(v.CODECS);
  const channel=channels.length && channels.every(x=>x===channels[0]) ? channels[0] : "";
  const rate=Number(v["AVERAGE-BANDWIDTH"]||v.BANDWIDTH);
  return {unknownAudio,audio:unique(audio),subs:unique(subs),subtitleTracks,quality:qualityClass(h),videoCodec,audioCodec,channels:channel==="6"?"5.1":channel==="8"?"7.1":channel==="2"?"2.0":channel==="6/JOC"?"5.1":"",atmos:/JOC/i.test(channel),hdr:/\b(?:dvhe|dvh1)\b/i.test(v.CODECS||"")?"Dolby Vision":v["VIDEO-RANGE"]==="PQ"?"HDR (PQ)":v["VIDEO-RANGE"]==="HLG"?"HLG":"",fps:Number(v["FRAME-RATE"])||0,rate:rate? (rate/1e6).toFixed(1)+" Mbps":""};
}
function publicIPv4(ip) {
  if(net.isIP(ip)!==4)return false;
  const [a,b,c]=ip.split(".").map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0&&c===113);
}

// Requests are bounded, redirect-checked and pinned to public addresses on each hop.
const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 3500;
const PROBE_BYTES = 8 * 1024 * 1024;
const PROBE_CONCURRENCY = 6;
function safeHeaders(headers) {
  const result = {};
  for (const [key,value] of Object.entries(headers || {})) {
    if (/^(user-agent|referer|origin|accept)$/i.test(key) && typeof value === "string" && !/[\r\n]/.test(value))
      result[key] = value;
  }
  return result;
}
async function publicAddress(hostname) {
  const addresses = await dns.lookup(hostname, { all: true, family: 4 });
  const address = addresses.find(item => publicIPv4(item.address));
  if (!address || addresses.some(item => !publicIPv4(item.address))) throw Error("non-public-address");
  return address.address;
}
async function requestMedia(url, headers, options = {}) {
  const { range, maxBytes = 262144, deadline = Date.now() + REQUEST_TIMEOUT_MS, depth = 0 } = options;
  if (depth > MAX_REDIRECTS || deadline <= Date.now()) return { status: "unknown" };
  let target;
  try { target = new URL(url); } catch { return { status: "invalid" }; }
  if (target.protocol !== "https:" || target.username || target.password || (target.port && target.port !== "443"))
    return { status: "invalid" };
  let ip;
  try { ip = await publicAddress(target.hostname); } catch { return { status: "unknown" }; }
  const timeout = Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
  return new Promise(resolve => {
    let finished = false, req;
    const done = result => { if (finished) return; finished = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { done({ status: "unknown" }); req?.destroy(); }, timeout);
    const requestHeaders = safeHeaders(headers);
    if (range) requestHeaders.Range = range;
    req = https.get(target, {
      headers: requestHeaders,
      lookup: (_host, opts, cb) => opts.all
        ? cb(null, [{ address: ip, family: 4 }])
        : cb(null, ip, 4)
    }, response => {
      const status = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const redirect = response.headers.location;
        response.destroy();
        if (!redirect) return done({ status: "invalid" });
        let next;
        try { next = new URL(redirect, target).href; } catch { return done({ status: "invalid" }); }
        return requestMedia(next, headers, { ...options, depth: depth + 1 })
          .then(done, () => done({ status: "unknown" }));
      }
      if ([404, 410].includes(status)) { response.destroy(); return done({ status: "invalid" }); }
      if (status !== 200 && status !== 206) { response.destroy(); return done({ status: "unknown" }); }
      const chunks = [];
      let received = 0;
      response.on("data", chunk => {
        const remaining = maxBytes - received;
        if (remaining > 0) { chunks.push(chunk.subarray(0, remaining)); received += Math.min(chunk.length, remaining); }
        if (received >= maxBytes) {
          response.destroy();
          done({ status: "valid", buffer: Buffer.concat(chunks), finalUrl: target.href });
        }
      });
      response.on("end", () => done({ status: received ? "valid" : "invalid", buffer: Buffer.concat(chunks), finalUrl: target.href }));
      response.on("error", () => done({ status: "unknown" }));
    });
    req.on("error", () => done({ status: "unknown" }));
  });
}
function parseProbe(data) {
 const streams=data.streams||[], v=streams.find(x=>x.codec_type==="video")||{}, a=streams.filter(x=>x.codec_type==="audio"), sub=streams.filter(x=>x.codec_type==="subtitle");
 const langs=xs=>unique(xs.map(x=>trackLanguage(x.tags?.language)||trackLanguage(x.tags?.title)||trackLanguage(x.tags?.handler_name)));
 const [n,d]=String(v.avg_frame_rate||"").split("/").map(Number);
 const ch=unique(a.map(x=>x.channels));
 return {audioTrackCount:a.length,quality:qualityClass(v.height),videoCodec:codecs(v.codec_name)[0],audioCodec:unique(a.map(x=>codecs(x.codec_name)[1])).join(" / "),audio:langs(a),subs:langs(sub),unknownAudio:a.some(x=>!trackLanguage(x.tags?.language)&&!trackLanguage(x.tags?.title)&&!trackLanguage(x.tags?.handler_name)),channels:ch.length===1?({1:"1.0",2:"2.0",6:"5.1",8:"7.1"}[ch[0]]||""):"",fps:n&&d?Number((n/d).toFixed(3)):0};
}
function probeBuffer(buffer, timeout) {
  if (!(buffer.subarray(4,8).toString()==="ftyp" || buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))))
    return Promise.resolve({});
  try {
    const { execFile } = require("node:child_process");
    const bin = require("@ffprobe-installer/ffprobe").path;
    const format = buffer.subarray(4,8).toString()==="ftyp" ? "mov" : "matroska";
    return new Promise(resolve => {
      const child = execFile(bin, ["-v","error","-protocol_whitelist","pipe","-f",format,"-show_streams","-of","json","-i","pipe:0"],
        { timeout: Math.max(300, timeout), maxBuffer: 524288 }, (err,out) => {
          try { resolve(err ? {} : parseProbe(JSON.parse(out))); } catch { resolve({}); }
        });
      child.stdin.on("error",()=>{});
      child.stdin.end(buffer);
    });
  } catch { return Promise.resolve({}); }
}

function mp4Metadata(buffer) {
  // A moov atom may be located at the file tail. Feed the self-contained atom to ffprobe.
  for (let i=4;i+4<=buffer.length;i++) {
    if (buffer.toString("ascii", i, i+4)!=="moov") continue;
    const size=buffer.readUInt32BE(i-4);
    if (size<8 || i-4+size>buffer.length) continue;
    const ftyp=Buffer.from("000000146674797069736f6d0000000069736f6d","hex");
    return Buffer.concat([ftyp,buffer.subarray(i-4,i-4+size)]);
  }
  return null;
}

async function validateHls(first, url, headers, deadline, depth=0) {
  if(depth>3 || Date.now()>=deadline)return {status:"unknown"};
  const body=first.buffer.toString("utf8");
  if(!/^\s*#EXTM3U/.test(body))return {status:"invalid"};
  const metadata=parseHls(body);
  const lines=body.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const base=first.finalUrl||url;
  metadata.subtitleTracks=normalizeSubtitles((metadata.subtitleTracks||[]).map(sub=>{
    try { return {...sub,url:new URL(sub.url,base).href}; } catch { return null; }
  }));
  const variants=[],segments=[];
  let variant=false;
  for(const line of lines){
    if(line.startsWith("#EXT-X-STREAM-INF:")){variant=true;continue;}
    if(line.startsWith("#"))continue;
    try{
      const target=new URL(line,base).href;
      (variant?variants:segments).push(target);
    }catch{}
    variant=false;
  }
  const targets=variants.length?variants.slice(0,3):segments.slice(0,2);
  if(!targets.length)return {...metadata,status:"unknown"};
  const results=await Promise.all(targets.map(async target=>{
    const response=await requestMedia(target,headers,{deadline,maxBytes:variants.length?262144:4096,range:variants.length?undefined:"bytes=0-4095"});
    if(response.status!=="valid")return {status:response.status};
    if(variants.length)return validateHls(response,target,headers,deadline,depth+1);
    const prefix=response.buffer.subarray(0,256).toString("utf8");
    if(/^\s*(?:<!doctype html|<html|<\?xml|\{\s*"(?:error|message|status)")/i.test(prefix))return {status:"invalid"};
    return {status:"valid"};
  }));
  const valid=results.find(x=>x.status==="valid");
  if(valid)return {...metadata,...Object.fromEntries(Object.entries(valid).filter(([k,v])=>k!=="status"&&v!==""&&v!==0&&(!Array.isArray(v)||v.length))),audio:unique([...(metadata.audio||[]),...(valid.audio||[])]),subs:unique([...(metadata.subs||[]),...(valid.subs||[])]),subtitleTracks:normalizeSubtitles([...(metadata.subtitleTracks||[]),...(valid.subtitleTracks||[])]),status:"valid"};
  // Never discard a master when untested alternatives or transient failures remain.
  return {...metadata,status:results.every(x=>x.status==="invalid")&&targets.length===(variants.length||Math.min(segments.length,2))?"invalid":"unknown"};
}

async function inspect(stream, deadline) {
  const url=stream.url||"";
  const isHls=/\.m3u8(?:[?#&]|$)|\/hls\/|\/master\./i.test(url)||/^(hls|m3u8)$/i.test(stream.format||"")||/\.m3u8$/i.test(stream.behaviorHints?.filename||"");
  const headers=stream.behaviorHints?.proxyHeaders?.request||stream.headers||{};
  const key=JSON.stringify([url,headers]);
  const hit=cache.get(key); if(hit && hit.until>Date.now()) return hit.data;
  if(pending.has(key))return pending.get(key);
  while(active>=PROBE_CONCURRENCY && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,70));
  if(Date.now()>=deadline)return {status:"unknown"};
  active++;
  const task=(async()=>{
    const first=await requestMedia(url,headers,{range:isHls?undefined:"bytes=0-"+(PROBE_BYTES-1),
      maxBytes:isHls?262144:PROBE_BYTES,deadline});
    if(first.status!=="valid")return {status:first.status};
    // An error page returned with HTTP 200 is not a playable media stream.
    if(/^\s*(?:<!doctype html|<html|<\?xml|\{\s*"(?:error|message|status)")/i.test(first.buffer.subarray(0,512).toString("utf8")))
      return {status:"invalid"};
    if(isHls) {
      return validateHls(first,url,headers,deadline);
    }
    const timeout=()=>Math.min(3500,Math.max(300,deadline-Date.now()));
    let data=await probeBuffer(first.buffer,timeout());
    if((!data.audio?.length || !data.quality) && Date.now()+500<deadline) {
      const tail=await requestMedia(url,headers,{range:"bytes=-"+PROBE_BYTES,maxBytes:PROBE_BYTES,deadline});
      if(tail.status==="valid") {
        const atom=mp4Metadata(tail.buffer);
        if(atom) {
          const last=await probeBuffer(atom,timeout());
          data={...data,...Object.fromEntries(Object.entries(last).filter(([,v])=>v!=="" && v!==0 && (!Array.isArray(v)||v.length)))};
        }
      }
    }
    return {...data,status:"valid"};
  })().catch(()=>({status:"unknown"})).then(data=>{
    if(cache.size>=512)cache.delete(cache.keys().next().value);
    // Only hard failures are negative; timeouts are retried soon.
    cache.set(key,{data,until:Date.now()+(data.status==="valid"?3600000:data.status==="invalid"?600000:15000)});
    return data;
  }).finally(()=>{active--;pending.delete(key);});
  pending.set(key,task);
  return task;
}
function describe(stream,media={},originalLanguage="") {
  let path="";try{path=decodeURIComponent(new URL(stream.url).pathname)}catch{}
  const existing=unique([stream.sourceTitle,stream.description,stream.quality,stream.title].filter(x=>typeof x==="string"&&x!==stream.name)).join("\n");
  const sourceText=[existing,path].join(" ");
  const q=qualityClass(media.quality||sourceText.match(/\b(?:\d{3,4}p|4K|2K|UHD|FHD|HD|SD)\b/i)?.[0]);
  const [vc,ac]=codecs(sourceText.replace(/H\.26/g,"H26"));
  const source=sourceText.match(/\b(?:WEB[- .]?DL|WEBRip|BluRay|REMUX|HDTV)\b/i)?.[0];
  const hdr=media.hdr||sourceText.match(/\b(?:Dolby Vision|HDR10\+?|HDR|HLG)\b/i)?.[0];
  const depth=sourceText.match(/\b(?:8|10|12)[- ]?bit\b/i)?.[0];
  const observed=unique((media.audio||[]).map(language)).filter(code=>flags[code]);
  const taggedAudio=unique((Array.isArray(stream.audioLangs)?stream.audioLangs:[]).map(language))
    .filter(code=>flags[code]);
  // Source-provided audio tracks supplement only when no contradictory probe exists.
  const sourceAudio=[];
  if(/(?:türkçe|turkce|\btr\b)\s*(?:dublaj|dub|sesli)|(?:^|[\s[(])dublaj(?:$|[\s)\]])/iu.test(existing)) sourceAudio.push("tr");
  if(/(?:ingilizce|\beng(?:lish)?\b)\s*(?:ses|audio|dublaj)/iu.test(existing)) sourceAudio.push("en");
  // Explicit source labels are evidence only when no actual channel-language metadata was found.
  const audio=observed.length ? observed : unique([...taggedAudio,...sourceAudio]);
  const original=language(originalLanguage);
  if (!audio.length && flags[original]) audio.push(original);
  audio.sort((a,b)=>Number(b==="tr")-Number(a==="tr"));
  const display=xs=>unique(xs.map(x=>flags[x])).join(" / ");
  const sourceTurkishSubtitle = stream.metvVariant === "subtitled" || /(?:türkçe|turkce|\btr\b)\s+altyaz[ıi](?:l[ıi])?|(?:^|[\s|•\[(])altyaz[ıi]l[ıi](?:$|[\s|•\])])/iu.test(existing);
  const langLine=[audio.length?"Ses: "+display(audio):"", ((media.subs||[]).map(language).includes("tr") || normalizeSubtitles(stream.subtitles).some(sub=>sub.lang==="tr") || sourceTurkishSubtitle)?"Altyazı: 🇹🇷":""].filter(Boolean).join(" • ");
  const channels=media.channels||existing.match(/\b(?:2\.0|5\.1|7\.1)\b/)?.[0];
  const sound=unique([media.audioCodec||ac,channels,media.atmos||/Dolby Atmos/i.test(existing)?"Dolby Atmos":""]).join(" ");
  const rate=media.rate||existing.match(/\b\d+(?:[.,]\d+)?\s*Mbps\b/i)?.[0];
  const fps=media.fps?media.fps+" FPS":existing.match(/\b\d+(?:[.,]\d+)?\s*FPS\b/i)?.[0];
  const size=existing.match(/\b\d+(?:[.,]\d+)?\s*(?:GB|MB)\b/i)?.[0];
  const tech=unique([q,source,media.videoCodec||vc,depth,hdr,sound,rate,fps,size]).join(" • ");
  const description=[langLine,tech].filter(Boolean).join("\n");
  const result={...stream};
  delete result.metvVariant;
  delete result.title;
  delete result.quality;
  delete result.description;
  if(description){result.description=description;if(q)result.quality=description;}
  return result;
}
async function enrichStreams(streams, originalLanguage="", options={}) {
  const deadline=options.deadline||Date.now()+45000;
  const measured=await Promise.all(streams.map(stream=>inspect(stream,deadline).catch(()=>({status:"unknown"}))));
  return streams.map((stream,i)=>{
    const media=measured[i]||{};
    if(media.status==="invalid") {
      if(typeof options.onInvalid==="function") options.onInvalid(stream);
      return null;
    }
    try {
      const withSubtitles={...stream,subtitles:normalizeSubtitles([...(stream.subtitles||[]),...(media.subtitleTracks||[])])};
      const result=describe(withSubtitles,media,originalLanguage);
      // Callers can distinguish measured from fallback metadata when merging updates.
      Object.defineProperty(result,"__verifiedAudio",{value:!!media.audio?.length,enumerable:false});
      return result;
    } catch { return describe(stream,{},originalLanguage); }
  }).filter(Boolean);
}
function mergeStreams(previous, incoming) {
  if (!previous) return incoming;
  const base = previous.__verifiedAudio && !incoming.__verifiedAudio ? previous : incoming;
  const result = {...base};
  const subtitles = normalizeSubtitles([...(previous.subtitles||[]),...(incoming.subtitles||[])]);
  if(subtitles.length) result.subtitles = subtitles;
  const marker = "Altyazı: 🇹🇷";
  if ([previous,incoming].some(s => [s.description,s.quality].some(x => typeof x === "string" && x.includes(marker)))) {
    const add = value => {
      const lines = String(value || "").split("\n");
      if (lines.some(line => line.includes(marker))) return lines.join("\n");
      if (/^Ses: /.test(lines[0])) lines[0] += " • " + marker;
      else lines.unshift(marker);
      return lines.filter(Boolean).join("\n");
    };
    result.description = add(result.description);
    if (result.quality) result.quality = add(result.quality);
  }
  if (previous.name === "Law" || incoming.name === "Law") result.name = "Law";
  Object.defineProperty(result,"__verifiedAudio",{value:!!base.__verifiedAudio,enumerable:false});
  return result;
}
module.exports={mergeStreams,normalizeSubtitles,parseProbe,parseHls,describe,enrichStreams,publicIPv4,inspect,validateHls};
