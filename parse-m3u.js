const fs = require("fs");
const path = require("path");

/* =========================================================
   PLAYLISTLER
========================================================= */

const PLAYLISTS = [
  { file: path.join(__dirname, "tata.m3u"), source: "Ana" },
  { file: path.join(__dirname, "lists", "alternatif1.m3u"), source: "Alternatif 1" },
  { file: path.join(__dirname, "lists", "alternatif2.m3u"), source: "Alternatif 2" },
  { file: path.join(__dirname, "lists", "alternatif3.m3u"), source: "Alternatif 3" }
];

let channels = [];
let grouped = {};

/* =========================================================
   GRUP NORMALİZASYONU
========================================================= */

function normalizeGroup(group = "") {

  const g = group.toLowerCase();

  if (g.includes("ulusal")) return "Ulusal";
  if (g.includes("spor")) return "Spor";
  if (g.includes("haber")) return "Haber";
  if (g.includes("belgesel")) return "Belgesel";
  if (g.includes("çocuk") || g.includes("cocuk")) return "Çocuk";

  return "Diğer";

}

/* =========================================================
   GÜRÜLTÜ TEMİZLEME
========================================================= */

function cleanName(name = "") {

  let s = name.toUpperCase();

  s = s.replace(/[┃│║]/g, " ");
  s = s.replace(/\[[^\]]*]/g, " ");
  s = s.replace(/\([^)]*\)/g, " ");

  s = s.replace(/\b(TR|TURKEY|TÜRKİYE)\b/g, " ");

  s = s.replace(/\b(8K|4K|UHD|FHD|FULL HD|HD|SD|HEVC|H265|H264|HDR|LIVE|CANLI)\b/g, " ");

  s = s.replace(/^TRT(\d)$/,"TRT $1");
  s = s.replace(/^TV100$/,"TV 100");

  s = s.replace(/[_|]/g, " ");
  s = s.replace(/-/g, " ");

  s = s.replace(/\s+/g, " ").trim();

  return s;

}

/* =========================================================
   ROOT KEY
========================================================= */

function rootKey(name = "") {

  let s = cleanName(name);

  s = s.replace(/\s+TV$/,"");

  s = s.normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/Ç/g,"C")
    .replace(/Ğ/g,"G")
    .replace(/İ/g,"I")
    .replace(/Ö/g,"O")
    .replace(/Ş/g,"S")
    .replace(/Ü/g,"U");

  s = s.replace(/[^A-Z0-9]/g,"");

  return s;

}

/* =========================================================
   SLUG
========================================================= */

function slugify(name){

  return cleanName(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/Ç/g,"C")
    .replace(/Ğ/g,"G")
    .replace(/İ/g,"I")
    .replace(/Ö/g,"O")
    .replace(/Ş/g,"S")
    .replace(/Ü/g,"U")
    .replace(/[^A-Z0-9]+/gi,"-")
    .replace(/^-|-$/g,"")
    .toLowerCase();

}

/* =========================================================
   SAYI KORUMASI
========================================================= */

function sameSeries(a,b){

  const na=(a.match(/\d+/g)||[]).join(",");
  const nb=(b.match(/\d+/g)||[]).join(",");

  return na===nb;

}

/* =========================================================
   BENZERLİK SKORU
========================================================= */

function similarity(a,b){

  if(a===b) return 1;

  let score=0;

  if(a.startsWith(b)||b.startsWith(a))
    score+=0.45;

  const aw=a.match(/[A-Z0-9]+/g)||[];
  const bw=b.match(/[A-Z0-9]+/g)||[];

  const common=aw.filter(x=>bw.includes(x)).length;

  score+=common/Math.max(aw.length,bw.length)*0.35;

  let same=0;

  for(const c of a)
    if(b.includes(c)) same++;

  score+=same/Math.max(a.length,b.length)*0.20;

  return score;

}

/* =========================================================
   TEK M3U OKUMA
========================================================= */

function readPlaylist(file){

  if(!fs.existsSync(file)) return [];

  const text=fs.readFileSync(file,"utf8");
  const lines=text.split(/\r?\n/);

  const list=[];

  let current=null;

  for(const line of lines){

    if(line.startsWith("#EXTINF")){

      current={

        raw:line.match(/,(.*)$/)?.[1]?.trim()||"Kanal",

        group:normalizeGroup(
          line.match(/group-title="([^"]+)"/)?.[1]||""
        ),

        logo:line.match(/tvg-logo="([^"]+)"/)?.[1]||"",

        stream:""

      };

    }

    else if(current && /^https?:\/\//.test(line)){

      current.stream=line.trim();

      list.push(current);

      current=null;

    }

  }

  return list;

}

/* =========================================================
   ANA LİSTE REFERANSI
========================================================= */

function buildReference(){

  const reference=new Map();

  const base=readPlaylist(PLAYLISTS[0].file);

  for(const c of base){

    reference.set(rootKey(c.raw),{

      id:slugify(c.raw),

      name:cleanName(c.raw),

      group:c.group,

      logo:c.logo,

      alternatives:[]
    });

  }

  return reference;

}

/* =========================================================
   EN İYİ EŞLEŞME
========================================================= */

function findBest(name,reference){

  const key=rootKey(name);

  if(reference.has(key))
    return reference.get(key);

  let best=null;
  let bestScore=0;

  for(const [rKey,channel] of reference){

    if(!sameSeries(key,rKey))
      continue;

    const score=similarity(key,rKey);

    if(score>bestScore){

      bestScore=score;
      best=channel;

    }

  }

  if(bestScore>=0.86)
    return best;

  return null;

}

/* =========================================================
   TÜM LİSTELERİ YÜKLE
========================================================= */

function loadM3U(){

  const reference=buildReference();

  grouped={
    Ulusal:[],
    Spor:[],
    Haber:[],
    Belgesel:[],
    Çocuk:[],
    Diğer:[]
  };

  for(const playlist of PLAYLISTS){

    const list=readPlaylist(playlist.file);

    for(const item of list){

      const channel=
        playlist.source==="Ana"
          ? reference.get(rootKey(item.raw))
          : findBest(item.raw,reference);

      if(!channel) continue;

      if(item.logo && !channel.logo)
        channel.logo=item.logo;

      if(!channel.alternatives.some(a=>a.url===item.stream)){

        channel.alternatives.push({

          source:playlist.source,

          url:item.stream

        });

      }

    }

  }

  channels=[...reference.values()];

  for(const c of channels){

    grouped[c.group].push(c);

  }

  console.log(`TATA Smart Parser`);
  console.log(`Kanal: ${channels.length}`);

  const total=channels.reduce(
    (a,c)=>a+c.alternatives.length,
    0
  );

  console.log(`Toplam yayın: ${total}`);

  return channels;

}

loadM3U();

/* =========================================================
   EXPORT
========================================================= */

module.exports={

  loadM3U,

  getChannels:()=>channels,

  getGroups:()=>grouped,

  getChannel:id=>channels.find(c=>c.id===id)

};
