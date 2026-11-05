# Begründungen zu `test/csv-export-acquisitions-db.test.js`

Die ausführlichen Kommentare aus `test/csv-export-acquisitions-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der CSV-Export gibt je Erfassung eine Zeile — und braucht dafür EINE Abfrage.

── Warum es diesen Test gibt ───────────────────────────────────────────────
buildSetsCsv() und buildManualMinifigsCsv() holten die Erfassungen in einer
Schleife: eine Abfrage JE SET beziehungsweise je Minifigur. Bei 700 Sets sind
das 701 Hin- und Rückwege zur Datenbank statt einem. Der Export ist die
Stelle, an der ein Nutzer am ehesten den ganzen Bestand anfasst — also genau
die, an der das am meisten kostet.

Dieser Test wurde VOR dem Umbau gegen die alte Fassung geschrieben und lief
dort grün. Er hält damit fest, was der Umbau NICHT ändern durfte:

  • ein Set ohne Erfassungen liefert trotzdem eine Zeile — mit seiner Menge
  • ein Set mit mehreren Erfassungen liefert eine Zeile je Erfassung,
    aufsteigend nach Erfassungszeitpunkt
  • ein leerer Kaufpreis bleibt leer
  • ein fehlender Zustand wird zu 'N'

── Was Migration 0032 an diesem Test geändert hat ──────────────────────────
Der dritte Punkt lautete vorher: „ein leerer Kaufpreis wird NICHT vom
Set-Preis gefüllt — die naheliegende COALESCE-Formulierung im JOIN täte
genau das". Das war die heikelste Stelle des JOINs, weil `sets` einen
eigenen Kaufpreis trug. Seit Migration 0032 trägt sie keinen mehr: Der Fehler
ist nicht mehr behoben, sondern unmöglich. Die Prüfung bleibt stehen, weil
sie weiterhin eine Aussage über die Ausgabe macht — leer heisst leer.

Der erste Punkt hat damit ebenfalls eine schwächere Bedeutung: Ein Set ohne
Erfassung hat nichts mehr, worauf es zurückfallen könnte. Die Zeile entsteht
trotzdem (LEFT JOIN) und trägt die Menge der Set-Zeile — und genau das ist
der Fall, den Migration 0032 nach dem Nachtragen nicht mehr erwartet, hier
aber von Hand hergestellt wird.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="for-stelle"></a>
## `for (const sn of ['0001-1', '0002-1', '0003-1', '0004-1']) {`

```text
── Vier Faelle, jeder mit einer eigenen Aussage ────────────────────────
0001-1  keine Erfassung        → eine Zeile, Menge 0
0002-1  zwei Erfassungen       → zwei Zeilen, aelteste zuerst
0003-1  Erfassung ohne Preis   → leeres Preisfeld
0004-1  keine Erfassung        → Zustand 'N'

Menge 0 heisst hier „Bestandszeile ohne Erfassung" — genau der Fall,
den die beiden ersten Zeilen beschreiben. Vorher stand die Menge in
sets.quantity und blieb auch ohne Erfassung stehen; seit Migration 0036
gibt es sie dort nicht, und „ohne Erfassung" heisst null Exemplare.
Die Mengen der anderen beiden kommen aus den Erfassungen darunter.
```

<a id="echtesquery"></a>
## `const echtesQuery = db.pool.query.bind(db.pool);`

```text
── Gezaehlt wird an pool.query, NICHT an db.all ──────────────────────────

Der erste Anlauf hat `db.all` ersetzt und dabei 0 Abfragen gezaehlt — die
Zusicherung war damit trivial erfuellt und der Test wertlos. Grund: Die
Module werden als ESM nach CommonJS uebersetzt, und `import * as db`
liefert ein Namensraum-Objekt, dessen Exporte als Getter gebunden sind. Ein
`db.all = …` von aussen laeuft dort ins Leere.

`pool` ist dagegen eine gewoehnliche Instanz. Alle drei Zugriffswege des
Moduls (all, get, run) gehen durch `pool.query` — dort gezaehlt, ist die
Messung ausserdem vollstaendiger als an einer einzelnen Funktion.
```

<a id="for-stelle-2"></a>
## `for (const [nr, name, menge] of [`

```text
fig-a  ohne Erfassung        → Figuren-Zeile
fig-b  Erfassung ohne Preis  → leeres Feld

Der Preis stand hier einmal an der Figuren-Zeile (9.00 bzw. 42.00), und
die Zusage lautete: „eine Erfassung ohne Preis erbt NICHT den Preis der
Figuren-Zeile". Seit Migration 0035 gibt es dort keinen Preis mehr —
die FEHLERQUELLE ist weg, nicht nur der Fehler. Die Zusicherung bleibt
trotzdem: Sie haelt fest, dass eine leere Erfassung leer exportiert und
nicht etwa als 0.
```

<a id="if-stelle"></a>
## `if (!await dbOderSkip(t, _req, { migrieren: false })) return;`

```text
── Warum dieser Fall spaeter kam (Nachtrag 134) ──────────────────────────

Diese Datei pruefte Sets und Minifiguren. buildPartsCsv blieb als einziger
der drei Zwillinge bei der Schleife — eine Abfrage JE TEIL — und faellt
damit unter genau die Ueberschrift, die oben steht. Gefunden nicht durch
Lesen, sondern durch eine Suche nach `await db.` innerhalb einer Schleife.

Teile haben eine zweite Schluesselspalte, die Sets und Figuren nicht haben:
die FARBE. Derselbe Teiletyp in Rot und in Blau sind zwei Zeilen, und der
JOIN muss beide Spalten vergleichen — sonst erbt die rote Zeile die
Erfassungen der blauen. Dafuer steht der Fall `3001` unten.
```

<a id="for-stelle-3"></a>
## `for (const [nr, farbe, farbname] of [`

```text
3001 / Farbe 4   zwei Erfassungen      → zwei Zeilen, aelteste zuerst
3001 / Farbe 1   KEINE Erfassung       → Teile-Zeile, nicht die von Farbe 4
3002 / Farbe 0   Erfassung ohne Preis  → leeres Feld

Die Preise standen hier einmal an der Teile-Zeile — siehe die
Begruendung im Figuren-Teil darueber (Migration 0035).
Keine Stueckzahl in dieser Aufstellung: Seit Migration 0038 ist die
Menge einer manuellen Position die Summe ihrer Erfassungen, und die
legt der Test unten gezielt an. Eine Zahl hier waere eine, die nichts
bewirkt.
```
