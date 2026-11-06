# Begründungen zu `test/img-cache-serve.test.js`

Die ausführlichen Kommentare aus `test/img-cache-serve.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Auslieferungsreihenfolge des Bild-Proxys — AUSGEFÜHRT, nicht gelesen.

── Warum (Nachtrag 149) ────────────────────────────────────────────────────
`liefereAusCache()` entscheidet bei jeder einzelnen Bildanfrage, was
rausgeht: Vorschau, wenn eine brauchbare dasteht; sonst das Original, und
die Vorschau wird angestossen; sonst gar nichts, dann holt der Aufrufer beim
CDN. Bei einer Kachelwand läuft praktisch jede Anfrage hier durch.

Geprüft wurde diese Reihenfolge bisher an drei Stellen im Quelltext
(test/img-proxy.test.js, test/parts-paging.test.js, test/thumb-atomic.test.js)
— jede sucht nach einem Muster in src/katalog/bilder/imgCacheServe.ts. Das fängt, dass
jemand die Grössenprüfung LÖSCHT. Es fängt nicht, dass sie danebengreift:
ein `<` statt `<=`, eine vertauschte Reihenfolge der beiden Zweige, ein
`return` ohne `true`. Genau solche Fehler sind in diesem Modul schon
passiert — der Kommentar bei der 304-Behandlung nennt einen davon.

Hier läuft die echte Funktion gegen echte Dateien in einem Temp-Verzeichnis.
Die Antwort ist ein Attrappen-`res`, das mitschreibt, was gesetzt und
gesendet wurde; alles andere ist der Produktivcode.
```
