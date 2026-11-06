# Begründungen zu `test/async-routes.test.js`

Die ausführlichen Kommentare aus `test/async-routes.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein async-Handler, der wirft, wird zu einer 500 — ohne eigenen Wrapper.

Unter Express 4 blieb die Antwort aus, und ein Reverse-Proxy lieferte nach
seinem Timeout 502; server.ts umschloss deshalb jeden Router-Handler.
Express 5 (router 2) reicht abgelehnte Promises selbst an next() weiter.
Dieser Test hält fest, dass das für die installierte Fassung gilt — für
Handler wie für Middleware über router.use.
```
