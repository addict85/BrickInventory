# Begründungen zu `test/manuell-zustand-eine-regel-db.test.js`

Die ausführlichen Kommentare aus `test/manuell-zustand-eine-regel-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein manuell erfasstes Stück hat EINEN Zustand — egal, wer danach fragt.

── Warum es diese Datei gibt ───────────────────────────────────────────────
Dieselbe Frage („ist dieses Teil neu oder gebraucht?") wird an zwei Stellen
beantwortet, und beide lagen falsch — in ENTGEGENGESETZTE Richtungen:

  /api/v1/finance/parts-valuation   meldete JEDES Stück als gebraucht
  /api/v1/parts/manual              meldete ein gebrauchtes Stück als neu

Das fiel niemandem auf, weil jede Oberfläche nur EINE der beiden liest: Die
Webapp nimmt ihre Liste aus /parts/manual, die Android-App aus der Bewertung
(PartsScreen.kt: financeState.partsValuation?.parts). Am selben Teil zeigte
die eine App „Neu" und die andere „Gebraucht" — und die Bewertung holte den
Marktpreis zum falschen Zustand, der Fehler stand also auch im Geld.

Die Ursachen waren verschieden, die Bauart war dieselbe:
  • Bewertung: `stored = (p.condition === 'U') ? 'U' : DEFAULT_PRICE_CONDITION`
    — und die Konstante ist fest 'U'. Eine Fallunterscheidung, die keine war.
  • /parts/manual: Die Spaltenliste der Abfrage enthielt `condition` nicht.
    Der Rückfall bekam undefined. Die Schwesterfunktion für Minifiguren
    macht SELECT * und hatte den Fehler deshalb nie.

── Warum VERGLEICHEND statt je Stelle ──────────────────────────────────────
Eine Prüfung je Endpunkt hätte jede der beiden Fassungen für sich für
richtig erklären können — man muss ja wissen, was herauskommen SOLL. Der
Vergleich braucht das nicht: Zwei Antworten auf dieselbe Frage müssen
übereinstimmen, egal welche stimmt. Und die fünf Fälle darunter nageln fest,
welche es ist.

── Was Migration 0035 daran geändert hat ───────────────────────────────────

Die Fälle hiessen vorher „gespeichert U, ohne Erfassung → U": Es gab eine
Spalte `condition` an der Bestandszeile, und ohne Erfassung war sie die
einzige Auskunft. Migration 0035 hat sie geloescht — der Zustand steht je
KAUF in der Erfassung, so wie Marco es vorgegeben hat.

Die Fälle prüfen deshalb jetzt die Aggregat-Regel selbst, und das ist die
stärkere Prüfung: Sie deckt zwei Erfassungen in verschiedenen Zuständen ab,
was mit einer einzelnen Spalte nicht darstellbar war.

Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
```

<a id="fs-stelle"></a>
## `const fs = require('node:fs');`

```text
── Der Befund ─────────────────────────────────────────────────────────
Die Webapp holte sie aus /api/v1/parts/manual, die Android-App aus der
BEWERTUNG (financeState.partsValuation?.parts). Zwei Quellen fuer
dieselbe Liste — und genau daran haben die beiden Apps schon einmal
ENTGEGENGESETZTE Zustaende angezeigt (der Teilschritt darueber ist der
Nachweis, dass sie es heute nicht mehr tun).

NACHGESEHEN, welche Felder die App wirklich liest: ManualPartTile,
ManualFigTile und ManualItemDetailScreen benutzen ausschliesslich
Bestandsfelder — keinen einzigen Bewertungswert. Die App lud also die
ganze Bewertung samt Marktpreis-Abfragen, um Namen und Bilder
anzuzeigen.
```
