# Begründungen zu `test/teile-katalog-inkrementell-db.test.js`

Die ausführlichen Kommentare aus `test/teile-katalog-inkrementell-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Katalogänderung zieht in der Teile-Zusammenfassung nur die Gruppen
nach, die die geänderte Nummer enthalten, und nur in den Konten, die sie
führen (Migration 0079, zieheKatalogNach). Das Ergebnis gleicht einem
vollen Neuaufbau.

Nachweis „nicht neu gebaut“: Eine Marke in der Spalte storage, die nur ein
Neuaufbau überschreibt, bleibt in fremden Konten und fremden Gruppen stehen.
```
