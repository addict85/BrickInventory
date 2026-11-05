# Begründungen zu `test/bilder-offline.test.js`

Die ausführlichen Kommentare aus `test/bilder-offline.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Bilder der Tabellen stehen auch ohne Netz.

── Marcos Anforderung ──────────────────────────────────────────────────────
„Die Android-App soll auch ohne Internet funktionieren. Ist es möglich, dass
die Bilder in den Tabellen gecached werden?"

Die DATEN lagen schon offline bereit (ResponseCache in der App: sets, parts,
minifigs, stats, catalog-meta). Die Bilder nicht — und der Grund war EINE
Kopfzeile.

── Warum `no-cache` das verhinderte ────────────────────────────────────────

`/images/*` lieferte `private, no-cache`. Das heisst nicht „nicht
zwischenspeichern", sondern „vor JEDER Verwendung rückfragen". Die App
behielt ihre Kopie also, durfte sie aber nicht benutzen, solange sie nicht
nachfragen konnte — und ohne Netz kann sie das nie.

Ihr Offline-Rückfall (AppModule.kt: bei IOException dieselbe Anfrage noch
einmal mit FORCE_CACHE) konnte deshalb nichts ausrichten: Eine erzwungene
Cache-Anfrage darf eine `no-cache`-Antwort nicht ausliefern. In den Tabellen
stand der Platzhalter.

── Warum `max-age=0` beide Anforderungen erfüllt ───────────────────────────

Die Kopfzeile stammt aus Nachtrag 37 und aus einer anderen Anforderung
desselben Nutzers: „wenn ein falsches Bild heruntergeladen wurde, soll
geprüft werden, ob ein neues auf dem Server vorhanden ist." Sie darf also
nicht einfach durch ein langes max-age ersetzt werden — davor stand eine
Woche ohne Rückfrage, und ein falsches Bild blieb sieben Tage stehen.

`max-age=0` ist die Zeile, die beides kann: Die Antwort ist sofort veraltet,
also fragt der Client bei jeder Verwendung nach (online unverändert), aber
eine veraltete Kopie DARF ausgeliefert werden, wenn die Rückfrage nicht
möglich ist (offline genau das Gewünschte).

Deshalb prüft diese Datei nicht „irgendein Cache-Control", sondern die drei
Eigenschaften, auf die es ankommt.
```
