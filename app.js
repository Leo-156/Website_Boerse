const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 Minuten

async function loadNews() {
  const panel = document.getElementById("news-panel");

  try {
    const res = await fetch(`news.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    renderNews(data);
  } catch (err) {
    panel.innerHTML =
      `<p class="error">Meldungen konnten nicht geladen werden (${err.message}). ` +
      `Beim nächsten automatischen Update sollte es wieder klappen.</p>`;
  }
}

function renderNews(data) {
  const panel = document.getElementById("news-panel");
  const updatedEl = document.getElementById("updated-at");

  if (data.updated_at) {
    const d = new Date(data.updated_at);
    updatedEl.textContent = d.toLocaleString("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  const sources = data.sources || {};
  const sourceNames = Object.keys(sources);

  if (sourceNames.length === 0) {
    panel.innerHTML =
      '<p class="loading">Noch keine Meldungen vorhanden. Der erste automatische ' +
      "Lauf befüllt diese Seite in Kürze.</p>";
    return;
  }

  panel.innerHTML = "";
  for (const name of sourceNames) {
    const items = sources[name] || [];

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

    panel.appendChild(col);
  }
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
