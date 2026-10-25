# Begründungen zu `jobs/instructionQueue.ts`

Die ausführlichen Kommentare aus `jobs/instructionQueue.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="db"></a>
## `db`

```text
Instruction download queue — persistent, survives restarts.
- Sets are added to instruction_queue when imported
- Worker processes pending entries respecting Brickset 100/day limit
- Pauses when daily limit reached, resumes next day automatically
- Backs off on Cloudflare 1015: 5min → 10min → 15min → 20min → next day

── Ein Prozess arbeitet, alle dürfen anstossen ─────────────────────────────
`_running`, `_timer` und der Cloudflare-Backoff lagen im Speicher EINES
Prozesses, die Warteschlange wurde aber aus drei Request-Handlern heraus
direkt angestossen (Set erfassen, CSV-Import, Admin-Reimport). Die laufen im
bearbeitenden Cluster-Worker, wo `_running` false war — dort startete also
eine zweite Abarbeitung derselben Warteschlange:

  - Zwei Prozesse zogen mit `WHERE status='pending' … LIMIT 1` DIESELBE
    Zeile und holten die Anleitung zweimal (doppelt verbrauchtes
    Brickset-Tageskontingent, zwei Downloads auf denselben Dateinamen).
  - Der Cloudflare-Backoff galt nur im Prozess, der die 1015 gesehen hat —
    der andere lief weiter und holte sich die nächste Sperre.
  - Die 15-Sekunden-Drossel zwischen zwei Anfragen halbierte sich.

Zwei Kommentare an den Aufrufstellen sagten „direkter processNext() falls
DIESER Prozess der Primary ist" — geprüft hat das nie jemand, processNext()
kannte den Primary gar nicht.

Jetzt gilt:
  1. Request-Handler rufen `requestRun()` — das setzt das Flag
     `instr_queue_trigger` und weckt den Primary per NOTIFY.
  2. `processNext()` hält für die Dauer EINES Eintrags eine
     prozessübergreifende Sperre (pg_try_advisory_lock). Wer sie nicht
     bekommt, geht wieder — ein künftiger Direktaufruf kann also nichts
     mehr verdoppeln. Die Regel hängt damit am Job, nicht an den
     Aufrufstellen.
  3. Die Nachfolge-Zeitgeber laufen nur im Prozess, in dem `start()` lief
     (also im Primary) — siehe `_driver`.
  4. Die Cloudflare-Pause steht in der Datenbank statt im Prozessspeicher
     und überlebt damit auch einen Neustart. Vorher nahm ein Neustart die
     Sperre nicht zur Kenntnis und lief 3 Sekunden später wieder los.
```

<a id="requestrun"></a>
## `requestRun`

```text
Abarbeitung ANSTOSSEN — für alles ausserhalb des Primary-Workers.

Setzt das Flag, das der Primary liest, und weckt ihn (siehe start()).
Kein direkter processNext(): Der Zeitgeber-Faden gehört in genau einen
Prozess, sonst laufen zwei Ketten mit eigener Drossel nebeneinander.

Zwei Schritte, und die Reihenfolge zählt: erst der Eintrag, dann das
Signal. Umgekehrt könnte der Primary aufwachen, bevor der Eintrag steht,
nichts finden und wieder einschlafen — und das Signal ist flüchtig, es
kommt kein zweites.
```

<a id="processnext"></a>
## Abschnitt

```text
── Takt nur nach einem ECHTEN Abruf (Nachtrag 142) ──────────────────

Die 15 Sekunden schonen Brickset und brickinstructions.com. Sets, die
schon eine Anleitung haben, fallen in downloadSetInstructions() sofort
heraus, OHNE eine Verbindung zu öffnen — für die gibt es nichts zu
schonen.

Vorher wartete die Schlange auch dort: Bei 800 Sets, von denen 700
längst versorgt sind, waren das knapp drei Stunden für nichts.
```

<a id="start-aufwecken"></a>
## `aufwecken`

```text
── Auf Zuruf statt im Dreisekundentakt ──────────────────────────────────

Hier stand ein setInterval(…, 3000), das `instr_queue_trigger` abfragte.
NACHGEMESSEN im Leerlauf: 9 Abfragen in 30 Sekunden, also rund 28'800 am
Tag, die praktisch immer nichts finden.

Genau diese Zahl steht im Kopf von utils/pgNotify.ts als Begründung
dafür, dass es das Modul gibt — es hat zwei solche Schleifen abgelöst
(csv_sync_trigger, job_reschedule_trigger). Diese dritte war übrig
geblieben. Nebenbei wirkt der Auslöser jetzt sofort statt bis zu drei
Sekunden später.

Der gespeicherte EINTRAG bleibt die belastbare Quelle, das Signal ist nur
das Weckmittel: NOTIFY ist flüchtig, wer im Moment des Signals
nicht verbunden ist, bekommt es nie. Deshalb ruft pgNotify den Handler
auch beim (Wieder-)Verbinden einmal ohne Signal auf — ein währenddessen
verpasster Anstoss wird dann nachgeholt, und kein Poller ist nötig.
```
