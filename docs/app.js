const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 Minuten
const WORKER_URL = "https://boersen-proxy.leonard-hankel.workers.dev";

// Wird an JEDE Strategie-Anfrage automatisch angehaengt (Kennzahlen +
// Umgang mit Cookie-/Werbe-Text auf den Kursquellen + Nachrichtenlage).
const COMMON_DATA_INSTRUCTIONS = `

ZUSÄTZLICHE PFLICHTANGABEN FÜR ALLE KANDIDATEN (unabhängig von der Strategie):
- Aktueller Kurs, KGV, Volatilität der vergangenen 3 Monate (annualisiert), 12-Monats-Hoch und 12-Monats-Tief.
- Quelle bevorzugt finanzen.net, alternativ onvista.de oder boerse.de. Cookie-Hinweise, Werbeflächen oder Consent-Texte auf diesen Seiten sind normale Seitenbestandteile, keine Zugriffssperre – lies die eigentlichen Kursdaten trotzdem aus dem Seiteninhalt bzw. den Suchergebnissen heraus, ignoriere Banner-/Werbetext einfach.
- Tagesaktuelle Nachrichtenlage je Kandidat: aktive Katalysatoren, News der letzten 24–48 Stunden, anstehende Events (Earnings, Zentralbank-Termine, Regulatorik). Bei Widerspruch zwischen technischem Signal und aktueller Nachrichtenlage hat die Nachrichtenlage Vorrang – Setup ggf. verwerfen oder explizit als "erhöhtes Risiko" kennzeichnen.
- Gib grundsätzlich mehrere Kandidaten aus (nicht nur den einen "besten"), damit eine echte Auswahl zwischen Optionen möglich ist – die genaue Zielanzahl steht jeweils oben in der Strategie-Anweisung.
- Wo für die jeweilige Strategie sinnvoll, ergänzend nutzbare Kennzahlen: ADX(14)/MACD-Histogramm (Trendstärke), Relative Volume, Bid-Ask-Spread, Open Interest (Liquidität), IV-Percentile, HV/IV-Ratio, Volatilitäts-Term-Structure (Volatilitätskontext), Put/Call-Ratio, VIX/VSTOXX-Niveau, Short Interest/Days-to-Cover, COT-Report-Positionierung (Sentiment), 13F-Änderungen, Insider-Transaktionen, Analysten-Kurszieländerungen (institutionell/fundamental).`;

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
  const tradesPanel = document.getElementById("panel-trades");
  const sourceTabs = document.getElementById("source-tabs");

  const isNews = tabId === "news";
  newsPanel.style.display = isNews ? "grid" : "none";
  sourceTabs.style.display = isNews ? "flex" : "none";
  strategiePanel.style.display = tabId === "strategie" ? "block" : "none";
  tradesPanel.style.display = tabId === "trades" ? "block" : "none";
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
  const focusSelect = document.getElementById("focus-select");
  const focusCustom = document.getElementById("focus-custom");
  const resultBox = document.getElementById("strategy-result");
  const button = document.getElementById("run-strategy-btn");

  const strategy = strategies.find((s) => s.id === select.value);
  if (!strategy) {
    resultBox.innerHTML = '<p class="error">Keine Strategie ausgewählt.</p>';
    return;
  }

  const focus =
    focusSelect.value === "custom"
      ? focusCustom.value.trim() || "breiter Markt"
      : focusSelect.value;
  const prompt = strategy.prompt.replaceAll("{{FOCUS}}", focus) + COMMON_DATA_INSTRUCTIONS;

  button.disabled = true;
  button.textContent = "Analyse läuft …";
  const timerId = startLoadingUI(resultBox);

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, useWebSearch: true }),
    });

    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      if (res.status === 524 || /error code:\s*524/i.test(rawText)) {
        throw new Error(
          "Zeitüberschreitung (über 90 Sekunden). Versuch es nochmal, oder wähle im " +
            "Fokus-Feld einen engeren Markt/Sektor, damit weniger recherchiert werden muss."
        );
      }
      throw new Error(`Unerwartete Antwort (Status ${res.status}).`);
    }

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
    clearInterval(timerId);
    button.disabled = false;
    button.textContent = "Analyse starten";
  }
}

