# Begründungen zu `src/infra/csvExport.ts`

Die ausführlichen Kommentare aus `src/infra/csvExport.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="entschaerfe"></a>
## `entschaerfe`

```text
Ein Feld gegen Formelausführung entschärfen.

Öffnet jemand den Export in Excel, LibreOffice oder Google Sheets, wird ein
Feld wie `=HYPERLINK("http://…";"Klick")` beim Öffnen AUSGEFÜHRT — der Inhalt
kommt aber aus Notizen, Set- und Teilenamen, also aus Daten, die auch ein
Unterkonto im Haushalt schreiben kann.

Der Schutz ist ein vorangestelltes Hochkomma; das ist die übliche
Schreibweise und in Tabellenprogrammen unsichtbar.

── Warum das den eigenen Rücklauf nicht bricht ─────────────────────────────
Die Exporte sind ausdrücklich so gebaut, dass der eigene Importer sie wieder
einliest. Deshalb entfernt entschaerfungRueckgaengig() das Hochkomma beim
Import wieder — und zwar NUR, wenn danach ein Formelzeichen steht. Ein Feld,
das echt mit einem Hochkomma anfängt, bleibt damit unangetastet.

Zahlen bleiben ebenfalls unberührt: Ein führendes Minus macht `-5.00` zwar
formal zum Formelanfang, ein reiner Zahlwert wird aber ausgenommen, sonst
käme jeder negative Kaufpreis mit Hochkomma zurück.
```

<a id="abschnitt"></a>
## Abschnitt

```text
sendCsvText() ist mit seinen drei Aufrufern ENTFERNT.

Es schickte einen fertig gebauten CSV-String als Datei — gebraucht von
/api/sets|parts|minifigs/export/csv, und die drei Routen hatten keinen
Aufrufer mehr. Was die Webapp anbietet, ist der ZIP-Export unter
/api/settings/export/data; der legt dieselben Strings ins Archiv und braucht
dafuer keine Antwort-Kopfzeilen.

Die Builder (buildSetsCsv und die beiden anderen) bleiben — sie SIND die
gemeinsame Spaltenlogik, um die es in diesem Kommentar ging.
```

<a id="parsecsvdate"></a>
## `parseCsvDate`

```text
Datumsangabe aus einer CSV-Datei in ISO-Form (YYYY-MM-DD) bringen.

Der Grund: `new Date('05.03.2026')` liefert den **3. Mai**, nicht den
5. März — JavaScript liest punktgetrennte Daten amerikanisch als MM.DD.YYYY.
Dasselbe gilt für Postgres bei `'05.03.2026'::date` unter der Vorgabe
DateStyle MDY. Eine Datei mit Schweizer Datumsangaben landete dadurch mit
vertauschten Tagen und Monaten in der Datenbank — und bei Tagen über 12
scheiterte der Import ganz.

Erkannt werden:
  DD.MM.YYYY   05.03.2026  → 2026-03-05   (Schweiz/Deutschland)
  DD/MM/YYYY   05/03/2026  → 2026-03-05
  YYYY-MM-DD   2026-03-05  → unverändert  (ISO, eigener Export)
  DD.MM.YY     05.03.26    → 2026-03-05

Bewusst KEINE Umdeutung mehrdeutiger Fälle: `2026-03-05` bleibt ISO, weil
das eigene Exportformat so aussieht. Punkt- und Schrägstrich-Formate gelten
immer als Tag zuerst — das ist die hiesige Schreibweise, und die Datei
stammt in aller Regel von hier.

@param {string|null|undefined} raw
@returns {string|null} ISO-Datum oder null, wenn nichts Brauchbares drinsteht
```

<a id="gefaehrliche-spalten"></a>
## `GEFAEHRLICHE_SPALTEN`

```text
CSV-Datei einlesen — fehlerhafte Zeilen überspringen statt alles abzubrechen.

── Warum ───────────────────────────────────────────────────────────────────
Bisher lief das Einlesen mit den Standardeinstellungen von csv-parse. Eine
einzige krumme Zeile — eine Spalte zu wenig, ein verirrtes Semikolon aus
einer fremden Tabelle — brach den GESAMTEN Import ab:

  CSV Parse Fehler: Invalid Record Length: columns length is 3, got 1 on line 3

Für eine Datei mit 500 Zeilen aus einer Fremdquelle ist das die schlechteste
denkbare Antwort: nichts importiert, und die Meldung ist die rohe Ausgabe des
Parsers. Wer sie liest, weiss nicht, was zu tun ist.

Jetzt: `relax_column_count` lässt zu kurze und zu lange Zeilen durch, die
Zeilennummern der übersprungenen Zeilen kommen mit zurück, und der Aufrufer
kann sie dem Nutzer nennen. Vollständig unlesbare Dateien (kaputte
Anführungszeichen) werfen weiterhin — dann stimmt etwas Grundsätzliches
nicht.

@param csvText Dateiinhalt (BOM darf drin sein)
@returns { records, delimiter, uebersprungen } — uebersprungen sind
         Zeilennummern der Datei, 1-basiert wie in jedem Editor
```

<a id="csveinlesen"></a>
## Abschnitt

```text
── Warum die Kopfzeile gefiltert wird (Nachtrag 170) ──────────────────

`columns: true` macht aus jeder Kopfspalte einen Objektschluessel. Heisst
eine Spalte `__proto__`, `constructor` oder `prototype`, schreibt das
Ergebnis in die Prototypenkette statt in den Datensatz — genau der Pfad,
den `npm audit` fuer csv-parse meldet („Prototype replacement still
reachable via columns path"). Die CSV kommt vom Benutzer; der Import ist
damit erreichbar.

Die Bibliothek behebt es erst in Hauptversion 7. Das hier ist von der
Version unabhaengig und kostet nichts: Eine Spalte mit einem dieser drei
Namen ist in einer Bestandsliste ohnehin keine Angabe, sondern ein
Angriff — sie wird verworfen (`false` laesst csv-parse die Spalte weg).
```

<a id="csvgemeinsamefelder"></a>
## `csvGemeinsameFelder`

```text
Die Felder, die JEDE Import-Zeile hat — mit allen Spaltennamen, die gelten.

── Warum das eine eigene Funktion ist ──────────────────────────────────────

Der CSV-Import fuer Teile und der fuer Minifiguren lasen dieselben fuenf
Angaben aus derselben Zeile, jeder mit seiner eigenen Abschrift derselben
Spaltennamen. Was das kostet, steht seit Nachtrag 128 im Quelltext von
routes/minifigs.ts:

    „parseCsvDate statt roher Zeichenkette: Postgres liest bei DateStyle MDY
     ‚01.02.2026' als 2. Januar … Der Fehler war bekannt und fuer Sets und
     Teile behoben; dieser dritte Aufrufer hat die Behebung nie bekommen."

Eine Regel in drei Abschriften, nachgezogen in zweien. Genau die Bauart, die
dieser Baum an einem Dutzend Stellen bekaempft — hier steht sie jetzt einmal.

── Was die einzelnen Entscheidungen bedeuten ───────────────────────────────

 menge     Ziffern aus dem Feld; nichts Brauchbares heisst EINS, nicht null —
           eine importierte Zeile ohne Menge ist ein Stueck, kein Nichts.
 preis     Leer heisst NULL (nicht 0): „kein Preis eingegeben". Was daraus
           wird, entscheidet utils/preisRegel.ts.
 erfasstAm Ueber parseCsvDate — siehe oben.
 zustand   Grossgeschrieben, damit „n" wie „N" gilt.
```
