# Begründungen zu `test/backup-restore-db.test.js`

Die ausführlichen Kommentare aus `test/backup-restore-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Sicherung und Wiederherstellung — einmal wirklich durchgespielt.

── Warum (Nachtrag 152) ────────────────────────────────────────────────────
Es gibt scripts/backup.sh und scripts/restore.sh, beide mit sorgfältig
begründeten Vorkehrungen. Und im README steht der Satz „Den Restore-Weg
einmal ausprobieren". Genau die Sorte Anweisung, die niemand befolgt — und
ein Backup, das nie zurückgespielt wurde, ist eine Vermutung, kein Backup.

Dieser Test spielt den Weg gegen eine echte Datenbank durch: Daten anlegen,
pg_dump, Datenbank verwüsten, zurückspielen, vergleichen. Er ruft die
Skripte nicht auf — die gehen über `docker compose exec` und brauchen den
laufenden Stapel. Geprüft wird stattdessen die MECHANIK, auf der beide
beruhen, plus (am Quelltext) dass die Skripte diese Mechanik auch benutzen.

Die zwei Vorkehrungen sind der eigentliche Gegenstand:

  • Die Endmarke. In POSIX-sh gibt es kein pipefail: Scheitert pg_dump am
    ANFANG der Pipe, läuft gzip trotzdem durch und hinterlässt eine kleine,
    formal gültige .gz-Datei. Ohne die Prüfung auf
    "PostgreSQL database dump complete" meldet backup.sh Erfolg — per Cron
    wochenlang wertlose Sicherungen.

  • ON_ERROR_STOP=1. Ohne diese Variable beendet sich psql auch bei einem
    halben Dump mit 0. Man glaubt wiederhergestellt zu haben und merkt es
    erst beim Benutzen.

Beide sind unten nicht nur behauptet, sondern gemessen — inklusive der
```

<a id="fassung"></a>
## `const fassung = (bin) => {`

```text
Die Fassung eines Klienten — gehört in die Fehlermeldung.

pg_dump und psql verweigern die Arbeit an einem NEUEREN Server, und genau
das ist ein Unterschied zwischen hier und dem CI-Lauf: lokal PostgreSQL 16,
im Lauf 18 (compose.yaml, geprüft in test/build-tooling.test.js). Steht die
Zahl in der Meldung, ist die Frage in einer Zeile beantwortet statt in
einer Runde.
```

<a id="lauf"></a>
## `const lauf = (args, datei) => spawnSync(psql, [...args, url, '-f', dat`

```text
── psql mit einem Dump füttern ──────────────────────────────────────────

Der Rückgabewert war NUR der Exit-Code, und `stdio: 'pipe'` verschluckt,
was psql zu sagen hatte. Ein Fehlschlag las sich dann als „1 !== 0" —
ohne einen Hinweis darauf, WELCHE Anweisung gescheitert ist.

GEMESSEN: Genau so ist dieser Test im CI-Lauf rot geworden, und weder das
Protokoll noch die Meldung sagten, woran. Ein Test, der nur „ging nicht"
meldet, kostet eine ganze Runde.

Der Parameter `mitStopp` ist dabei mit weggefallen: Er wurde nie
ausgewertet — ON_ERROR_STOP stand ohnehin fest drin, und für den anderen
Fall gibt es einspielenOhneStopp(). Ein Argument, das nichts tut, behauptet
etwas.
```
