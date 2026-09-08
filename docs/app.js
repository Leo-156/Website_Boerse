const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 Minuten

let newsData = { updated_at: null, sources: {} };
let activeSource = "all";

async function loadNews() {
  try {
    const res = await fetch(`news.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    newsData = await res.json();
    updateTimestamp();
    renderSourceTabs();
    renderNews();
  } catch (err) {
    document.getElementById("news-panel").innerHTML =
      `<p class="error">Meldungen konnten nicht geladen werden (${err.message}). ` +
      `Beim nächsten automatischen Update sollte es wieder klappen.</p>`;
  }
}

function updateTimestamp() {
  const updatedEl = document.getElementById("updated-at");
  if (newsData.updated_at) {
    const d = new Date(newsData.updated_at);
    updatedEl.textContent = d.toLocaleString("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }
}

function renderSourceTabs() {
  const tabBar = document.getElementById("source-tabs");
  const sourceNames = Object.keys(newsData.sources || {});

  if (sourceNames.length === 0) {
    tabBar.innerHTML = "";
    return;
  }

  // Falls die aktuell gewaehlte Quelle nicht mehr existiert, zurueck auf "Alle"
  if (activeSource !== "all" && !sourceNames.includes(activeSource)) {
    activeSource = "all";
  }

  tabBar.innerHTML = "";
  tabBar.appendChild(buildSourceTabButton("Alle", "all"));
  for (const name of sourceNames) {
    tabBar.appendChild(buildSourceTabButton(name, name));
  }
}

function buildSourceTabButton(label, value) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "source-tab" + (value === activeSource ? " active" : "");
  btn.textContent = label;
  btn.addEventListener("click", () => {
    if (activeSource === value) return;
    activeSource = value;
    renderSourceTabs();
    renderNews();
  });
  return btn;
}

function renderNews() {
  const panel = document.getElementById("news-panel");
  const sources = newsData.sources || {};
  const sourceNames = Object.keys(sources);

  if (sourceNames.length === 0) {
    panel.classList.remove("single-source");
    panel.innerHTML =
      '<p class="loading">Noch keine Meldungen vorhanden. Der erste automatische ' +
      "Lauf befüllt diese Seite in Kürze.</p>";
    return;
  }

  const namesToShow = activeSource === "all" ? sourceNames : [activeSource];
  panel.classList.toggle("single-source", activeSource !== "all");

  panel.innerHTML = "";
  for (const name of namesToShow) {
    panel.appendChild(buildSourceColumn(name, sources[name] || []));
  }
}

function buildSourceColumn(name, items) {
  const col = document.createElement("section");
  col.className = "source-column";

  const heading = document.createElement("h2");
  heading.className = "source-name";
  heading.textContent = name;
  col.appendChild(heading);

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "loading";
    empty.textContent = "Keine Meldungen verfügbar.";
    col.appendChild(empty);
  } else {
    for (const item of items) {
      col.appendChild(buildNewsItem(item));
    }
  }

  return col;
}

function buildNewsItem(item) {
  const entry = document.createElement("article");
  entry.className = "news-item";

  const link = document.createElement("a");
  link.href = item.link || "#";
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = item.title || "(ohne Titel)";
  entry.appendChild(link);

  if (item.published) {
    const time = document.createElement("time");
    time.textContent = item.published;
    entry.appendChild(time);
  }

  return entry;
}

loadNews();
setInterval(loadNews, REFRESH_INTERVAL_MS);
