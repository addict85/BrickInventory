# Begründungen zu `test/lagerort-vorrat-db.test.js`

Die ausführlichen Kommentare aus `test/lagerort-vorrat-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der VORRAT an Lagerorten — gegen eine echte Datenbank.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„Der Lagerort soll ein Auswahlfeld mit einem Dropdown sein, bei dem man auch
gleich neue Auswahlwerte erfassen kann. Die Werte sollen pro User verwaltet
werden können und sollen in den Einstellungen bearbeitbar sein. Der
Grossvater soll die Werte der Enkel für die entsprechenden Sets sehen und
wählen können."

── Warum mit DB ────────────────────────────────────────────────────────────

Drei Aussagen dieser Änderung sind Aussagen über DATEN und lassen sich am
Quelltext nicht prüfen:

  1. Umbenennen schreibt die Zuordnungen mit um. Bliebe sie stehen, stünden
     die Sets danach in einem Ort, den die Auswahlliste nicht mehr kennt —
     ein Umbenennen wäre in Wahrheit ein Verlieren.
  2. Löschen ist eine ABSAGE, solange etwas darin liegt.
  3. „Regal A" und „regal a" sind dasselbe Regal.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```

<a id="frei"></a>
## `const frei = (await db.get(`

```text
── Was hier vorher stand, und warum es weg ist ─────────────────────────

„die Migration übernimmt bereits benutzte Orte": Migration 0020 las die
Namen aus `sets.storage` / `parts.storage` in den Vorrat, damit die
Auswahlliste nach der Umstellung nicht leer ist, „während in den Sets
weiter Orte stehen — die Oberfläche zeigte dann einen Wert an, den sie
selbst nicht zur Wahl stellt."

Diese beiden Spalten gibt es seit Migration 0031 nicht mehr (Marcos
Ansage: die bestehenden Zuordnungen durften weg). Die Prüfung konnte
ihre eigene Eingabe also nicht mehr herstellen — sie zu behalten hiesse,
eine Spalte wieder anzulegen, nur damit ein Test sie findet.

Geprüft wird jetzt der NACHFOLGER derselben Sorge: Ein Bestand, der auf
einen Ort zeigt, den der Vorrat nicht kennt, ist nicht mehr bloss
unerwünscht, sondern unmöglich. Das sagt kein Code mehr, sondern die
Fremdschlüssel-Regel aus 0031 — und genau das ist der Gewinn der
Umstellung.
```
