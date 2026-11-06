# Begründungen zu `test/austabelle.test.js`

Die ausführlichen Kommentare aus `test/austabelle.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Nachschlagetabellen mit Schlüssel von aussen (Nachtrag 155).

Der Befund: `TABELLE[schluessel]` liefert in JavaScript auch GEERBTE
Eigenschaften, und die sind wahrheitswertig. Die verbreitete Absicherung
`TABELLE[k] || VORGABE` greift deshalb genau dann nicht, wenn sie soll.

Diese Datei prüft den Helfer selbst UND die drei Stellen, an denen das Muster
stand — die beiden tragenden über den Quelltext, weil ein ORDER BY bzw. ein
multer-fileFilter ohne laufende DB/Upload nicht sinnvoll zu fahren sind.
Für das Verhalten der Routen gibt es die DB-Suiten daneben.
```
