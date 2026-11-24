"use strict";
const https = require("node:https");
const dns = require("node:dns").promises;
const net = require("node:net");
const cache = new Map();
const pending = new Map();
let active = 0;
const unique = xs => [...new Set(xs.filter(Boolean))];
const flags = {tr:"🇹🇷",en:"🇬🇧",ja:"🇯🇵",ko:"🇰🇷",de:"🇩🇪",fr:"🇫🇷",es:"🇪🇸",ar:"🇸🇦",ru:"🇷🇺",zh:"🇨🇳",it:"🇮🇹",pt:"🇵🇹",id:"🇮🇩",st:"🇱🇸",hi:"🇮🇳",nl:"🇳🇱",pl:"🇵🇱",th:"🇹🇭",vi:"🇻🇳",uk:"🇺🇦",sv:"🇸🇪",fa:"🇮🇷",he:"🇮🇱"};
function language(value) {
  const s = String(value || "").trim().toLowerCase();
  const aliases = {tur:"tr",turkish:"tr","türkçe":"tr",turkce:"tr",eng:"en",english:"en","ingilizce":"en",jpn:"ja",japanese:"ja",japonca:"ja",kor:"ko",korean:"ko",deu:"de",ger:"de",fra:"fr",fre:"fr",spa:"es",ara:"ar",rus:"ru",zho:"zh",chi:"zh",ita:"it",por:"pt",ind:"id",indonesian:"id",sot:"st",sotho:"st",hin:"hi",nld:"nl",dut:"nl",pol:"pl",tha:"th",vie:"vi",ukr:"uk",swe:"sv",fas:"fa",per:"fa",heb:"he"};
  return aliases[s] || (/^[a-z]{2}(?:-[a-z]{2})?$/.test(s) ? s.split("-")[0] : "");
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
  return n>0?(n>=2160?"4K":n>=1000?"1080p":n>=600?"720p":"480p"):"";
}
function parseHls(body) {
  if (!/^\s*#EXTM3U/.test(body)) return {};
  const audio=[], subs=[], variants=[], channels=[];
  let unknownAudio=false;
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const a=attributes(line.slice(13));
      if(a.TYPE==="AUDIO"){const lang=language(a.LANGUAGE)||language(a.NAME); audio.push(lang); if(!lang)unknownAudio=true; if(a.CHANNELS)channels.push(a.CHANNELS);}
      if(a.TYPE==="SUBTITLES")subs.push(language(a.LANGUAGE)||language(a.NAME));
    }
    if(line.startsWith("#EXT-X-STREAM-INF:"))variants.push(attributes(line.slice(18)));
  }
  variants.sort((a,b)=>Number(b.RESOLUTION?.split("x")[1]||0)-Number(a.RESOLUTION?.split("x")[1]||0)||Number(b.BANDWIDTH||0)-Number(a.BANDWIDTH||0));
  const v=variants[0]||{}, h=Number(v.RESOLUTION?.split("x")[1]), [videoCodec,audioCodec]=codecs(v.CODECS);
  const channel=channels.length && channels.every(x=>x===channels[0]) ? channels[0] : "";
  const rate=Number(v["AVERAGE-BANDWIDTH"]||v.BANDWIDTH);
  return {unknownAudio,audio:unique(audio),subs:unique(subs),quality:qualityClass(h),videoCodec,audioCodec,channels:channel==="6"?"5.1":channel==="8"?"7.1":channel==="2"?"2.0":channel==="6/JOC"?"5.1":"",atmos:/JOC/i.test(channel),hdr:/\b(?:dvhe|dvh1)\b/i.test(v.CODECS||"")?"Dolby Vision":v["VIDEO-RANGE"]==="PQ"?"HDR (PQ)":v["VIDEO-RANGE"]==="HLG"?"HLG":"",fps:Number(v["FRAME-RATE"])||0,rate:rate? (rate/1e6).toFixed(1)+" Mbps":""};
}
function publicIPv4(ip) {
  if(net.isIP(ip)!==4)return false;
  const [a,b,c]=ip.split(".").map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51)||a===203&&b===0&&c===113);
}
async function readMedia(url,headers,isHls) {
  const u=new URL(url);
  if(u.protocol!=="https:"||u.username||u.password||u.port&&u.port!=="443")return {};
  const ip=await Promise.race([dns.lookup(u.hostname,{family:4}).then(x=>x.address),new Promise(resolve=>{const t=setTimeout(()=>resolve(""),650);t.unref();})]);
  if(!publicIPv4(ip))return {};
  return new Promise(resolve=>{
    let done=false, req;
    const finish=x=>{if(done)return;done=true;clearTimeout(timer);resolve(x);};
    const timer=setTimeout(()=>{finish({});req?.destroy();},1300);
    const safeHeaders={};
    for(const [k,v] of Object.entries(headers||{}))if(/^(user-agent|referer|origin|accept)$/i.test(k)&&typeof v==="string"&&!/[\r\n]/.test(v))safeHeaders[k]=v;
    if(!isHls)safeHeaders.Range="bytes=0-2097151";
    req=https.get(u,{headers:safeHeaders,lookup:(_h,opts,cb)=>opts.all?cb(null,[{address:ip,family:4}]):cb(null,ip,4)},res=>{
      if(res.statusCode!==200&&res.statusCode!==206){res.destroy();return finish({});}
      let bytes=0;const chunks=[];
      res.on("data",chunk=>{bytes+=chunk.length;if(bytes>(isHls?262144:2097152)){finish({});res.destroy();}else chunks.push(chunk);});
      res.on("end",()=>finish(isHls?parseHls(Buffer.concat(chunks).toString("utf8")):probeBuffer(Buffer.concat(chunks))));
      res.on("error",()=>finish({}));
    });
    req.on("error",()=>finish({}));
  });
}
function parseProbe(data) {
 const streams=data.streams||[], v=streams.find(x=>x.codec_type==="video")||{}, a=streams.filter(x=>x.codec_type==="audio"), sub=streams.filter(x=>x.codec_type==="subtitle");
 const langs=xs=>unique(xs.map(x=>language(x.tags?.language)||language(x.tags?.title)));
 const [n,d]=String(v.avg_frame_rate||"").split("/").map(Number);
 const ch=unique(a.map(x=>x.channels));
 return {quality:qualityClass(v.height),videoCodec:codecs(v.codec_name)[0],audioCodec:unique(a.map(x=>codecs(x.codec_name)[1])).join(" / "),audio:langs(a),subs:langs(sub),unknownAudio:a.some(x=>!language(x.tags?.language)&&!language(x.tags?.title)),channels:ch.length===1?({1:"1.0",2:"2.0",6:"5.1",8:"7.1"}[ch[0]]||""):"",fps:n&&d?Number((n/d).toFixed(3)):0};
}
async function probeBuffer(buffer) {
 if(!(buffer.subarray(4,8).toString()==="ftyp"||buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))))return {};
 try {
 const {execFile}=require("node:child_process");
 const bin=require("@ffprobe-installer/ffprobe").path;
 const format=buffer.subarray(4,8).toString()==="ftyp"?"mov":"matroska";
 return await new Promise(resolve=>{
 const child=execFile(bin,["-v","error","-protocol_whitelist","pipe","-f",format,"-show_streams","-of","json","-i","pipe:0"],{timeout:1500,maxBuffer:262144},(err,out)=>{try{resolve(err?{}:parseProbe(JSON.parse(out)));}catch{resolve({});}});
 child.stdin.on("error",()=>{});child.stdin.end(buffer);
 });
 }catch{return {};}
}
async function inspect(stream) {
  const isHls=/\.m3u8(?:[?#]|$)|\/hls\/|\/master\./i.test(stream.url||"")||/^(hls|m3u8)$/i.test(stream.format||"")||/\.m3u8$/i.test(stream.behaviorHints?.filename||"");
  if(!isHls&&!/\.(mp4|mkv)(?:[?#]|$)/i.test(stream.url||"")&&!/^(mp4|mkv|matroska)$/i.test(stream.format||"")&&!/\.(mp4|mkv)$/i.test(stream.behaviorHints?.filename||""))return {};
  const headers=stream.behaviorHints?.proxyHeaders?.request||stream.headers||{};
  const key=JSON.stringify([stream.url,headers]);
  const hit=cache.get(key);if(hit&&hit.until>Date.now())return hit.data;
  if(pending.has(key))return pending.get(key);
  if(active>=6){for(let i=0;i<30&&active>=6;i++)await new Promise(resolve=>setTimeout(resolve,100));if(active>=6)return {};}
  active++;
  const task=readMedia(stream.url,headers,isHls).catch(()=>({})).then(data=>{
    if(cache.size>=512)cache.delete(cache.keys().next().value);
    cache.set(key,{data,until:Date.now()+ (Object.keys(data).length?300000:30000)});return data;
  }).finally(()=>{active--;pending.delete(key);});
  pending.set(key,task);return task;
}
function describe(stream,media={},originalLanguage="") {
  let path="";try{path=decodeURIComponent(new URL(stream.url).pathname)}catch{}
  const existing=unique([stream.description,stream.quality,stream.title].filter(x=>typeof x==="string"&&x!==stream.name)).join("\n");
  const sourceText=[existing,path].join(" ");
  const q=qualityClass(media.quality||sourceText.match(/\b(?:\d{3,4}p|4K|2K|UHD|FHD|HD|SD)\b/i)?.[0]);
  const [vc,ac]=codecs(sourceText.replace(/H\.26/g,"H26"));
  const source=sourceText.match(/\b(?:WEB[- .]?DL|WEBRip|BluRay|REMUX|HDTV)\b/i)?.[0];
  const hdr=media.hdr||sourceText.match(/\b(?:Dolby Vision|HDR10\+?|HDR|HLG)\b/i)?.[0];
  const depth=sourceText.match(/\b(?:8|10|12)[- ]?bit\b/i)?.[0];
  const flagCodes=Object.fromEntries(Object.entries(flags).map(([k,v])=>[v,k]));
  const parseLangs=t=>unique([...Object.entries(flagCodes).filter(([f])=>t.includes(f)).map(([,k])=>k),...t.split(/[\s/,\[\]&]+/).map(language)]);
  const audioLine=existing.match(/Ses:\s*([^\n•]+)/i)?.[1]||"";
  const subLine=existing.match(/Altyazı:\s*([^\n•]+)/i)?.[1]||"";
  const audio=unique([...(media.audio||[]),...(!(media.audio||[]).length?(Array.isArray(stream.audioLangs)?stream.audioLangs.map(language):[]).concat(parseLangs(audioLine)):[]), /(?:TR|Türkçe)\s*(?:Dublaj|Dub)/i.test(existing)?"tr":""]);
  if(!audio.length && (media.unknownAudio || /Ses:\s*Orijinal|\b(?:original|orijinal|track\s*\d+|unknown|und)\b/i.test(existing)) && language(originalLanguage))audio.push(language(originalLanguage));
  const subs=unique([...(media.subs||[]),...(Array.isArray(stream.subtitles)?stream.subtitles.map(s=>language(s.lang||s.language)||language(s.label)):[]),...parseLangs(subLine),/(?:TR|Türkçe)\s*(?:Dublaj\s*&\s*)?Altyazılı/i.test(existing)?"tr":""]);
  const display=xs=>xs.map(x=>flags[x]||x.toUpperCase()).join(" / ");
  const langLine=[audio.length?"Ses: "+display(audio):/Ses:\s*Orijinal/i.test(existing)?"Ses: Orijinal":"",subs.length?"Altyazı: "+display(subs):""].filter(Boolean).join(" • ");
  const channels=media.channels||existing.match(/\b(?:2\.0|5\.1|7\.1)\b/)?.[0];
  const sound=unique([media.audioCodec||ac,channels,media.atmos||/Dolby Atmos/i.test(existing)?"Dolby Atmos":""]).join(" ");
  const rate=media.rate||existing.match(/\b\d+(?:[.,]\d+)?\s*Mbps\b/i)?.[0];
  const fps=media.fps?media.fps+" FPS":existing.match(/\b\d+(?:[.,]\d+)?\s*FPS\b/i)?.[0];
  const size=existing.match(/\b\d+(?:[.,]\d+)?\s*(?:GB|MB)\b/i)?.[0];
  const tech=unique([q,source,media.videoCodec||vc,depth,hdr,sound,rate,fps,size]).join(" • ");
  const description=[langLine||"Ses: Tespit edilemedi",tech||"Teknik bilgi tespit edilemedi"].filter(Boolean).join("\n");
  const result={...stream};
  delete result.title;
  delete result.quality;
  delete result.description;
  if(description){result.description=description;if(q)result.quality=description;}
  return result;
}
async function enrichStreams(streams,originalLanguage="") {
  return Promise.all(streams.map(async s=>{try{return describe(s,await inspect(s),originalLanguage);}catch{return s;}}));
}
module.exports={parseProbe,parseHls,describe,enrichStreams,publicIPv4};
