const channel =
  new URLSearchParams(location.search).get("channel") || "TRT 1";

const titleEl = document.getElementById("title");
const descEl = document.getElementById("description");
const logoEl = document.getElementById("logo");
const heroEl = document.getElementById("hero");
const categoryEl = document.getElementById("category");

const nowEl = document.getElementById("nowPlaying");
const nextEl = document.getElementById("nextPlaying");

const watchBtn = document.getElementById("watchBtn");

const popularRow = document.getElementById("popular");
const newestRow = document.getElementById("newest");

/* ==========================================
   Skeleton
========================================== */

function skeleton(row, count = 6) {

  row.innerHTML = "";

  for (let i = 0; i < count; i++) {

    const div = document.createElement("div");

    div.className = "poster skeleton";

    div.innerHTML = `
      <div class="skeleton-img"></div>
    `;

    row.appendChild(div);

  }

}

/* ==========================================
   Poster Row
========================================== */

function renderRow(row, list) {

  row.innerHTML = "";

  list.forEach(item => {

    const card = document.createElement("div");

    card.className = "poster focusable";
    card.tabIndex = 0;

    card.innerHTML = `
      <img
        loading="lazy"
        src="${item.poster}"
        alt="${item.name}"
      >
      <div class="poster-title">
        ${item.name}
      </div>
    `;

    row.appendChild(card);

  });

}

/* ==========================================
   Hero
========================================== */

function applyHero(hub) {

  titleEl.textContent = hub.name;

  descEl.textContent = hub.description;

  categoryEl.textContent = hub.group;

  logoEl.src = hub.logo;

  heroEl.style.backgroundImage =
    `url(${hub.backdrop || hub.poster})`;

}

/* ==========================================
   EPG Placeholder
========================================== */

async function loadEPG() {

  try {

    const res = await fetch(
      `/epg/${encodeURIComponent(channel)}.json`
    );

    if (!res.ok) throw "";

    const data = await res.json();

    nowEl.textContent =
      data.now?.title || "Canlı Yayın";

    nextEl.textContent =
      data.next?.title || "Program Bekleniyor";

  }

  catch {

    nowEl.textContent = "Canlı Yayın";

    nextEl.textContent = "Sıradaki Program";

  }

}

/* ==========================================
   Hub
========================================== */

async function loadHub() {

  skeleton(popularRow);

  skeleton(newestRow);

  try {

    const res = await fetch(
      `/hub/${encodeURIComponent(channel)}.json`
    );

    const data = await res.json();

    if (!data.hub) return;

    applyHero(data.hub);

    renderRow(
      popularRow,
      data.hub.popular || []
    );

    renderRow(
      newestRow,
      data.hub.newest || []
    );

  }

  catch (e) {

    console.error(e);

  }

}

/* ==========================================
   Canlı İzle
========================================== */

watchBtn.addEventListener("click", async () => {

  try {

    const id = channel
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "")
      .toLowerCase();

    const res = await fetch(
      `/stream/tv/${id}.json`
    );

    const data = await res.json();

    if (data.streams?.length) {

      window.open(
        data.streams[0].url,
        "_blank"
      );

    }

  }

  catch (e) {

    console.error(e);

  }

});

/* ==========================================
   Android TV Focus
========================================== */

document.addEventListener("keydown", e => {

  const focusables = [
    ...document.querySelectorAll(".focusable")
  ];

  if (!focusables.length) return;

  const current = document.activeElement;

  let index = focusables.indexOf(current);

  if (e.key === "ArrowRight") {

    index = Math.min(
      focusables.length - 1,
      index + 1
    );

    focusables[index].focus();

  }

  if (e.key === "ArrowLeft") {

    index = Math.max(0, index - 1);

    focusables[index].focus();

  }

});

/* ==========================================
   Init
========================================== */

loadHub();

loadEPG();
