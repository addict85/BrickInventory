# Begründungen zu `test/img-proxy-size.test.js`

Die ausführlichen Kommentare aus `test/img-proxy-size.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Grosse CDN-Bilder landen im Cache und bekommen eine Vorschau.

── Woher dieser Test kommt (Marcos Fund, Nachtrag 43) ──────────────────────
Die Kachel für Set 60445-1 blieb leer, und der direkte Aufruf der
Proxy-Adresse mit `&thumb=1` lud „endlos", ohne das Bild je vollständig zu
zeigen. Die entscheidende Zahl stand in Marcos Netzwerk-Protokoll: 5'243 kB
übertragen — knapp ÜBER der damaligen 5-MB-Grenze des Cache-Zweigs.

Die Grenze bricht nur den CACHE-Strom ab, nicht die Auslieferung. Die Folge
war deshalb nicht „kein Bild", sondern etwas Zäheres:
  • `aborted` verhindert das rename → die Datei landet NIE im Cache
  • queueThumb() steht hinter diesem rename → es entsteht NIE eine Vorschau
  • jede Kachel holt daraufhin bei JEDEM Aufruf erneut die vollen 5 MB
Für dieses eine Bild wiederholte sich das endlos — genau das sah der Nutzer.

Zusätzlich geschah der Abbruch STILL: kein Logeintrag, kein Zähler. Ein
übergrosses Bild fiel damit in ein schwarzes Loch, in dem man ohne
Netzwerk-Protokoll nichts finden konnte.
```

<a id="proxy"></a>
## `const proxy = /const PROXY_CACHE_MAX_BYTES = (\d+) \* 1024 \* 1024;/.e`

```text
── Warum das zusammen geprüft wird (Nachtrag 47) ─────────────────────────
Nachtrag 43 hob nur die PROXY-Grenze an. Die zweite Grenze — die für das
lokal gespeicherte Set-Bild in routes/sets.ts — blieb bei 5 MB stehen, und
damit blieb Marcos Set weiter ohne lokales Bild: downloadSetImage()
liefert über der Grenze null, sets.image_local bleibt leer, generateThumb()
hat keine Datei zum Verkleinern, und beide Clients holen das Bild
weiterhin über den Proxy. Ein Weg repariert, der andere fiel weiter heraus.

Deshalb hängen die beiden Zahlen ab jetzt aneinander.
```
