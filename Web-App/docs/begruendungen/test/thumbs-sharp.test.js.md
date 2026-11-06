# Begründungen zu `test/thumbs-sharp.test.js`

Die ausführlichen Kommentare aus `test/thumbs-sharp.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Vorschaubilder entstehen mit sharp, nicht mehr mit Jimp.

── Warum der Umbau (Nachtrag 118) ──────────────────────────────────────────
Jimp ist reines JavaScript. Jede Verkleinerung läuft damit im selben Thread
wie alles andere — auf Marcos Raspberry Pi war das die teuerste Einzelarbeit
im ganzen Server. Fünf Nachträge lang habe ich sie gedrosselt (95, 99, 100,
113, 116), und am Ende blieb: dreissig Läufe je Minute sind immer noch zu
viel, weil jeder einzelne teuer ist.

sharp setzt auf libvips auf, rechnet in nativem Code und ausserhalb des
Event-Loops. Der eigentliche Gewinn ist nicht nur das Tempo, sondern dass der
Server währenddessen ansprechbar bleibt.

── Gemessen (PNG 1200×900 mit Transparenz) ─────────────────────────────────
    sharp     16 ms
    Jimp     566 ms          → Faktor 35

    webp:  sharp 12 ms
           Jimp  „Mime type image/webp does not support decoding"

Der webp-Fehler ist genau der, der in Marcos Log immer wieder auftauchte.

── Was dieser Test sichert ─────────────────────────────────────────────────
Dass sharp WIRKLICH benutzt wird (und nicht still auf Jimp zurückfällt),
dass der Rückfall trotzdem existiert, und dass die drei Eigenschaften
erhalten bleiben, die über die Jahre erkämpft wurden: mittiger Zuschnitt,
weisser Grund statt schwarz bei Transparenz, unteilbares Schreiben.
```
