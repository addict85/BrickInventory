# Begründungen zu `test/lagerort-id-db.test.js`

Die ausführlichen Kommentare aus `test/lagerort-id-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Lagerort am Bestand ist eine ID — und was das rettet.

── Marcos Frage ────────────────────────────────────────────────────────────

  „Wäre es nicht schöner wenn auf den Sets eine id für storage abgelegt
   wäre?"

Ja, und zwar nicht aus Geschmack. Diese Datei führt genau den Ablauf durch,
der mit dem NAMEN schiefging. Gemessen, beide Male, mit demselben Skript:

                             vorher (Name)        jetzt (ID)
  Vorrat                     ['Estrich']          ['Estrich']
  am Set getippt: "estrich"  Set: "estrich"       Set: "Estrich"
  Umbenennen → Dachboden     Set: "estrich"  (!)  Set: "Dachboden"
  Löschen des Ortes          GELUNGEN        (!)  abgelehnt (belegt)
  Auswahlliste danach        []              (!)  ['Dachboden']

Drei Symptome, eine Ursache: Die Zuordnung wurde zeichengenau verglichen,
die Eindeutigkeit im Vorrat aber ohne Rücksicht auf Gross-/Kleinschreibung
(`lower(name)`, Migration 0020). Am Ende stand genau das, wovor 0020 selbst
warnt — ein Wert, den die Oberfläche nicht zur Wahl stellt.

── Warum diese Datei und nicht ein Zusatz in lagerort-db.test.js ──────────

Dort steht, was der Lagerort TUT. Hier steht, warum er als ID dasteht. Das
sind zwei Fragen, und die zweite wird jemand stellen, der die Spalte sieht
und sie für Umstand hält.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```
