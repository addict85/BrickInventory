# Begründungen zu `core-dienste/service/CsvImportService.kt`

Die ausführlichen Kommentare aus `core-dienste/src/main/java/ch/brickinventoryapp/service/CsvImportService.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="startwatching"></a>
## `startWatching`

```text
Status-Beobachtung: SSE zuerst, Polling nur als Rückfallebene.

Vorher pollte dieser Service unabhängig vom ViewModel alle 1,5s
denselben Endpoint — zwei getrennte Implementierungen desselben
Sachverhalts, die beide gepflegt werden mussten. Jetzt teilt er sich
den [CsvImportSseClient] mit dem ViewModel (@Singleton, aber cold Flow:
jeder Collector bekommt seine eigene Verbindung). Der Fortschritt kommt
damit ohne Verzögerung statt im 1,5-Sekunden-Raster, und die
Statuslogik steht nur noch an einer Stelle: [applyStatus].
```

<a id="if"></a>
## `if`

```text
Anlaufschutz: Der Server meldet "idle", bis der Import-Job
tatsächlich angelegt ist. Der Service wird aber im selben Moment
gestartet wie der Upload — ohne dieses Fenster würde die erste
idle-Antwort den Service sofort wieder beenden, und der Nutzer
sähe nie einen Fortschritt. Erst nach GRACE_MS (oder sobald
einmal ein laufender Import gesehen wurde) gilt idle als "fertig".
```
