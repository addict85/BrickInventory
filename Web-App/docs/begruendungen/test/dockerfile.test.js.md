# Begründungen zu `test/dockerfile.test.js`

Die ausführlichen Kommentare aus `test/dockerfile.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Bau-Image: keine Werkzeuge ohne Zweck.

python3/make/g++ standen als Vorsorge für node-gyp im Build-Stage. Sie werden
gebraucht, sobald ein Paket eine native Erweiterung aus C++-Quellen baut —
und von nichts anderem. Dieser Test hält beides zusammen: Sie dürfen nur
dann fehlen, wenn auch wirklich nichts kompiliert.

Kommt später eine Abhängigkeit dazu, die eine binding.gyp mitbringt, wird
dieser Test rot statt der Build. Ein `npm ci`, das mit „gyp ERR! find Python"
abbricht, ist deutlich schwerer zu deuten als eine Zeile hier.
```
