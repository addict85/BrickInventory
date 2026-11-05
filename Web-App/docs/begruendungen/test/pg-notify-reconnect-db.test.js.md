# Begründungen zu `test/pg-notify-reconnect-db.test.js`

Die ausführlichen Kommentare aus `test/pg-notify-reconnect-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
LISTEN/NOTIFY überlebt einen Verbindungsabriss — gegen echte Datenbank.

── Warum es diese Datei gibt ───────────────────────────────────────────────
Ein einziger Abriss der LISTEN-Verbindung löst beim pg-Client DREI Ereignisse
aus: error → error → end (am laufenden Postgres 16 nachgemessen). Die
vorherige Fassung von db/pgNotify.ts rief bei jedem davon
scheduleReconnect(), und das begann mit removeAllListeners() — nach dem
ersten Ereignis war damit auch der 'error'-Zuhörer weg. Ein 'error' ohne
Zuhörer ist in Node kein Logeintrag, sondern eine geworfene Ausnahme: Der
Worker starb mit „Connection terminated unexpectedly".

Betroffen war jeder Postgres-Neustart, jeder Netzaussetzer und jedes
Idle-Timeout eines vorgelagerten Proxys — und weil dann ALLE Worker
gleichzeitig ihre Verbindung verlieren, traf es sie auch alle gleichzeitig.
Mit ihnen starben offene SSE-Ströme und laufende Anfragen.

Das kann keine Quelltext-Prüfung sehen: Der Fehler steckte nicht in einem
fehlenden Aufruf, sondern in der REIHENFOLGE von Ereignissen einer fremden
Bibliothek. Deshalb hier ein echter Abriss per pg_terminate_backend() in
einem KINDPROZESS — nur so ist „der Prozess stirbt" überhaupt beobachtbar
(im Testprozess selbst würde er den Testlauf mitnehmen).
```
