# Begründungen zu `jobs/bricksetRetry.ts`

Die ausführlichen Kommentare aus `jobs/bricksetRetry.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Die Brickset-Wiederholungsschlange.

── Warum sie nicht mehr im Client steht (Nachtrag 127) ─────────────────────

Sie ist keine API-Anfrage, sondern Ablaufsteuerung: Sie liest eine Tabelle,
ruft den Client, und holt anschliessend Bauanleitungen nach. Genau dieses
letzte Stück machte den Client von utils/instructions.ts abhängig — und
utils/instructions.ts braucht den Client. Ein Kreis.

Beim Umzug der Anleitungs-Kette habe ich ihn selbst erzeugt und ihn erst
bemerkt, als die Prüfung auf Zyklen anschlug: `import` löst so etwas nicht
wie ein spätes `require()` auf, sondern liefert zur Ladezeit `undefined` —
ein Fehler, der erst im Betrieb auffällt.

Als eigener Job hängt sie an beiden, und beide hängen nicht an ihr.
```

<a id="processretryqueue"></a>
## `_processRetryQueue`

```text
Warteschlange abarbeiten — im Cluster immer nur ein Worker gleichzeitig.

── Warum eine EIGENE Verbindung ────────────────────────────────────────────
Advisory-Locks hängen an der SESSION, nicht an der Datenbank. Vorher liefen
pg_try_advisory_lock und pg_advisory_unlock über db.get()/db.run(), also
über den Verbindungspool — und der gibt für zwei Aufrufe in aller Regel
zwei verschiedene Verbindungen heraus.

Die Freigabe griff damit nicht: Sie wurde auf einer Session ausgeführt, die
den Lock nie gehalten hatte (Postgres meldet dann nur eine Warnung, die
.catch() verschluckt hat). Der Lock blieb auf der ursprünglichen Verbindung
bestehen — solange die im Pool lebt, also praktisch dauerhaft. Ab dem ersten
Lauf hiess es deshalb bei JEDEM weiteren Aufruf "skipped — another worker is
running", obwohl gar keiner lief.

Genau davor warnt der Kommentar in db/database.ts (initSchemaOnce) schon:
Lock und Unlock MÜSSEN auf derselben Session laufen. Hier fehlte die
Umsetzung.

Mit pool.connect() ist die Verbindung für die Dauer des Laufs reserviert und
wird in finally freigegeben. Stürzt der Prozess dazwischen ab, beendet
Postgres die Session und gibt den Lock automatisch frei — es kann also auch
dann nichts hängenbleiben.
```
