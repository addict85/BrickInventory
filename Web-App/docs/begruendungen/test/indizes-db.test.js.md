# Begründungen zu `test/indizes-db.test.js`

Die ausführlichen Kommentare aus `test/indizes-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Kein Index ist der Anfang eines anderen derselben Tabelle, und jeder
Fremdschlüssel hat einen Index, der mit seinen Spalten beginnt — geprüft am
Katalog der migrierten Datenbank (Migration 0068).

Ein Präfix-Doppel bedient keine Suche, die der längere Index nicht auch
bedient, kostet aber bei jedem Schreiben. Ein Fremdschlüssel ohne Index
lässt jedes Löschen in der Elterntabelle die Kindtabelle durchsuchen
(minifigs_set_fk fehlte).
```
