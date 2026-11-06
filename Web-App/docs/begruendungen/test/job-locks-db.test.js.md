# Begründungen zu `test/job-locks-db.test.js`

Die ausführlichen Kommentare aus `test/job-locks-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Prozessübergreifende Job-Sperren gegen eine ECHTE Datenbank.

── Warum das kein Quelltext-Test ist ───────────────────────────────────────
Eine Sperre lässt sich am Quelltext nur als Vorhandensein eines Aufrufs
prüfen — genau die Art Test, die in hardened-126 an der Gegenprobe
gescheitert ist (`if (false)` um den Aufruf und alles blieb grün). Hier wird
deshalb VERHALTEN geprüft: Der Test hält die Sperre selbst auf einer eigenen
Verbindung und schaut nach, ob der Job dann wirklich nichts tut.

Der Nachweis in hardened-128 brauchte dafür noch einen zweiten Node-Prozess.
Das geht einfacher: Ein Advisory-Lock hängt an der SESSION, nicht am Prozess
— eine zweite Verbindung aus demselben Test wirkt für den Job wie ein
zweiter Worker.

Zu jeder Sperre gehört eine Gegenprobe (ohne Sperre passiert sehr wohl
etwas), sonst würde der Test auch dann grün bleiben, wenn der Job gar nichts
mehr täte.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL,
Default postgres://tester:test@localhost/cattest. Ohne DB: skip.
```

<a id="stelle"></a>
## `{`

```text
── Und die MIGRATIONEN, nicht nur das Schema ───────────────────────────

Diese Datei loescht das Schema und baut es neu auf. Ohne die Migrationen
bleibt die Datenbank auf dem Stand von db/schema.sql stehen — also VOR
allen Migrationen —, und das ist nicht nur fuer sie selbst falsch,
sondern fuer jede Datei danach: Sie erbt eine halbe Datenbank.

GEMESSEN beim Umzug der Teilemengen (Migration 0038): db/schema.sql legt
`parts.quantity DEFAULT 1` an, die Katalogzeilen tragen die echte Zahl.
Die naechste Datei, die die Migrationen laufen liess, brach ab — „Bei 8
Set-Teilen weicht parts.quantity vom Katalog ab". Der Riegel hatte recht.
```
