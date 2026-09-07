#!/usr/bin/env python3
"""
Boersen-News-Bot
-----------------
Ruft mehrere RSS-Feeds ab, erkennt neue Meldungen seit dem letzten Lauf
und verschickt sie per E-Mail. Gedacht zum Ausfuehren alle 15-30 Minuten
ueber GitHub Actions (siehe .github/workflows/check_news.yml), damit dein
eigener Rechner nicht durchlaufen muss.

Versand ueber die Brevo-API (kostenloser Transaktions-E-Mail-Dienst,
kein Gmail-App-Passwort noetig). Konfiguration ausschliesslich ueber
Umgebungsvariablen (siehe README.md):
  BREVO_API_KEY   API-Schluessel aus deinem Brevo-Account
  SENDER_EMAIL    die bei Brevo verifizierte Absender-Adresse
  RECIPIENT_EMAIL Empfaenger-Adresse (kann identisch mit SENDER_EMAIL sein)
Optional: KI-Einordnung ueber die Anthropic-API (Claude). Rein informativ,
KEINE Kauf-/Verkaufsempfehlung – das wird im Prompt untersagt und zusaetzlich
per festem Disclaimer-Text abgesichert. Env-Variable:
  ANTHROPIC_API_KEY  API-Schluessel von console.anthropic.com (optional;
                      ohne diese Variable wird die Einordnung einfach
                      uebersprungen und nur die reine Newsliste verschickt)
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import requests

DISCLAIMER = (
    "\u26a0\ufe0f Hinweis: Die folgende Einordnung ist automatisiert erstellt, "
    "rein informativ und stellt KEINE Anlageberatung und keine Kauf- oder "
    "Verkaufsempfehlung dar. Triff Anlageentscheidungen nicht allein auf "
    "dieser Basis."
)

# ---------------------------------------------------------------------------
# 1) Quellen konfigurieren
#    Einfach neue Zeilen hinzufuegen, um weitere "andere" Quellen einzubinden.
#    Name : RSS-Feed-URL
# ---------------------------------------------------------------------------
FEEDS = {
    "Handelsblatt – Finanzen": "https://www.handelsblatt.com/contentexport/feed/finanzen",
    "finanzen.net – News-Ticker": "https://www.finanzen.net/rss/news",
    "Bloomberg – Markets": "https://feeds.bloomberg.com/markets/news.rss",
    "onvista – News": "https://www.onvista.de/news/feed/rss.xml",
    "Börse Frankfurt – News": "https://api.boerse-frankfurt.de/v1/feeds/news.rss",
    "tagesschau.de – Wirtschaft/Finanzen": "https://www.tagesschau.de/wirtschaft/finanzen/index~rss2.xml",
    "Yahoo Finance – Top Stories (EN)": "https://finance.yahoo.com/rss/topstories",
    # "Der Aktionaer": "https://www.deraktionaer.de/aktionaer-news.rss",
    # "Wallstreet Online": "https://www.wallstreet-online.de/rss",
    # Hier kannst du weitere "andere" Quellen ergaenzen.
}

STATE_FILE = Path(__file__).parent / "seen_links.json"
MAX_SEEN_PER_FEED = 300  # verhindert, dass die Statusdatei unbegrenzt waechst

NEWS_JSON_FILE = Path(__file__).parent / "docs" / "news.json"
MAX_DISPLAY_PER_FEED = 25  # so viele Meldungen pro Quelle zeigt die Webseite

# ---------------------------------------------------------------------------
# 2) Worauf die KI-Einordnung achten soll (frei anpassbar)
#    Hier kannst du eintragen, welche Faktoren, Kennzahlen oder Strategien
#    dich interessieren. Wird nur genutzt, wenn ANTHROPIC_API_KEY gesetzt ist.
#    WICHTIG: Der Sicherheits-Teil (keine Kaufempfehlungen etc.) steht separat
#    weiter unten in get_ai_analysis() und wird IMMER zusaetzlich angehaengt,
#    egal was du hier reinschreibst.
# ---------------------------------------------------------------------------
ANALYSIS_FOCUS = """
Achte bei der Einordnung besonders auf:
- Value-Kennzahlen (z. B. KGV, KBV, Verschuldungsgrad)
- Wachstumsaussichten und Umsatz-/Gewinnentwicklung
- Dividendenrendite und -stabilitaet
- Makro-Faktoren wie Zinsentwicklung und Konjunktur
- Sektor-spezifische Trends (z. B. Automobil, Tech, Energie)
""".strip()


def load_seen_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print("Warnung: seen_links.json war beschaedigt, starte neu.", file=sys.stderr)
    return {}


def save_seen_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def entry_id(entry) -> str:
    """Eindeutige ID fuer einen Feed-Eintrag (guid, sonst Link, sonst Titel)."""
    return entry.get("id") or entry.get("link") or entry.get("title", "")


def fetch_new_entries(state: dict) -> tuple[list[dict], dict[str, list[dict]]]:
    new_items = []
    all_by_source: dict[str, list[dict]] = {}

    for source_name, feed_url in FEEDS.items():
        seen_ids = set(state.get(source_name, []))
        parsed = feedparser.parse(feed_url)

        if parsed.bozo and not parsed.entries:
            print(f"Warnung: Feed '{source_name}' konnte nicht gelesen werden: "
                  f"{parsed.bozo_exception}", file=sys.stderr)
            continue

        current_ids = []
        display_entries = []
        for entry in parsed.entries:
            eid = entry_id(entry)
            current_ids.append(eid)
            item = {
                "source": source_name,
                "title": entry.get("title", "(ohne Titel)"),
                "link": entry.get("link", ""),
                "published": entry.get("published", ""),
            }
            display_entries.append(item)
            if eid not in seen_ids:
                new_items.append(item)

        all_by_source[source_name] = display_entries[:MAX_DISPLAY_PER_FEED]

        # Statusliste aktualisieren: neueste zuerst, auf MAX_SEEN_PER_FEED begrenzen
        combined = current_ids + [i for i in seen_ids if i not in current_ids]
        state[source_name] = combined[:MAX_SEEN_PER_FEED]

    return new_items, all_by_source


def save_news_json(all_by_source: dict[str, list[dict]]) -> None:
    """Schreibt die aktuelle Newsliste fuer die Webseite (docs/news.json)."""
    NEWS_JSON_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sources": all_by_source,
    }
    NEWS_JSON_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_ai_analysis(new_items: list[dict]) -> str | None:
    """Fragt Claude nach einer neutralen Einordnung der neuen Meldungen.
    Gibt None zurueck, wenn kein ANTHROPIC_API_KEY gesetzt ist oder die
    Anfrage fehlschlaegt (Mail wird dann trotzdem ohne Einordnung verschickt)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return None

    items_text = "\n".join(f"- [{item['source']}] {item['title']}" for item in new_items)

    # Dein anpassbarer Teil (ANALYSIS_FOCUS oben im Skript) ...
    # ... plus fester Sicherheits-Teil, der IMMER dazukommt und nicht
    # durch ANALYSIS_FOCUS ueberschrieben werden kann.
    safety_rules = (
        "Nenne moegliche Chancen UND Risiken, bleib neutral und ausgewogen. "
        "Gib AUSDRUECKLICH KEINE Kauf- oder Verkaufsempfehlung fuer einzelne "
        "Aktien und keine Kursziele oder Renditeprognosen. Antworte auf "
        "Deutsch, maximal 200 Woerter, als Fliesstext ohne Ueberschriften."
    )
    prompt = (
        "Hier ist eine Liste aktueller Boersen-Nachrichten. Ordne sie kurz "
        f"ein.\n\n{ANALYSIS_FOCUS}\n\n{safety_rules}\n\nMeldungen:\n{items_text}"
    )

    try:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": 400,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=60,
        )
        response.raise_for_status()
        return response.json()["content"][0]["text"].strip()
    except requests.RequestException as exc:
        print(f"Warnung: KI-Einordnung fehlgeschlagen, Mail geht trotzdem raus: {exc}",
              file=sys.stderr)
        return None


