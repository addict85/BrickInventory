# Begründungen zu `utils/rateLimiter.ts`

Die ausführlichen Kommentare aus `utils/rateLimiter.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="consumerebrickabledaily"></a>
## `consumeRebrickableDaily`

```text
Einen Rebrickable-Aufruf vom Tageskontingent abziehen.

── Warum das nicht mehr über DailyLimiter läuft ────────────────────────────
Der Zähler lag in `this.count` — im Speicher EINES Prozesses. Der Server
läuft aber im Cluster: Jeder Worker legte seine eigene Instanz an und zählte
für sich bis zum Limit. Bei WORKERS = max(2, CPU-Kerne) waren auf einem
Vierkerner 100'000 Aufrufe möglich, wo 25'000 eingestellt sind.

Die DB-Schreibvorgänge in tryConsume() täuschten Gemeinsamkeit vor, waren
aber `SET value = <lokaler Stand>`: Der letzte Worker überschrieb den Wert
des vorigen, statt zu addieren. Die Anzeige im Monitoring zeigte damit den
Stand eines beliebigen Workers, nicht die Summe — und nach einem Neustart
stand sie wieder auf 0, während der Tag weiterlief.

Dasselbe war beim Login-Zähler schon einmal behoben worden
(utils/loginLimiter.ts: „bei N Cluster-Workern werden aus 5 Fehlversuchen
sonst N×5"), und für BrickLink und Brickset ist es von Anfang an richtig
gelöst: checkAndIncrementRateLimit() zählt in einer Transaktion mit
SELECT … FOR UPDATE, also einmal für die ganze Installation. Rebrickable war
die letzte der drei APIs mit einer eigenen Zählweise; jetzt gibt es nur noch
eine.

Nebeneffekt: Das gespeicherte Limit muss nicht mehr beim Start in den
Speicher geladen (loadDailyLimitsFromDb) und beim Ändern per setMax()
nachgezogen werden.

Der Kurzstrecken-Limiter (rebrickableLimiter, ein Aufruf je 1,5 s) bleibt
bewusst prozesslokal: Drosselung pro Prozess ist etwas anderes als ein
Tagesbudget.

@returns true, wenn der Aufruf erlaubt ist (und gezählt wurde)
```
