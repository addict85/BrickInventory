# Begründungen zu `src/auftraege/importAuftrag.ts`

Die ausführlichen Kommentare aus `src/auftraege/importAuftrag.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Der Auftragsdatensatz eines laufenden Imports — EINE Zeile je Konto.

── Warum diese Datei entstanden ist (Marcos Wunsch vom 20.10.) ─────────────

„bitte auch noch umsetzen, dass der Import der BL-XML Importe in der
 Android-App angezeigt werden (analog den Set-Importen)."

Die App zeigt auf ALLEN Reitern einen Balken, sobald ein Import läuft —
„egal von wo er gestartet wurde" (MainScaffold.kt, CsvImportBanner). Gefüttert
wird er aus `csv_import_jobs` über den Strom /api/v1/sets/import/csv/stream;
dieselbe Quelle hat der globale Balken der Webapp
(public/js/01-fortschritt.js). Deshalb sieht ihn auch eine ZWEITE Sitzung
desselben Kontos: Der Datensatz hängt am Konto, nicht an der Anfrage.

Damit der Wanted-Listen-Import dort auftaucht, muss er in denselben
Datensatz schreiben. Die Zugriffe darauf lagen in routes/sets.ts — einer
Datei, die ihre Helfer ausdrücklich nicht mehr nach aussen reicht („Der
Anhang ist leer … kein Router mehr, der Hilfsfunktionen weiterreicht",
Nachtrag 131). Sie stehen deshalb jetzt hier.

── Was hier steht und was nicht ────────────────────────────────────────────

HIER: der Zustand (die Tabelle), seine Form nach aussen (buildJobStatus) und
das Signal, dass er sich geändert hat (Bus + LISTEN/NOTIFY).

NICHT hier: der SSE-Endpunkt und die /status-Route. Das ist HTTP-Oberfläche
und bleibt in routes/sets.ts; sie holen sich von hier, was sie brauchen.

Die englischen Namen sind beim Umzug geblieben. Sie stehen an 29 Stellen in
routes/sets.ts, und ein Umzug, der gleichzeitig umbenennt, ist zwei
Änderungen in einem Schritt — die zweite davon unbelegt.
```

<a id="job-columns"></a>
## `JOB_COLUMNS`

```text
Spalten, die jobSet()/jobUpdate() schreiben dürfen.

Beide Funktionen bauen ihre SET-/VALUES-Liste aus Object.keys(fields) — die
Spaltennamen gehen also UNPARAMETRISIERT ins Statement (Bezeichner lassen
sich in SQL nicht binden). Heute rufen nur interne Stellen mit fest
verdrahteten Objektliteralen auf, es ist also keine Lücke. Aber es ist genau
die Sorte Helfer, die irgendwann jemand mit `...req.body` füttert, und dann
ist es eine. Die Prüfung kostet nichts und macht den Fall unmöglich statt
unwahrscheinlich.
```

<a id="starteauftrag"></a>
## `starteAuftrag`

```text
„Ab jetzt läuft ein Import" — oder eben nicht.

Gibt `false` zurück, wenn schon ein Auftrag LÄUFT. Dann bleibt die Anzeige
bei dem, der zuerst da war: Der CSV-Import über 380 Sets ist das, worauf
jemand wartet; ihn aus dem Balken zu verdrängen, weil nebenher eine
Wanted-Liste eingelesen wird, wäre der falsche Tausch. Der Import läuft
trotzdem — nur ohne Balken in den anderen Sitzungen.

`results: []` und `done: 0` setzen den alten Stand zurück: Sonst stünde die
Zahl des letzten Laufs im Balken, bis die erste Meldung kommt.
```

<a id="zuletzt"></a>
## `_zuletzt`

```text
Fortschritt melden — GEDROSSELT.

Eine Liste mit 2000 Posten würde sonst 2000 UPDATEs und 2000
Benachrichtigungen auslösen, für einen Balken, den kein Auge so fein
auflöst. Gemeldet wird höchstens alle 300 ms; der Aufrufer sagt mit
`unbedingt`, wenn eine Meldung nicht wegfallen darf (die letzte).

Der Zeitpunkt wird JE KONTO gemerkt: Zwei Konten im Haushalt, die
gleichzeitig importieren, dürfen sich nicht gegenseitig die Meldungen
wegdrosseln.
```

<a id="beendeauftrag"></a>
## `beendeAuftrag`

```text
Der Auftrag ist durch.

`results` trägt je Posten ein Ergebnis — daraus rechnet buildJobStatus die
Zahlen ok/warn/err, die der Balken nach dem Ende zeigt. Ohne diese Liste
stünde dort „0 ok", obwohl alles geklappt hat.

── Drei Ausgänge, nicht zwei (GEMESSEN) ────────────────────────────────────

Ein Posten kann angelegt sein, scheitern — ODER offen bleiben, weil sich
seine Nummer oder Farbe nicht abbilden liess. Das ist kein Fehler, aber auch
kein Erfolg; es ist genau das, wofür buildJobStatus `warn` führt.

`done` kommt vom Aufrufer und ist die Zahl der BEARBEITETEN Posten. Hier
stand `ok + fehler`, und dann blieb der Balken stehen: Eine Liste mit drei
Posten, von denen einer offen blieb, endete bei „2 von 3" — 67 %, für immer.
Beim Abbrechen ist dieselbe Zahl richtig: Sie sagt, wie weit es kam.

── `zeilen`: echte Posten statt blosser Zähler (Marcos Befund vom 21.10.) ──

  „Nach dem Import erscheint dann ganz viele Zeilen mit
   Undefined - aktualisiert"

Die Liste unten war ein reiner ZÄHLER: `{ success: true }`, so oft wie nötig,
damit buildJobStatus daraus ok/warn/err rechnet. Das war alles, wofür ich
sie gebaut hatte — und ich hatte übersehen, dass dieselbe Liste in der
zweiten Sitzung auch das PROTOKOLL füllt: public/js/01-fortschritt.js
schreibt je Eintrag eine Zeile und liest dafür `r.set_number`. Die gab es
nicht, und so stand dort 322-mal „undefined – aktualisiert".

Wer echte Angaben hat, gibt sie als `zeilen` mit; sie müssen `success`
(und bei einer Anmerkung `isWarning`) tragen, damit die Zählung dieselbe
bleibt. Ohne `zeilen` bleibt es beim Zähler — dann schreibt das Protokoll
keine Zeile mehr, statt eine falsche (die Schranke steht dort).
```

<a id="istabgebrochen"></a>
## `istAbgebrochen`

```text
Hat jemand abgebrochen?

Der Balken trägt in beiden Oberflächen ein Kreuz, und der CSV-Import sieht
deshalb alle zehn Sets nach, ob sein Auftrag noch `running` ist. Ein
Import, der das nicht täte, hätte einen Abbrechen-Knopf, der lügt.

Auch `null` heisst abgebrochen: Ist die Zeile weg (ein zweiter Import hat
sie ersetzt), gehört die Anzeige nicht mehr uns.
```
