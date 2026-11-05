# SSE-Endpoint für den CSV-Import-Fortschritt

**Status: serverseitig implementiert.** Der Endpoint existiert jetzt im
Backend (`routes/sets.js`) und wird von der Android-App sowie der Webapp
genutzt. Diese Datei dokumentiert das Zusammenspiel.

## Endpoint

```
GET /api/sets/import/csv/stream
Authorization: Bearer <token>      # Android (OkHttp)
# ODER  ?token=<token>             # Webapp (EventSource kann keine Header setzen)
Accept: text/event-stream
```

Jedes Event ist eine `data:`-Zeile mit demselben JSON-Schema wie der
bestehende `/status`-Endpoint:

```json
{ "success": true, "status": "running", "total": 1200, "done": 640,
  "current": "10256 Taj Mahal", "ok": 630, "warn": 8, "err": 2, "results": [...] }
```

Sobald `status` nicht mehr `running`/`pending` ist (`done`/`cancelled`/`error`),
sendet der Server ein letztes Event und schließt den Stream.

## Serverseitige Funktionsweise (routes/sets.js)

- Ein prozessweiter `EventEmitter` (`csvImportBus`) wird vom Import-Worker
  nach jedem `jobUpdate` gefeuert (`emitJobStatus(userId)`).
- Der Stream-Handler hört auf `progress:<userId>` und schiebt jeden Stand an
  den Client. Zusätzlich läuft ein DB-Fallback alle 5 s (rein serverlokal),
  falls ein Event verpasst wird — immer noch deutlich effizienter als das
  frühere 1,5-s-Client-Polling.
- Heartbeat-Kommentarzeilen (`: keep-alive`) alle 20 s halten die Verbindung
  durch Proxies offen; `req.on('close')` räumt Listener und Timer auf.
- Der `/status`-Endpoint bleibt unverändert als Fallback erhalten.

## Client-Verhalten

| Situation                                   | Verhalten                                       |
|--------------------------------------------|-------------------------------------------------|
| Android, App offen, Import läuft           | Live-Updates über SSE (OkHttp `okhttp-sse`)     |
| Android, SSE-Fehler                        | Automatischer Fallback auf `/status`-Polling    |
| Android, App im Hintergrund                | Foreground-Service pollt für die Notification   |
| Webapp, moderner Browser                   | Live-Updates über `EventSource`                 |
| Webapp, SSE-Fehler / kein EventSource      | Automatischer Fallback auf `/status`-Polling    |

## nginx / Reverse-Proxy

Für die Stream-Route darf **kein Response-Buffering** aktiv sein, sonst
kommen die Events gebündelt erst am Ende an. Der Handler setzt dafür bereits
`X-Accel-Buffering: no`. Falls nötig zusätzlich in der nginx-Location:

```
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
```
