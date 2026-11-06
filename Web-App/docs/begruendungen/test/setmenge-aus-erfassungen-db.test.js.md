# Begründungen zu `test/setmenge-aus-erfassungen-db.test.js`

Die ausführlichen Kommentare aus `test/setmenge-aus-erfassungen-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Seit db/basis.sql gibt es den Stand VOR dieser Migration nicht mehr: Die
Fälle zu Riegel, Nachtrag und Zwischenstand sind entfallen. Geprüft werden
der Endstand und die Lesewege.

Die Stückzahl eines Sets steht nur noch in den Erfassungen.

── Marcos Frage ────────────────────────────────────────────────────────────

  „Wieso hat Sets ebenfalls noch quantity?"

Weil die Spalte eine zweite Kopie war. Die Ableitung aus den Erfassungen
stand bereits im Baum (routes/api_v1/acquisitions.ts, parentQuantitySql) —
daneben aber sieben Stellen, die die Spalte fortschrieben
(`quantity = quantity + $1`) oder setzten (`quantity = $1`).

Und sie sind auseinandergelaufen. GEMESSEN am laufenden Server (der Befund
steht in src/sets/setService.ts): Zehn gleichzeitige Erfassungen desselben Sets
ergaben `sets.quantity = 10`, aber drei Erfassungszeilen mit Summe 7 — drei
Exemplare, die es laut der einen Tabelle gab und laut der anderen nicht.

── Marcos Entscheidung ─────────────────────────────────────────────────────

  „Bitte doch Variante 1"

Die Spalte fällt. Migration 0036 löscht sie; die Rechnung steht einmal, in
db/bestandsmenge.ts, und wird von den Lesestellen eingesetzt.

── Was dieser Test prüft ───────────────────────────────────────────────────

  1. Nach der GANZEN Migrationskette gibt es `sets.quantity` nicht mehr —
     und vorher gibt es sie, weil die Nachträge in 0032 und 0036 sie LESEN.
  2. Der Riegel greift, wenn eine Set-Zeile ihre Stückzahl verlieren würde.
     Mit GEGENPROBE: ohne Riegel läuft dieselbe Lage durch, und die
     Stückzahl ist weg.
  3. Der Riegel greift auch beim DRIFT — wenn Spalte und Erfassungssumme
     auseinanderliegen, entscheidet ein Mensch, nicht die Migration.
  4. Niemand SCHREIBT die Spalte mehr. (Dass niemand sie mehr liest, prüft
     nicht der Quelltext, sondern die Datenbank: Nach Punkt 1 ist jede
     verbliebene Lesestelle ein harter Fehler — siehe Punkt 5.)
  5. Die Lesewege liefern die Stückzahl weiter, aus den Erfassungen. Mit
```

<a id="dateien"></a>
## `const dateien = [];`

```text
Nur der QUELLTEXT, und nur die SCHREIBseite. Die Leseseite prüft nicht
dieser Test, sondern die Datenbank: Nach Migration 0036 gibt es die Spalte
nicht, jede verbliebene Lesestelle ist ein harter Fehler — und genau
deshalb laufen die Lesewege unten gegen eine migrierte Datenbank.

Warum die Leseseite hier NICHT per Muster geprüft wird: `s.quantity` steht
in src/sets/abfragen.ts weiter im Sortierschlüssel und ist dort richtig
— `s` ist eine Unterabfrage, deren Mengenspalte `quantity` heisst. Ein
Muster müsste das auseinanderhalten und könnte es nicht; es hätte eine
richtige Stelle gemeldet und damit sich selbst entwertet.
```