def build_email_body(new_items: list[dict], analysis: str | None) -> str:
    lines = []

    if analysis:
        lines.append(DISCLAIMER)
        lines.append("")
        lines.append(analysis)
        lines.append("")
        lines.append("=" * 40)
        lines.append("")

    lines.append(f"{len(new_items)} neue Boersen-Meldung(en):")
    lines.append("")
    # Gruppiert nach Quelle, in der Reihenfolge, in der sie in FEEDS stehen
    by_source: dict[str, list[dict]] = {}
    for item in new_items:
        by_source.setdefault(item["source"], []).append(item)

    for source, items in by_source.items():
        lines.append(f"=== {source} ===")
        for item in items:
            lines.append(f"- {item['title']}")
            if item["published"]:
                lines.append(f"  ({item['published']})")
            lines.append(f"  {item['link']}")
        lines.append("")

    return "\n".join(lines)


def send_email(subject: str, body: str) -> None:
    api_key = os.environ["BREVO_API_KEY"]
    sender_email = os.environ["SENDER_EMAIL"]
    recipient = os.environ.get("RECIPIENT_EMAIL", sender_email)

    response = requests.post(
        "https://api.brevo.com/v3/smtp/email",
        headers={
            "accept": "application/json",
            "api-key": api_key,
            "content-type": "application/json",
        },
        json={
            "sender": {"email": sender_email, "name": "Boersen-News-Bot"},
            "to": [{"email": recipient}],
            "subject": subject,
            "textContent": body,
        },
        timeout=30,
    )
    if response.status_code >= 400:
        print(f"[Diagnose] Brevo-Antwort ({response.status_code}): {response.text}")
    response.raise_for_status()


def main() -> None:
    state = load_seen_state()
    is_first_run = not state  # beim allerersten Lauf gibt es noch keinen Vergleich

    new_items, all_by_source = fetch_new_entries(state)
    save_seen_state(state)
    save_news_json(all_by_source)

    if is_first_run:
        print(f"Erster Lauf: {len(new_items)} Eintraege als 'bekannt' markiert, "
              f"keine Mail verschickt.")
        return

    if not new_items:
        print("Keine neuen Meldungen.")
        return

    print(f"{len(new_items)} neue Meldung(en) gefunden, sende E-Mail ...")
    analysis = get_ai_analysis(new_items)
    subject = f"📈 {len(new_items)} neue Boersen-Nachricht(en)"
    body = build_email_body(new_items, analysis)
    send_email(subject, body)
    print("E-Mail verschickt.")


if __name__ == "__main__":
    main()
