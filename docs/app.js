const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 Minuten
const WORKER_URL = "https://boersen-proxy.leonard-hankel.workers.dev";

// Wird an JEDE Strategie-Anfrage automatisch angehaengt (Kennzahlen +
// Umgang mit Cookie-/Werbe-Text auf den Kursquellen + Nachrichtenlage).
const COMMON_DATA_INSTRUCTIONS = `

ZUSÄTZLICHE PFLICHTANGABEN FÜR ALLE KANDIDATEN (unabhängig von der Strategie):
- Aktueller Kurs, KGV, Volatilität der vergangenen 3 Monate (annualisiert), 12-Monats-Hoch und 12-Monats-Tief.
- Quelle bevorzugt finanzen.net, alternativ onvista.de oder boerse.de. Cookie-Hinweise, Werbeflächen oder Consent-Texte auf diesen Seiten sind normale Seitenbestandteile, keine Zugriffssperre – lies die eigentlichen Kursdaten trotzdem aus dem Seiteninhalt bzw. den Suchergebnissen heraus, ignoriere Banner-/Werbetext einfach.
- Tagesaktuelle Nachrichtenlage je Kandidat: aktive Katalysatoren, News der letzten 24–48 Stunden, anstehende Events (Earnings, Zentralbank-Termine, Regulatorik). Bei Widerspruch zwischen technischem Signal und aktueller Nachrichtenlage hat die Nachrichtenlage Vorrang – Setup ggf. verwerfen oder explizit als "erhöhtes Risiko" kennzeichnen.`;

let newsData = { updated_at: null, sources: {} };
let activeSource = "all";
let strategies = [];

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------

function setupTabs() {
  const tabs = document.querySelectorAll(".tab-bar .tab[data-tab]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.disabled) return;
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      showPanel(tab.dataset.tab);
    });
  });
}

function showPanel(tabId) {
  const newsPanel = document.getElementById("panel-news");
  const strategiePanel = document.getElementById("panel-strategie");
  const sourceTabs = document.getElementById("source-tabs");

  const isNews = tabId === "news";
  newsPanel.style.display = isNews ? "grid" : "none";
  sourceTabs.style.display = isNews ? "flex" : "none";
  strategiePanel.style.display = tabId === "strategie" ? "block" : "none";
}

// ---------------------------------------------------------------------
// News-Tab
// ---------------------------------------------------------------------

async function loadNews() {
  try {
    const res = await fetch(`news.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    newsData = await res.json();
    updateTimestamp();
    renderSourceTabs();
    renderNews();
  } catch (err) {
    document.getElementById("panel-news").innerHTML =
      `<p class="error">Meldungen konnten nicht geladen werden (${err.message}). ` +
      `Beim nächsten automatischen Update sollte es wieder klappen.</p>`;
  }
}

function updateTimestamp() {
  const updatedEl = document.getElementById("updated-at");
  if (newsData.updated_at) {
    const d = new Date(newsData.updated_at);
    updatedEl.textContent = d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
  }
}

function renderSourceTabs() {
  const tabBar = document.getElementById("source-tabs");
  const sourceNames = Object.keys(newsData.sources || {});

  if (sourceNames.length === 0) {
    tabBar.innerHTML = "";
    return;
  }
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
  const panel = document.getElementById("panel-news");
  const sources = newsData.sources || {};
  const sourceNames = Object.keys(sources);

  if (sourceNames.length === 0) {
    panel.classList.remove("single-source");
    panel.innerHTML = '<p class="loading">Noch keine Meldungen vorhanden. Der erste automatische Lauf befüllt diese Seite in Kürze.</p>';
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

// ---------------------------------------------------------------------
// Strategie-Tab
// ---------------------------------------------------------------------

async function loadStrategies() {
  const select = document.getElementById("strategy-select");
  try {
    const res = await fetch(`strategies.json?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    strategies = data.strategies || [];

    select.innerHTML = "";
    for (const s of strategies) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      select.appendChild(opt);
    }
    select.addEventListener("change", updateStrategyHint);
    updateStrategyHint();
  } catch (err) {
    select.innerHTML = '<option value="">Strategien konnten nicht geladen werden</option>';
  }
}

function updateStrategyHint() {
  const select = document.getElementById("strategy-select");
  const hint = document.getElementById("strategy-hint");
  const strategy = strategies.find((s) => s.id === select.value);
  hint.textContent = strategy ? strategy.description || "" : "";
}

async function runStrategy() {
  const select = document.getElementById("strategy-select");
  const focusInput = document.getElementById("focus-input");
  const resultBox = document.getElementById("strategy-result");
  const button = document.getElementById("run-strategy-btn");

  const strategy = strategies.find((s) => s.id === select.value);
  if (!strategy) {
    resultBox.innerHTML = '<p class="error">Keine Strategie ausgewählt.</p>';
    return;
  }

  const focus = focusInput.value.trim() || "breiter Markt";
  const prompt = strategy.prompt.replaceAll("{{FOCUS}}", focus) + COMMON_DATA_INSTRUCTIONS;

  button.disabled = true;
  button.textContent = "Analyse läuft …";
  resultBox.innerHTML = '<p class="loading">Claude recherchiert und analysiert – das kann 30–60 Sekunden dauern …</p>';

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, useWebSearch: true }),
    });

    const data = await res.json();

    if (!res.ok) {
      const message = (data && (data.error?.message || data.error)) || `HTTP ${res.status}`;
      throw new Error(message);
    }

    const text = extractText(data);
    resultBox.innerHTML = "";
    const pre = document.createElement("div");
    pre.className = "strategy-text";
    pre.textContent = text || "(Keine Antwort erhalten.)";
    resultBox.appendChild(pre);
  } catch (err) {
    resultBox.innerHTML = `<p class="error">Analyse fehlgeschlagen: ${err.message}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Analyse starten";
  }
}

function extractText(data) {
  if (!data || !Array.isArray(data.content)) return "";
  return data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

setupTabs();
loadNews();
loadStrategies();
document.getElementById("run-strategy-btn").addEventListener("click", runStrategy);
setInterval(loadNews, REFRESH_INTERVAL_MS);
