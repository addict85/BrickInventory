# Begründungen zu `src/infra/sseRegistry.ts`

Die ausführlichen Kommentare aus `src/infra/sseRegistry.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="offen"></a>
## `_offen`

```text
Verzeichnis der offenen Server-Sent-Events-Ströme.

── Woher das kommt ─────────────────────────────────────────────────────────
Das geordnete Herunterfahren (server.ts) wartet auf `httpServer.close()`.
Dessen Rückruf kommt erst, wenn die LETZTE Verbindung weg ist — und ein
SSE-Strom geht von sich aus nie weg. Genau deshalb hielt jeder Neustart die
volle Frist von acht Sekunden durch und endete danach über die Reissleine
mit `process.exit(1)`. Für Docker sah damit jedes `compose down` und jedes
Deploy aus wie ein Absturz.

Der Kommentar im Shutdown nannte das einen Ausnahmefall („bleibt eine
Verbindung hängen"). Der Regelfall ist es: Der Fortschrittskanal der Webapp
bleibt ausdrücklich dauerhaft offen, auch wenn gar kein Import läuft. Es gab
also praktisch keinen Neustart ohne die acht Sekunden.

Reine Keep-Alive-Verbindungen brauchen das übrigens NICHT — die beendet Node
beim Schliessen des Servers von selbst; nachgemessen. Es geht ausschliesslich
um Antworten, die absichtlich offen bleiben.

── Benutzung ───────────────────────────────────────────────────────────────
    const unregister = registerSse(res);
    …
    function cleanup() { unregister(); res.end(); }

`unregister()` ist mehrfach aufrufbar; die Aufräumpfade der Routen laufen
teils über zwei Wege (Client trennt / Job fertig).
```

<a id="closeallsse"></a>
## `closeAllSse`

```text
Alle offenen Ströme beenden. Aus dem Shutdown aufgerufen, BEVOR auf
`httpServer.close()` gewartet wird.

Vorher geht ein letztes Ereignis raus: Der Client soll wissen, dass hier
nicht die Verbindung abgerissen ist, sondern der Server geht — die Webapp
verbindet dann von selbst neu, statt einen Fehler anzuzeigen.

@returns Anzahl beendeter Ströme
```
