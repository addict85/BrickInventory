# Begründungen zu `test/lagerort-db.test.js`

Die ausführlichen Kommentare aus `test/lagerort-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Lagerort gegen eine echte Datenbank.

── Warum mit DB ────────────────────────────────────────────────────────────

Der Kern sind zwei Dinge, die sich am Quelltext nicht beweisen lassen: dass
das Setzen ALLE Zeilen eines Teils trifft (dasselbe Teil steckt in mehreren
Sets) und dass die Übersicht Sets und Teile zu EINER Liste zusammenführt.
Beides sind Aussagen über Zeilen, nicht über Zeichen.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `assert.deepEqual(karte['Kiste 3'], { ort: 'Kiste 3', sets: 1, teile: 2`

```text
„Kiste 3" hat ein Set UND zwei Teilezeilen — ein Ort, nicht zwei
Einträge. Zwei getrennte Listen zu liefern hiesse, dass jede Oberfläche
sie selbst zusammenführt, und zwar jede für sich.
`figuren` kam am 24.09. dazu (Migration 0024): Eine Minifigur traegt
seitdem ebenfalls einen Lagerort und wird EIGEN gezaehlt, nicht zu den
Teilesorten addiert — sonst hiesse „2 Teilesorten" mal das eine und mal
das andere. Hier liegt keine Figur, also 0.
```
