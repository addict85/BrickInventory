# Begründungen zu `test/offline-letzter-stand-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/offline-letzter-stand-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Offline zeigt eine Liste den zuletzt geladenen Stand dieses Tabs statt
eines Fehlers, und Band und Inhalt widersprechen sich nicht: Hat eine Liste
nie geladen, sagt sie „Keine Verbindung“, ihr „Erneut versuchen“ bleibt
bedienbar (es liest nur) und lädt von selbst, sobald die Verbindung zurück
ist. Eine Datei-Wahl im Label ist gesperrt wie jeder andere Knopf. Am
echten Bündel in jsdom, mit styles.css.
```
