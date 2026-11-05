# Begründungen zu `test/image-thumb-fallback.test.js`

Die ausführlichen Kommentare aus `test/image-thumb-fallback.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Fehlt die Vorschau, kommt sofort das grosse Bild.

── Woher dieser Test kommt (Marcos Anforderung, Nachtrag 40) ───────────────
Wörtlich: „Der Client soll das Bild jeweils direkt erhalten und nicht warten,
bis noch das Thumbs-Image generiert wurde. Ist kein Thumb vorhanden, soll das
grosse Bild zurückgeliefert werden."

Der Bild-Proxy hielt es für CDN-Bilder längst so (routes/imgProxy.ts:
Original sofort, Verkleinerung in die Warteschlange). Die LOKALE Route
/images/* tat es nicht: Bei fehlender _thumb-Datei sprang sie gleich zum
CDN-Umweg oder endete in 404 — obwohl das grosse Bild einen Ordner weiter
lag. Getroffen hat das genau das Zeitfenster nach dem Erfassen: Die Vorschau
entsteht im Hintergrund (setImmediate → generateThumb), und wer in diesen
Sekunden die Galerie öffnete, bekam nichts.

Bewusst wird die Vorschau NICHT im Anfragepfad erzeugt: Das kostete rund
150 ms Jimp je Anfrage und summierte sich bei einer Kachelwand zu Sekunden.
Bis der Hintergrundlauf fertig ist, ist das Original das bessere Bild als
gar keines.

Geprüft wird das VERHALTEN der Route, nicht ihr Wortlaut: echte Dateien,
echte HTTP-Anfragen. Die Auslieferung selbst übernimmt express (sendFile),
deshalb genügt hier ein Nachbau der Routenlogik ohne Anmeldung — die prüft
test/media-auth.test.js.
```

<a id="src-stelle"></a>
## `const src = require('./helpers/sources')`

```text
Reihenfolge zählt: Ein lokal vorhandenes Original ist immer besser als ein
Umweg über das CDN — schneller, ohne fremden Dienst, ohne Kontingent.
ohneKommentare() VOR dem indexOf (Nachtrag 155): Ein Blockkommentar in
server.ts trug "app.get('/images/*', …)" als Beispiel, und indexOf() fand
das Beispiel statt der Route — das Fenster lag dann im Dateikopf. Der
Filter weiter unten entfernte nur //-Zeilen, nicht Blockkommentare.

Genau diese Falle steht in der JSDoc von ohneKommentare() bereits
beschrieben, samt demselben Beispiel. Der Helfer war da; er wurde hier nur
nicht benutzt.
```

<a id="ohnekommentare"></a>
## `const ohneKommentare = src.slice(start).slice(0, 4000);`

```text
Erst Kommentare weg, DANN schneiden (Nachtrag 48): Vorher wurde das
4000-Zeichen-Fenster aus dem rohen Quelltext genommen — ein gewachsener
Erklärtext schob die geprüfte Zeile hinaus, und der Test wurde rot, obwohl
die Regel galt. Dieselbe Falle wie schon bei data-layout und den beiden
Kotlin-Tests; sie tritt zuverlässig auf, sobald jemand einen Kommentar
ergänzt.
```
