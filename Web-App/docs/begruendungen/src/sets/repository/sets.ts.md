# Begründungen zu `src/sets/repository/sets.ts`

Die ausführlichen Kommentare aus `src/sets/repository/sets.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="sets-csv-sql"></a>
## `SETS_CSV_SQL`

```text
Shared logic to build the Sets CSV export content. Used by both the
standalone CSV download and the combined ZIP export in settings.js.
Eine Zeile pro Erfassung, damit Kaufpreis, Zustand und Datum je Kauf erhalten
bleiben und beim Re-Import 1:1 wiederhergestellt werden. Sets ohne Erfassungen
fallen auf die Set-Zeile zurück — die trägt seit Migration 0032 nur noch die
Menge, Kaufpreis und Zustand bleiben dann leer bzw. 'N'.

── Warum ein LEFT JOIN und keine Schleife ──────────────────────────────────
Vorher lief hier eine Abfrage JE SET. Bei 700 Sets waren das 701 Hin- und
Rückwege zur Datenbank; jeder einzelne war schnell, die Summe nicht. Der
Export ist die Stelle, an der ein Nutzer am ehesten den GANZEN Bestand
anfasst — also genau die, an der sich das am stärksten auswirkt.

Der LEFT JOIN erzeugt dieselben Zeilen: zu jedem Set entweder eine je
Erfassung oder, wenn es keine gibt, genau eine mit NULL-Erfassungsspalten.

── Die Falle dabei ─────────────────────────────────────────────────────────
Die Unterscheidung „Erfassung vorhanden, aber ohne Preis" gegen „keine
Erfassung" bleibt wichtig, auch wenn der frühere Rückfall auf
s.purchase_price/s.condition mit Migration 0032 weggefallen ist: Zu einer
vorhandenen Erfassung ohne Preis gehört ein leeres Feld. Das ergibt sich
jetzt von selbst, weil a.purchase_price dann NULL ist.
csv-export-acquisitions-db.test.js prüft genau diesen Fall.
```

<a id="set-sorts-2"></a>
## Abschnitt

```text
Anzahl der besessenen Exemplare.

`s.quantity` ist hier KEINE Tabellenspalte mehr — die ist mit Migration
0036 weg. `s` ist in beiden Zweigen von `setsFrom` eine Unterabfrage, und
deren Mengenspalte heisst `quantity` (aus db/bestandsmenge.ts). Diese
Sortierung bleibt dadurch wörtlich stehen, und das ist Absicht: Der Name
nach aussen soll sich nicht ändern, nur seine Herkunft.

Zweiter Sortierschlüssel: Ohne ihn stehen alle Sets mit derselben Anzahl —
und das sind fast alle, nämlich die mit genau einem Exemplar — in einer
von Postgres nicht festgelegten Reihenfolge. Beim Blättern könnte
dasselbe Set dadurch zweimal oder gar nicht erscheinen.
```

<a id="getsets-limitsql"></a>
## `limitSql`

```text
Ohne page_size bleibt die Set-Liste UNBEGRENZT.

Hier stand kurzzeitig eine Obergrenze. Das war falsch, und der Grund hat
sich seither GEÄNDERT — die frühere Begründung stand noch hier:

  „Die Android-App blättert die Galerie NICHT (BrickApiService.getSets
   kennt keinen page-Parameter)."

Das stimmt nicht mehr. SetsRepository.getSets nimmt page und pageSize,
und loadMoreSets fordert `galleryPage + 1` an: BEIDE Clients blättern.
Der Satz stand an drei Stellen, berichtigt wurde nur eine (die Notiz in
routes/api_v1/sets.ts) — dieselbe Falle wie bei jeder anderen Regel, die
mehrfach niedergeschrieben ist.

Unbegrenzt bleibt die Liste trotzdem, aus dem Grund, der DORT steht: Der
Weg ist absichtlich offen für Aufrufer, die alles wollen — Skripte und
ältere App-Stände, denen eine stille Grenze ab dem Grenzwert Sets
unterschlüge. Wer blättert, schickt page_size mit und bekommt die Grenze.
```