function startLoadingUI(resultBox) {
  resultBox.innerHTML = "";

  const text = document.createElement("p");
  text.className = "loading";
  text.textContent = "Claude recherchiert und analysiert (0s) …";
  resultBox.appendChild(text);

  const track = document.createElement("div");
  track.className = "loading-bar-track";
  const fill = document.createElement("div");
  fill.className = "loading-bar-fill";
  track.appendChild(fill);
  resultBox.appendChild(track);

  let seconds = 0;
  return setInterval(() => {
    seconds += 1;
    text.textContent = `Claude recherchiert und analysiert (${seconds}s) …`;
  }, 1000);
}

function extractText(data) {
  if (!data || !Array.isArray(data.content)) return "";
  return data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

// ---------------------------------------------------------------------
// Trades-Tab (nur lokal in diesem Browser gespeichert)
// ---------------------------------------------------------------------

const TRADES_STORAGE_KEY = "boersen_trades_v1";
let trades = [];

function loadTrades() {
  try {
    const raw = localStorage.getItem(TRADES_STORAGE_KEY);
    trades = raw ? JSON.parse(raw) : [];
  } catch (err) {
    trades = [];
  }
  renderTrades();
}

function saveTrades() {
  localStorage.setItem(TRADES_STORAGE_KEY, JSON.stringify(trades));
}

function addTrade() {
  const aktie = document.getElementById("trade-aktie").value.trim();
  const richtung = document.getElementById("trade-richtung").value;
  const knockout = parseFloat(document.getElementById("trade-knockout").value);
  const hebel = parseFloat(document.getElementById("trade-hebel").value);
  const betrag = parseFloat(document.getElementById("trade-betrag").value);
  const datumInput = document.getElementById("trade-datum").value;
  const datum = datumInput || new Date().toISOString().slice(0, 10);

  if (!aktie || isNaN(betrag) || betrag <= 0) {
    alert("Bitte mindestens Aktie/Basiswert und einen gültigen Betrag eingeben.");
    return;
  }

  trades.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    aktie,
    richtung,
    knockout: isNaN(knockout) ? null : knockout,
    hebel: isNaN(hebel) ? null : hebel,
    betrag,
    kaufdatum: datum,
    status: "offen",
    verkaufsbetrag: null,
    gewinnVerlust: null,
    verkaufsdatum: null,
  });

  saveTrades();
  renderTrades();
  resetTradeForm();
}

function resetTradeForm() {
  document.getElementById("trade-aktie").value = "";
  document.getElementById("trade-knockout").value = "";
  document.getElementById("trade-hebel").value = "";
  document.getElementById("trade-betrag").value = "";
}

function renderTrades() {
  const list = document.getElementById("trades-list");
  if (trades.length === 0) {
    list.innerHTML = '<p class="loading">Noch keine Trades erfasst.</p>';
    return;
  }
  list.innerHTML = "";
  for (const trade of trades) {
    list.appendChild(buildTradeRow(trade));
  }
}

