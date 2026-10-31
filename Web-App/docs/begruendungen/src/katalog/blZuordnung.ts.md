# Begründungen zu `src/katalog/blZuordnung.ts`

Die ausführlichen Kommentare aus `src/katalog/blZuordnung.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Was bei BrickLink wie heisst — die Zuordnung, an einer Stelle.

── Marcos Vorgabe ─────────────────────────────────────────────────────────

  „ich würde mir für die bl_*_number Spalten eine Mapping-Tabelle vorstellen
   mit der Spalte RB_id und BL_id dort werden alle alle Minifiguren, Parts
   und Sets mit den Mappings abgelegt."

Seit Migration 0037 ist das `bl_zuordnung (art, rb_id, bl_id)`. Vorher stand
dieselbe Aussage an vier Orten: in `rb_bl_mapping` (Teile, katalogweit) und
als Abschrift in `parts.bl_part_number`, `set_parts_catalog.bl_part_number`
und `minifigs.bl_fig_number` — die beiden ersten JE KONTO.

Dass die Abschriften genau das waren, stand im Baum: src/katalog/partsImport.ts
trug eine Funktion syncBlPartNumbers(), deren ganze Aufgabe darin bestand,
rb_bl_mapping in die beiden anderen zu kopieren. Sie ist mit 0037 weg.

Die Farben sind NICHT mitgezogen: Sie sitzen als `rb_colors.bl_color_id` an
der Farbzeile, und das ist katalogweit und einmalig — dieselbe Stelle, nur
in einer anderen Tabelle. Hier umzuziehen gaebe nichts dazu.

── Warum das eine eigene Datei ist ────────────────────────────────────────
Der Schreibvorgang stand fünfmal im Baum: dreimal wortgleich für Teile
(jobs/backfillBlPartNumbers, jobs/partsCatalogEnrich zweimal,
src/katalog/partsImport), zweimal für Farben (jobs/rebrickableCsvSync,
src/teile/abfragen). Ein Fehlverhalten ist dabei NICHT gemessen worden —
die Fassungen waren gleich. Der Grund ist ein anderer: Wer die Regel ändert
(eine Spalte dazu, ein anderes ON CONFLICT), soll das an einer Stelle tun
und nicht fünf suchen müssen.
```

<a id="blart"></a>
## `BlArt`

```text
Welche Arten es gibt. Union und kein Text: Die Art wird in den
SQL-Schnipseln unten EINGESETZT (ein Wert laesst sich dort nicht binden),
und der Typ ist das, was verhindert, dass dort je etwas anderes landet als
diese drei Woerter.

'set' ist dabei und bleibt vorerst leer: GEMESSEN hat kein Set irgendwo eine
eigene BrickLink-Nummer — BrickLink benutzt dieselben Setnummern wie
Rebrickable. Die Art kostet nichts (eine Tabelle mit Art-Unterscheidung
waechst um Zeilen, nicht um Spalten) und ist da, wenn sich das fuer ein
einzelnes Set einmal unterscheidet.
```

<a id="merkeblnummerunveraendert"></a>
## `merkeBlNummerUnveraendert`

```text
„Nachgesehen, es gibt keine abweichende Nummer" — das Teil heisst bei
BrickLink genauso.

Bewusst `DO NOTHING` statt `DO UPDATE`: Diese Notiz darf eine echte, schon
gefundene Zuordnung nicht überschreiben. Sie verhindert nur, dass dasselbe
Teil immer wieder abgefragt wird.

Die ZEILE entsteht dabei, ihr Wert bleibt leer. Genau darin liegt der
Unterschied, auf den es ankommt: „Zeile da, bl_id leer" heisst nachgesehen,
„keine Zeile" heisst noch nicht nachgesehen. Vorher trug diese Notiz die
Rebrickable-Nummer als BrickLink-Nummer ein — dasselbe gesagt, nur
undeutlicher.
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
═══════════════════════════════════════════════════════════════════════════
Zwei Fragen, die nicht dasselbe sind
═══════════════════════════════════════════════════════════════════════════

  „Welche ABWEICHENDE Nummer ist hinterlegt?"   → blNummerVon, null wenn keine
  „Mit welcher Nummer frage ich BrickLink?"      → blAbrufNummer, die wirksame

Der Unterschied ist nicht Geschmack, er ist GEMESSEN: Als es nur die erste
Form gab, fiel das Vorladen in src/finanzen/rechnung/preise.ts aus. Dort merkt sich
ein Nachschlagwerk die Antworten, und es merkt bewusst keine Fehlschlaege
(ein Teil ohne Uebersetzung soll beim naechsten Mal wieder gefragt werden,
damit ein Nachtrag-Job nicht zehn Minuten uebersehen wird). Eine leere bl_id
ist aber KEIN Fehlschlag, sondern eine vollstaendige Antwort — „heisst dort
genauso". Mit null kam sie als Fehlschlag an, wurde nicht gemerkt, und jedes
Teil fragte wieder einzeln: 20 Einzelabfragen statt 0, gemeldet von
test/bewertung-abfragen-db.test.js.

Vor Migration 0037 gab es diese Falle nicht, weil rb_bl_mapping die Notiz
als `bl_part_num = part_num` hielt — eine Antwort, die zufaellig in beide
Bedeutungen passte. Jetzt sind sie getrennt, und zwar ausdruecklich.
```

