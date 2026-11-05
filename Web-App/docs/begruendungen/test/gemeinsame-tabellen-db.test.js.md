# Begründungen zu `test/gemeinsame-tabellen-db.test.js`

Die ausführlichen Kommentare aus `test/gemeinsame-tabellen-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Tabellen ohne user_id teilen sich alle Konten. Welche das sind, steht unten
in GEMEINSAM, je Tabelle mit Art und ob Eingaben eines Kontos hinein dürfen.
Die Tabellen kommen aus dem echten Schema, die schreibenden Stellen aus dem
Quelltext (eine neue Stelle auf eine Katalogtabelle muss hier eingetragen
werden), und ein Lauf mit Eingaben zweier Konten prüft, dass deren Werte in
keiner Tabelle mit `eingabe: false` ankommen.
```
