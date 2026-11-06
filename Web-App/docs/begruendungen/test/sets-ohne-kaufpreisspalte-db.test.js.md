# Begründungen zu `test/sets-ohne-kaufpreisspalte-db.test.js`

Die ausführlichen Kommentare aus `test/sets-ohne-kaufpreisspalte-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
der Endstand und die Lesewege.

Kaufpreis und Zustand eines Sets stehen an GENAU EINEM Ort.

── Marcos Frage ────────────────────────────────────────────────────────────

  „Wieso gibt es denn in der Tabelle Sets noch ein purchase_price und ein
   condition? Kaufpreise und Zustand können doch mehrere pro Set erfasst
   werden, müsste das nicht in einer eigenen Tabelle sein?"

Sie war in einer eigenen Tabelle (`set_acquisitions`) — und gleichzeitig
weiterhin auf der sets-Zeile, als „Spiegel der neuesten Erfassung". Aus
diesem Nebeneinander sind drei gemeldete Fehler entstanden (Nachträge 51, 75
und der Android-Weg mit `resolvePrice: null`). Migration 0032 macht den
Schnitt.

── Was dieser Test prüft, und warum gegen eine FRISCHE Datenbank ───────────

Die zwei Spalten stehen weiterhin in db/schema.sql und in
spaltenMigrationen() — sie MÜSSEN dort stehen, weil Migration 0007 ein
`ALTER COLUMN purchase_price TYPE NUMERIC` enthält und das auf einer
fehlenden Spalte hart abbricht. Erst Migration 0032 am Ende der Kette
löscht sie.

Damit ist „die Spalte ist weg" eine Aussage über das ERGEBNIS der ganzen
Kette und nicht über eine einzelne Datei. Nur so geprüft hat die Prüfung
überhaupt eine Bedeutung: Auf der gemeinsamen Test-Datenbank ruft jede
Testdatei initSchema() auf, und das legt die Spalten jedes Mal wieder an
(0032 gilt dort längst als angewandt und läuft nicht erneut). Dieser Test
baut die Datenbank deshalb von null auf.

Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
REQUIRE_DB=1.
```

<a id="stelle"></a>
## `test.after(async () => {`

```text
── Nachlauf: aufgeraeumte Datenbank zuruecklassen ──────────────────────────

Diese Datei baut die Datenbank mehrfach von null auf — die uebrigen
Testdateien laufen danach weiter (node --test --test-concurrency=1, also
hintereinander in Dateinamen-Reihenfolge) und finden sonst einen Zustand,
den sie nicht erwarten.

GEMESSEN, als dieser Nachlauf fehlte: Der naechste Testlauf brach mit
„Migration 0023-merkliste.sql fehlgeschlagen: relation \"wanted\" already
exists" ab. Grund: Der letzte Probelauf unten wendet die Migrationen von
Hand an, ohne sie in schema_migrations zu vermerken — runMigrations() der
naechsten Datei hielt sie deshalb fuer offen und legte alles ein zweites Mal
an.

Deshalb zwei Dinge: `lauf()` vermerkt jede angewandte Datei (wie
db/migrate.ts), und hier wird am Ende EINMAL vollstaendig neu aufgebaut.
Das Schliessen des Pools steht EINMAL je Datei und nicht je Test: Ein
`t.after` im ersten Test schloss den Pool, bevor der zweite ihn brauchte.
```