<a id="blabrufnummern"></a>
## `blAbrufNummern`

```text
Dasselbe fuer viele Nummern, in EINER Abfrage.

Der Grund steht in src/finanzen/rechnung/preise.ts: Dort wurde gemessen, dass die
Einzelabfrage bei 50 Teilen 50 Mal lief.

@returns Abbildung rb_id → wirksame Nummer, fuer JEDE vorhandene Zeile —
         auch fuer die ohne abweichenden Wert. Genau das ist der
         Unterschied zu [blNummernVon], und genau darauf beruht, dass das
         Nachschlagwerk nichts zweimal fragt.
```

<a id="abschnitt-3"></a>
## Abschnitt

```text
Hier standen drei weitere Ausfuhren — blSchonNachgesehen(),
blNummernVon() und rbNummerVon(). Sie sind weg, und zwar nicht aus
Platzgruenden: test/dead-code.test.js hat sie gemeldet, weil sie
NIRGENDS aufgerufen wurden. Ich hatte sie „fuer den Fall" angelegt.

Was sie leisten sollten, leistet etwas anderes:

  „schon nachgesehen?"   steht als LEFT JOIN in den zwei Stellen, die
                         es brauchen (src/katalog/partsImport.ts,
                         jobs/backfillBlPartNumbers.ts) — dort geht es
                         um eine Liste, nicht um eine Nummer.
  viele Nummern          blAbrufNummern() weiter oben.
  die Richtung zurueck   braucht derzeit niemand. Der Index
                         idx_bl_zuordnung_bl bleibt trotzdem: Er traegt
                         die Eindeutigkeitspruefung des Riegels in
                         Migration 0037.
```

<a id="abschnitt-4"></a>
## Abschnitt

```text
═══════════════════════════════════════════════════════════════════════════
Die Zuordnung IN einer Abfrage
═══════════════════════════════════════════════════════════════════════════

Zwei Schnipsel, dieselbe Bauart wie mengeJoin()/mengeAus() in
src/sets/bestandsmenge.ts und ersatzteilSql() in src/infra/validate.ts — und aus
demselben Grund: `COALESCE(p.bl_part_number, p.part_number)` stand an
ZEHN Stellen in fuenf Dateien (gemessen), teils als Gruppierungsschluessel.
Zehnmal dieselbe Rechnung heisst zehn Stellen, an denen sie beim naechsten
Mal leicht anders aussieht; genau so ist `is_spare` hier schon in vier
Lesarten zerfallen.

Ein JOIN und keine Unterabfrage je Zeile: Die Teile-Zusammenfassung baut
ueber 171'000 Zeilen auf (die Zahl steht in src/teile/partsSummary.ts), und die
Gruppierung laeuft ueber genau diesen Wert.
```

<a id="blnummersql"></a>
## `blNummerSql`

```text
„Die Nummer, unter der dieses Teil bei BrickLink steht."

COALESCE auf die Rebrickable-Nummer, weil die Zuordnung nur die ABWEICHUNG
festhaelt: Kein Eintrag heisst „heisst dort genauso". Ohne das COALESCE
waere der Wert NULL, und als Gruppierungsschluessel faellt eine Zeile mit
NULL in ihre eigene Gruppe — jedes Teil ohne Zuordnung stuende dann
einzeln.
```

<a id="abschnitt-5"></a>
## Abschnitt

```text
── blFigNummerAus() ist WEG ──────────────────────────────────────────────

Sie las `minifigs.bl_fig_number` — je Konto, mit `source='manual'` in der
Bedingung, weil Figuren aus einem Set keine eigene Nummer trugen. Beides
ist mit Migration 0037 gegenstandslos: Die Nummer haengt an der FIGUR, und
die Zuordnung kennt kein Konto. An ihre Stelle tritt
blNummerVon('fig', figNumber).

Das ist auch sachlich richtiger und nicht nur kuerzer: Steckt dieselbe Figur
in einem Set UND im eigenen Bestand, gab die alte Abfrage ihre Nummer nur
fuer die manuelle Zeile heraus — fuer dieselbe Figur also manchmal und
manchmal nicht.
```
