# Begründungen zu `test/csv-date.test.js`

Die ausführlichen Kommentare aus `test/csv-date.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Datumsangaben aus CSV-Dateien.

`new Date('05.03.2026')` liefert den **3. Mai**, nicht den 5. März —
JavaScript liest punktgetrennte Daten amerikanisch als MM.DD.YYYY. Dasselbe
gilt für Postgres bei DateStyle MDY. Eine Datei mit Schweizer Datumsangaben
landete dadurch mit vertauschten Tagen und Monaten in der Datenbank, und bei
Tagen über 12 scheiterte der Import ganz.

Ausführen: npm test
```

<a id="stelle"></a>
## `/**`

```text
Hier stand `beide Importe benutzen den Parser` — eine Prüfung über die
AUFGEZÄHLTE Liste ['sets.ts', 'parts.ts']. Sie war grün, während
routes/minifigs.ts das Datum roh weiterreichte: Der dritte Import stand
nicht in der Liste, also hat ihn niemand geprüft.

Das ist die Lehre und nicht die Ausnahme. Eine aufgezählte Liste prüft, woran
jemand beim Schreiben gedacht hat; genau das ist bei der nächsten neuen
Stelle nicht mehr gegeben. Der Test darunter sucht die Aufrufer stattdessen.
```

<a id="jeder-csv-import-normalisiert-das-datum"></a>
## `test('jeder CSV-Import normalisiert das Datum', () => {`

```text
Jeder CSV-Import läuft durch parseCsvDate — nicht nur die, an die jemand dachte.

── Warum diese Prüfung dazukam ─────────────────────────────────────────────
Die Funktion oben ist vollständig geprüft, und trotzdem stand der Fehler noch
in der Anwendung: `routes/minifigs.ts` las `erfassungsdatum` roh aus der Zeile
und reichte es als Datum weiter. Sets und Teile benutzten parseCsvDate, die
Minifiguren nicht — der dritte Aufrufer hat die Behebung nie bekommen.

Nachgemessen an der Datenbank, nicht angenommen:

    SHOW DateStyle          -> ISO, MDY
    SELECT '01.02.2026'::date -> 2026-01-02      (2. Januar!)
    SELECT '31.02.2026'::date -> ERROR

Unter Tag 13 also stille Verfälschung, darüber ein abgebrochener Eintrag. Die
Erfassung landete auf dem falschen Tag oder gar nicht — beides ohne Meldung
an den Nutzer.

Ein Test der Funktion beweist nicht, dass sie gerufen wird. Deshalb läuft
hier der Zeilenleser der Importe selbst: der der Sets (setCsvZeilen) und
der gemeinsame für Teile und Figuren (csvGemeinsameFelder). Dass beide
Importe ihn auch benutzen, prüft test/csv-rundlauf-db.test.js am Rundlauf.
```
