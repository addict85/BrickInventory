# Begründungen zu `test/empty-holding-cleanup-db.test.js`

Die ausführlichen Kommentare aus `test/empty-holding-cleanup-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Wird der letzte Kaufpreis gelöscht, bleibt NICHTS zurück.

── Marcos Frage ────────────────────────────────────────────────────────────
„Gibt es noch ein Problem, wenn ein Kaufpreis entfernt wird, dass der Eintrag
noch sichtbar war?"

Ja — an mehreren Stellen. `parentQuantitySql` setzte die Menge auf 0 und
liess die Elternzeile stehen. Nachgemessen mit einem einzelnen Konto und zwei
Sets, bei einem davon der Kaufpreis gelöscht:

  Galerie      beide Sets, das leere mit „Menge 0"
  Statistik    Sets=2 (das leere zählte mit), Einheiten=1
  Bewertung    das leere Set mit ×1 bewertet — 20 CHF, die es nicht gibt

Der letzte Punkt war der schlimmste: `set.quantity || 1` in
src/finanzen/financeCalc.ts macht aus einer Menge von 0 eine 1. Als Schutz gegen
NULL gedacht, trifft es den echten Wert 0 — und das Portfolio wuchs um ein
Set, das niemand mehr besitzt. Dieselbe Verwechslung steckt an achtzehn
Stellen in dieser Datei; sie einzeln zu reparieren hiesse, achtzehnmal
dieselbe Regel zu pflegen.

Deshalb wird die Ursache beseitigt: Eine Menge von 0 entsteht gar nicht mehr.
Sie war ohnehin kein Zustand, den jemand absichtlich herstellen kann — beide
Mengenregler halten bei 1 (`min="1"` in der Webapp, `if (qty > 1)` in der
App).

── Warum der Test über die API geht und nicht über die Funktion ────────────
Weil genau dazwischen der Fehler sass: Die Erfassung war gelöscht, die
Elternzeile blieb. Ein Test auf `deleteSetRows()` allein hätte das nie
gesehen.
```

<a id="stelle"></a>
## `assert.ok(await haltZeile(db, uid, BLEIBT), 'das andere Set wurde mitg`

```text
Ohne diese Gegenrichtung wäre der Test auch grün, wenn das Löschen
einer Erfassung den ganzen Bestand mitnähme.
Zwei Fragen, zwei Tabellen (Migration 0036): Steht die Bestandszeile
noch, und wie viele Exemplare sagen die Erfassungen? Vorher
beantwortete die Spalte beides zugleich — und „weg" sah dabei genauso
aus wie „null Stueck".
```
