# Begründungen zu `test/sets-info-eindeutig-db.test.js`

Die ausführlichen Kommentare aus `test/sets-info-eindeutig-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Unter /api/v1/sets hängen zwei Router (routes/api_v1 und routes/sets.ts,
wie in server.ts). Der Namensabruf /sets/info/:setNumber stand im zweiten,
und eine Nummer, die wie ein Pfadwort der ersten aussieht, landete dort:
GET /api/v1/sets/info/price-history traf /sets/:setNumber/price-history mit
„info“ als Setnummer. Jetzt steht der Abruf im v1-Router vor allen Pfaden
mit Parameter.
```
