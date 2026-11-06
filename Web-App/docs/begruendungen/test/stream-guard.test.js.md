# Begründungen zu `test/stream-guard.test.js`

Die ausführlichen Kommentare aus `test/stream-guard.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Datei, die zwischen Prüfung und Auslieferung verschwindet, darf den
Prozess NICHT beenden.

── Warum es diese Datei gibt ───────────────────────────────────────────────
`fs.createReadStream(p).pipe(res)` stand an drei Stellen im Anfragepfad
(PDF-Download, Bild-Proxy für Vorschau und Cache). `.pipe()` hängt KEINEN
'error'-Zuhörer an die Quelle — und ein 'error' ohne Zuhörer ist in Node
kein Logeintrag, sondern eine geworfene Ausnahme. Ein Lesestrom auf eine
fehlende Datei beendet damit den Worker (nachgestellt: ENOENT →
uncaughtException → exit).

Das ist erreichbar, weil an allen drei Stellen zwischen „Datei ist da" und
„Datei öffnen" Zeit vergeht: Beim PDF räumt cleanOldPdfJobs mit seiner
10-Minuten-Frist auf, beim Bild-Proxy die Cache-Pflege. Ein voller
Datenträger oder entzogene Rechte lösen dasselbe aus. Dieselbe Fehlerklasse
wie der pgNotify-Absturz aus Nachtrag 27 — nur an anderer Stelle.

Geprüft wird in einem KINDPROZESS: „der Prozess stirbt" ist im Testprozess
selbst nicht beobachtbar, ohne den Testlauf mitzunehmen.
```
