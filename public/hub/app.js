const channel =
  new URLSearchParams(location.search).get("channel") || "TRT 1";

const hero = document.getElementById("hero");
const title = document.getElementById("title");
const description = document.getElementById("description");
const logo = document.getElementById("logo");

const category = document.getElementById("category");
const nowPlaying = document.getElementById("nowPlaying");
const nextPlaying = document.getElementById("nextPlaying");

const popularRow = document.getElementById("popular");
const newestRow = document.getElementById("newest");

const watchBtn = document.getElementById("watchBtn");

/* =========================================
   ID ÜRET (parse-m3u.js ile aynı mantık)
========================================= */

function channelId(name){

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

/* =========================================
   Skeleton
========================================= */

function skeleton(row,count=6){

  row.innerHTML="";

  for(let i=0;i<count;i++){

    const card=document.createElement("div");

    card.className="poster skeleton";

    row.appendChild(card);

  }

}

/* =========================================
   Poster Satırı
========================================= */

function renderRow(row,list){

  row.innerHTML="";

  if(!list.length){

    row.innerHTML="<p style='color:#888'>İçerik bulunamadı.</p>";

    return;

  }

  list.forEach(item=>{

    const card=document.createElement("div");

    card.className="poster focusable";

    card.tabIndex=0;

    card.innerHTML=`
      <img loading="lazy"
           src="${item.poster || ""}"
           alt="${item.name}">
      <div class="poster-title">
        ${item.name}
      </div>
    `;

    row.appendChild(card);

  });

}

/* =========================================
   Hub Verisi
========================================= */

async function loadHub(){

  skeleton(popularRow);
  skeleton(newestRow);

  try{

    const res=await fetch(
      `/hub/${encodeURIComponent(channel)}.json`
    );

    if(!res.ok) throw new Error();

    const data=await res.json();

    const hub=data.hub;

    title.textContent=hub.name;

    description.textContent=hub.description;

    category.textContent=hub.group;

    logo.src=hub.logo;

    hero.style.backgroundImage=
      `url(${hub.backdrop || hub.poster})`;

    renderRow(popularRow,hub.popular || []);

    renderRow(newestRow,hub.newest || []);

  }

  catch(err){

    console.error("Hub:",err);

    popularRow.innerHTML=
      "<p style='color:#888'>Yüklenemedi.</p>";

    newestRow.innerHTML=
      "<p style='color:#888'>Yüklenemedi.</p>";

  }

}

/* =========================================
   EPG
========================================= */

async function loadEPG(){

  try{

    const res=await fetch(
      `/epg/${encodeURIComponent(channel)}.json`
    );

    if(!res.ok) throw new Error();

    const data=await res.json();

    nowPlaying.textContent=
      data.now?.title || "Canlı Yayın";

    nextPlaying.textContent=
      data.next?.title || "Sıradaki Program";

  }

  catch{

    nowPlaying.textContent="Canlı Yayın";

    nextPlaying.textContent="Sıradaki Program";

  }

}

/* =========================================
   Canlı İzle
========================================= */

watchBtn.addEventListener("click",async()=>{

  try{

    const res=await fetch(
      `/stream/tv/${channelId(channel)}.json`
    );

    const data=await res.json();

    if(!data.streams?.length){

      alert("Yayın bulunamadı.");

      return;

    }

    const stream=data.streams[0];

    window.location.href=stream.url;

  }

  catch(err){

    console.error(err);

    alert("Yayın açılamadı.");

  }

});

/* =========================================
   Android TV Focus
========================================= */

document.addEventListener("keydown",e=>{

  const items=[
    ...document.querySelectorAll(".focusable")
  ];

  if(!items.length) return;

  const current=document.activeElement;

  let index=items.indexOf(current);

  if(e.key==="ArrowRight"){

    index=Math.min(items.length-1,index+1);

    items[index].focus();

  }

  if(e.key==="ArrowLeft"){

    index=Math.max(0,index-1);

    items[index].focus();

  }

});

/* =========================================
   Başlat
========================================= */

loadHub();
loadEPG();
