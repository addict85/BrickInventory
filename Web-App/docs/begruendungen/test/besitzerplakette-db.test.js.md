# Begründungen zu `test/besitzerplakette-db.test.js`

Die ausführlichen Kommentare aus `test/besitzerplakette-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Wo ein Client eine Besitzer-Plakette zeichnet, muss die Antwort sie tragen.

── Der Befund ──────────────────────────────────────────────────────────────
NACHGEMESSEN in einem Haushalt aus zwei Konten, in dem nur das Unterkonto
etwas besitzt:

  /v1/sets (Galerie)          Plakette JA    Client zeichnet: ja
  /v1/parts (Set-Teile)       Plakette nein  Client zeichnet: nein
  /v1/parts/manual            Plakette JA    Client zeichnet: ja
  /v1/minifigs (Set-Figuren)  Plakette nein  Client zeichnet: JA   ← Lücke
  /v1/minifigs/manual         Plakette JA    Client zeichnet: ja

Die Set-Figurenliste gruppiert dieselbe Figur über alle Konten des Haushalts
(GROUP BY fig_number, source) und hatte danach keine einzelne user_id mehr —
withOwners() konnte also nichts anhängen. Gezeichnet haben die Plakette
beide Clients trotzdem: `ownerBadges(f)` in public/js/06-minifigs.js und
`OwnerBadges(fig.owners)` in MinifigsScreen.kt. Die Absicht stand im Code,
der Wert kam nie an — dieselbe Form wie bei der Teile-Bewertung.

Die Galerie löst dasselbe Problem seit jeher mit `array_agg(DISTINCT
user_id)`; die Figurenliste tut es jetzt genauso.

── Warum EINE Schleife für alle vier ───────────────────────────────────────
Vier gleichlautende Zusicherungen, getrennt aufgeschrieben, sind vier
Stellen, die auseinanderlaufen können — genau so ist die Lücke entstanden.

Voraussetzung: Test-DB über TEST_DATABASE_URL (Inhalt wird geleert!).
```

<a id="stelle"></a>
## `{`

```text
── Und die MIGRATIONEN, nicht nur das Schema ───────────────────────────

Diese Datei loescht das Schema und baut es neu auf. initSchemaOnce()
laeuft dabei voll durch (die Marke in schema_meta ist mit weg), bleibt
aber auf dem Stand von db/schema.sql — also VOR allen Migrationen. Das
ist nicht nur fuer diese Datei falsch, sondern fuer jede danach: Sie erbt
eine halbe Datenbank.

GEMESSEN beim Umzug der Teilemengen (Migration 0038): db/schema.sql legt
`parts.quantity DEFAULT 1` an, die Katalogzeilen tragen die echte Zahl.
Die naechste Datei, die die Migrationen laufen liess, brach ab — „Bei 8
Set-Teilen weicht parts.quantity vom Katalog ab". Der Riegel hatte recht.
```
