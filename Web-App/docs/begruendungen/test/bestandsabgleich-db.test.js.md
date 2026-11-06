# Begründungen zu `test/bestandsabgleich-db.test.js`

Die ausführlichen Kommentare aus `test/bestandsabgleich-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
„Kann ich das bauen?" — der Abgleich zwischen Teileliste und eigenem Bestand.

── Warum gegen eine echte Datenbank ────────────────────────────────────────

Der Kern ist eine einzige Abfrage, und ihr heikler Teil ist der JOIN über
`unnest($2::text[], $3::int[])`: zwei parallele Felder, die Postgres Zeile
für Zeile paart. Verrutscht die Reihenfolge, paart er Teilenummern mit
fremden Farben — und liefert dabei nicht etwa einen Fehler, sondern
plausible Zahlen zu den falschen Teilen. Genau das sieht man nur, wenn
wirklich Zeilen in der Tabelle stehen.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```

<a id="teile"></a>
## `const teile = [`

```text
Dieselbe Teilenummer in ZWEI Farben, und dieselbe Farbe bei ZWEI
Teilenummern: Nur so fällt eine verrutschte Paarung auf.
Die Spalte `quelle` ist WEG: haeltTeil() leitet sie aus der Setnummer
ab — eine Zeile mit Set ist ein Set-Teil, eine ohne ein manuelles.
Genau diese Regel wendet der Server seit jeher an, und zweimal
hingeschrieben waere sie zweimal zu pflegen. (Seit Migration 0038
entscheidet sie ausserdem, WOHER die Stückzahl kommt: Katalogzahl oder
Summe der Erfassungen.)
```
