const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const EPG_FILE = path.join(__dirname, "epg.xml");

let epg = {};

function normalize(name=""){
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[Çç]/g,"c")
    .replace(/[Ğğ]/g,"g")
    .replace(/[İIı]/g,"i")
    .replace(/[Öö]/g,"o")
    .replace(/[Şş]/g,"s")
    .replace(/[Üü]/g,"u")
    .replace(/[^a-zA-Z0-9]+/g,"")
    .toLowerCase();
}

function parseTime(str){

  if(!str) return null;

  const y=str.slice(0,4);
  const m=str.slice(4,6);
  const d=str.slice(6,8);
  const h=str.slice(8,10);
  const i=str.slice(10,12);
  const s=str.slice(12,14);

  return new Date(`${y}-${m}-${d}T${h}:${i}:${s}+03:00`);

}

function loadEPG(){

  epg={};

  if(!fs.existsSync(EPG_FILE)){
    console.log("EPG bulunamadı.");
    return;
  }

  const parser=new XMLParser({
    ignoreAttributes:false
  });

  const xml=parser.parse(
    fs.readFileSync(EPG_FILE,"utf8")
  );

  const programmes=xml.tv.programme || [];

  programmes.forEach(p=>{

    const id=normalize(p["@_channel"]);

    if(!epg[id]) epg[id]=[];

    epg[id].push({

      title:
        typeof p.title==="object"
        ? p.title["#text"]
        : p.title,

      start:parseTime(p["@_start"]),
      stop:parseTime(p["@_stop"])

    });

  });

}

function getCurrent(channelName){

  const id=normalize(channelName);

  const list=epg[id] || [];

  const now=new Date();

  let current=null;
  let next=null;

  for(let i=0;i<list.length;i++){

    const item=list[i];

    if(now>=item.start && now<item.stop){

      current=item;
      next=list[i+1] || null;

      break;

    }

  }

  if(!current){

    return{
      now:null,
      next:null
    };

  }

  const progress=
    (now-current.start)/
    (current.stop-current.start);

  return{

    now:{
      title:current.title,
      start:current.start,
      stop:current.stop,
      progress:Math.max(0,Math.min(1,progress))
    },

    next

  };

}

loadEPG();

module.exports={

  loadEPG,

  getCurrent

};
