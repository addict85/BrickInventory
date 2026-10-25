# Begründungen zu `utils/pgNotify.ts`

Die ausführlichen Kommentare aus `utils/pgNotify.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
PostgreSQL LISTEN/NOTIFY statt Datenbank-Polling.

── Was vorher lief ─────────────────────────────────────────────────────────
Zwei Schleifen fragten dauerhaft dieselbe Tabelle ab:
  • server.ts alle 5 s   → global_settings.csv_sync_trigger
  • dailyScheduler alle 3 s → global_settings.job_reschedule_trigger

Zusammen rund 28'800 Abfragen pro Tag und Worker, die praktisch immer nichts
finden. Bei mehreren Cluster-Workern entsprechend mehr. Postgres kann das
von sich aus melden.

── Warum die Zeile in global_settings trotzdem bleibt ──────────────────────
NOTIFY ist flüchtig: Wer im Moment des Signals nicht verbunden ist, bekommt
es nie. Der Datenbankeintrag bleibt deshalb die belastbare Quelle, NOTIFY ist
nur das Weckmittel. Beim Verbindungsaufbau — und nach jedem Reconnect — läuft
jeder Handler einmal an, damit ein währenddessen verpasstes Signal nachgeholt
wird. Damit ist kein Poller mehr nötig, ohne dass ein Trigger verlorengeht.

Die Verbindung ist bewusst eine eigene, nicht aus dem Pool: Ein Client, der
dauerhaft LISTEN hält, wäre im Pool blockiert und stünde für Abfragen nicht
mehr zur Verfügung.
```

<a id="retire"></a>
## `retire`

```text
Eine tote Verbindung aus dem Verkehr ziehen.

── Warum das nicht trivial ist ─────────────────────────────────────────────
Ein einziger Verbindungsabriss löst beim pg-Client DREI Ereignisse aus, in
dieser Reihenfolge (am laufenden Postgres 16 nachgemessen):

    error → error → end

Die vorherige Fassung hängte an 'error' und 'end' je einen Aufruf von
scheduleReconnect(), und dieser rief als Erstes `removeAllListeners()`.
Damit war nach dem ERSTEN Ereignis auch der 'error'-Zuhörer weg — und ein
'error'-Ereignis ohne Zuhörer ist in Node kein Logeintrag, sondern eine
geworfene Ausnahme. Das ZWEITE 'error' riss also den ganzen Prozess mit:

    Error: Connection terminated unexpectedly   → uncaughtException → exit(1)

Jeder Postgres-Neustart, jeder Netzaussetzer und jedes Idle-Timeout eines
davorliegenden Proxys hat damit den Worker abgeschossen, der die
LISTEN-Verbindung hielt. Der Cluster forkt zwar sofort Ersatz, aber alles,
was in diesem Worker lief, ist weg: offene SSE-Ströme (die hängen seit dem
Umbau je Verbindung an einem Kanal), laufende Anfragen, ein gerade
erzeugtes PDF. Und weil bei einem Postgres-Neustart ALLE Worker gleichzeitig
ihre Verbindung verlieren, trifft es sie auch alle gleichzeitig.

── Was jetzt gilt ──────────────────────────────────────────────────────────
• Der tote Client behält dauerhaft einen leeren 'error'-Zuhörer. Er kostet
  nichts und macht jedes Nachzügler-Ereignis harmlos. NIE removeAllListeners()
  ohne Ersatz für 'error'.
• retire() wirkt nur für den Client, der GERADE der aktive ist — die zwei
  Nachzügler desselben Abrisses laufen ins Leere, statt den Backoff dreifach
  hochzuzählen und drei Timer zu stellen.
```

<a id="unlisten"></a>
## `unlisten`

```text
Handler wieder abmelden.

Nötig, seit SSE-Verbindungen sich pro offener Verbindung auf einen Kanal
setzen (routes/sets.ts): Ohne Gegenstück wüchse _handlers mit jeder
geschlossenen Verbindung weiter, und jedes Signal liefe durch tote Handler,
die auf ein längst beendetes res schreiben.

LISTEN selbst wird bewusst NICHT zurückgenommen, solange noch irgendein
Handler auf dem Kanal hängt — und auch danach nicht: Ein überzähliges LISTEN
kostet nichts, ein fälschlich entferntes würde stillen Signalverlust
bedeuten.
```