function buildTradeRow(trade) {
  const row = document.createElement("div");
  row.className = "trade-row" + (trade.status === "verkauft" ? " closed" : "");

  const info = document.createElement("div");
  info.className = "trade-info";

  const title = document.createElement("div");
  title.className = "trade-title";
  title.textContent = `${trade.aktie} (${trade.richtung})`;
  info.appendChild(title);

  const metaParts = [];
  if (trade.knockout !== null) metaParts.push(`KO ${formatNumber(trade.knockout)}`);
  if (trade.hebel !== null) metaParts.push(`Hebel ${formatNumber(trade.hebel)}x`);
  metaParts.push(`Kauf ${trade.kaufdatum}`);
  const meta = document.createElement("div");
  meta.className = "trade-meta";
  meta.textContent = metaParts.join(" · ");
  info.appendChild(meta);

  row.appendChild(info);

  const amounts = document.createElement("div");
  amounts.className = "trade-amounts";

  const buyAmount = document.createElement("span");
  buyAmount.className = "trade-amount";
  buyAmount.textContent = `Einkauf: ${formatCurrency(trade.betrag)}`;
  amounts.appendChild(buyAmount);

  if (trade.status === "verkauft") {
    const sellAmount = document.createElement("span");
    sellAmount.className = "trade-amount";
    sellAmount.textContent = `Verkauf: ${formatCurrency(trade.verkaufsbetrag)}`;
    amounts.appendChild(sellAmount);

    const pl = trade.gewinnVerlust;
    const plPercent = (pl / trade.betrag) * 100;
    const plClass = pl >= 0 ? "gain" : "loss";
    const sign = pl >= 0 ? "+" : "";

    const plEuro = document.createElement("span");
    plEuro.className = `trade-pl ${plClass}`;
    plEuro.textContent = `${sign}${formatCurrency(pl)}`;
    amounts.appendChild(plEuro);

    const plPct = document.createElement("span");
    plPct.className = `trade-pl ${plClass}`;
    plPct.textContent = `${sign}${plPercent.toFixed(1)}%`;
    amounts.appendChild(plPct);
  } else {
    const sellBtn = document.createElement("button");
    sellBtn.type = "button";
    sellBtn.className = "sell-button";
    sellBtn.textContent = "Verkaufen";
    sellBtn.addEventListener("click", () => showSellForm(trade.id, row));
    amounts.appendChild(sellBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-button";
    deleteBtn.textContent = "Löschen";
    deleteBtn.addEventListener("click", () => deleteTrade(trade.id));
    amounts.appendChild(deleteBtn);
  }

  row.appendChild(amounts);
  return row;
}

function showSellForm(id, row) {
  if (row.querySelector(".sell-form")) return;

  const form = document.createElement("div");
  form.className = "sell-form";

  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.01";
  input.placeholder = "Gewinn (+) oder Verlust (-) in €";
  form.appendChild(input);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "run-button";
  confirmBtn.textContent = "Bestätigen";
  confirmBtn.addEventListener("click", () => {
    const value = parseFloat(input.value);
    if (isNaN(value)) {
      input.focus();
      return;
    }
    confirmSell(id, value);
  });
  form.appendChild(confirmBtn);

  row.appendChild(form);
  input.focus();
}

function confirmSell(id, gewinnVerlust) {
  const trade = trades.find((t) => t.id === id);
  if (!trade) return;

  trade.status = "verkauft";
  trade.gewinnVerlust = gewinnVerlust;
  trade.verkaufsbetrag = trade.betrag + gewinnVerlust;
  trade.verkaufsdatum = new Date().toISOString().slice(0, 10);

  saveTrades();
  renderTrades();
}

function deleteTrade(id) {
  trades = trades.filter((t) => t.id !== id);
  saveTrades();
  renderTrades();
}

function formatCurrency(value) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value);
}

function toggleFocusCustomInput() {
  const focusSelect = document.getElementById("focus-select");
  const focusCustom = document.getElementById("focus-custom");
  focusCustom.style.display = focusSelect.value === "custom" ? "block" : "none";
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

setupTabs();
loadNews();
loadStrategies();
loadTrades();
document.getElementById("run-strategy-btn").addEventListener("click", runStrategy);
document.getElementById("focus-select").addEventListener("change", toggleFocusCustomInput);
document.getElementById("add-trade-btn").addEventListener("click", addTrade);
setInterval(loadNews, REFRESH_INTERVAL_MS);
