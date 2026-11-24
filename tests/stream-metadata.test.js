const assert=require("node:assert/strict");
const {parseHls,describe,publicIPv4}=require("../providers/stream-metadata");
const media=parseHls('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",LANGUAGE="ja",CHANNELS="6/JOC"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="tr"\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="hvc1.2,ec-3",FRAME-RATE=24\nvideo.m3u8');
assert.equal(media.quality,"1080p");assert.equal(media.videoCodec,"HEVC");assert.deepEqual(media.audio,["ja"]);assert.deepEqual(media.subs,["tr"]);assert.equal(media.channels,"5.1");assert.equal(media.atmos,true);
const input={name:"TATA",url:"https://example.com/master.m3u8",behaviorHints:{notWebReady:true},subtitles:[{lang:"tr",url:"https://example.com/sub.vtt"}]};
const output=describe(input,media);assert.match(output.description,/🇯🇵/);assert.match(output.description,/🇹🇷/);assert.match(output.description,/1080p/);assert.match(output.description,/Dolby Atmos/);assert.deepEqual(output.behaviorHints,input.behaviorHints);assert.deepEqual(output.subtitles,input.subtitles);assert.equal(output.url,input.url);
assert.equal(describe({url:"https://example.com/video"}).quality,undefined);
assert.equal(publicIPv4("127.0.0.1"),false);assert.equal(publicIPv4("169.254.169.254"),false);assert.equal(publicIPv4("10.0.0.1"),false);assert.equal(publicIPv4("8.8.8.8"),true);
console.log("metadata tests passed");

const cropped=parseHls('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x800,CODECS="avc1,mp4a"\nv.m3u8');
assert.equal(cropped.quality,"720p");
const formatted=describe({name:"TATA",url:"https://example.com/video",description:"1080p [EN]\nExample Movie",title:"Example Movie"},cropped);
assert.equal(formatted.description,"720p • H.264 • AAC");
assert.equal(formatted.quality,formatted.description);
assert.equal(formatted.title,undefined);

assert.match(describe({description:"Ses: Orijinal",url:"https://example.com/video"},{},"ja").description,/🇯🇵/);
assert.match(describe({description:"Ses: Orijinal",url:"https://example.com/video"},{audio:["en"]},"ja").description,/🇬🇧/);
assert.doesNotMatch(describe({description:"720p [EN]",url:"https://example.com/video"},{},"ja").description,/🇬🇧/);

for(const [input,expected] of [["360p","480p"],["800p","720p"],["824p","720p"],["1440p","1080p"],["2160p","4K"]])assert.equal(describe({description:input,url:"https://example.com/video"}).description,expected);
