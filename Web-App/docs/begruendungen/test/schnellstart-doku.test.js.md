# Begründungen zu `test/schnellstart-doku.test.js`

Die ausführlichen Kommentare aus `test/schnellstart-doku.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Schnellstart in README.md (Wurzel) und Web-App/README.md führt zu einer
Installation, die compose.yaml starten kann. Die Befehle des Blocks laufen
wirklich, in einem Sandkasten mit compose.yaml, .env.example und scripts/;
nur git und docker nicht. Danach liest `docker compose config` das Ergebnis:
Jedes Secret liegt als Datei da, Caddy findet die eigene CA, die App
veröffentlicht keinen Port, und `pull` holt das veröffentlichte Image.
Ohne Docker-CLI wird übersprungen, in CI nicht.
```
