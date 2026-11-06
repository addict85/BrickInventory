# Begründungen zu `test/bilder-ueber-proxy.test.js`

Die ausführlichen Kommentare aus `test/bilder-ueber-proxy.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jedes Bild geht über den eigenen Server — sonst blockt die Richtlinie es.

── Marcos Befund ───────────────────────────────────────────────────────────

„Die Bilder in der Merkliste werden nicht geladen. Anscheinend wird direkt
das CDN aufgerufen anstelle über den Proxy zu gehen wie bei allen anderen
Bildern." — In der Browser-Konsole stand dazu:

    Loading the image 'https://cdn.rebrickable.com/media/sets/21369-1.jpg'
    violates the following Content Security Policy directive:
    "img-src 'self' data: blob:". The action has been blocked.

Die Richtlinie ist richtig so (server.ts) — der Fehler lag in der Zeile:

    <img src="${esc(thumbUrl(w.image_url))}"        ← direkt ans CDN

thumbUrl() reicht seine Eingabe unverändert durch (01-bilder.js); erst
imgUrl() bzw. fullUrl() machen daraus eine Adresse auf dem eigenen Server.

── Was diese Prüfung festhält ──────────────────────────────────────────────

Nicht „Datei X muss Y enthalten", sondern die Regel: Wer in einem
src-Attribut ein Bildfeld einsetzt, muss es durch imgUrl() oder fullUrl()
schicken. Das ist die Naht, an der es zerbrochen ist.
```
