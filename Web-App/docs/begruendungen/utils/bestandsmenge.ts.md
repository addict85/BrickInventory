# Begründungen zu `utils/bestandsmenge.ts`

Die ausführlichen Kommentare aus `utils/bestandsmenge.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Die Stückzahl eines Sets — abgeleitet, nicht gespeichert.

── Marcos Frage ────────────────────────────────────────────────────────────

  „Wieso hat Sets ebenfalls noch quantity?"

Weil die Spalte eine zweite Kopie war. Die Ableitung aus den Erfassungen
stand bereits im Baum (routes/api_v1/acquisitions.ts, parentQuantitySql):

    UPDATE sets SET quantity = COALESCE(
      (SELECT SUM(quantity) FROM set_acquisitions WHERE …), 0)

Jedes Bearbeiten einer Erfassung rechnete die Menge also schon aus den
Erfassungen neu. Daneben standen aber SIEBEN weitere Schreibstellen, die sie
fortschrieben (`quantity = quantity + $1`) oder setzten (`quantity = $1`).

── Und sie sind auseinandergelaufen ────────────────────────────────────────

GEMESSEN am laufenden Server (der Befund steht in utils/setService.ts): Zehn
gleichzeitige Erfassungen desselben Sets ergaben `sets.quantity = 10`, aber
drei Erfassungszeilen mit Summe 7 — drei Exemplare, die es laut der einen
Tabelle gab und laut der anderen nicht.

Migration 0036 loescht die Spalte. `set_acquisitions` ist die Wahrheit, und
zwar die einzige.

── Warum die Rechnung HIER steht und nicht neunzehnmal im Baum ─────────────

Neunzehn SQL-Stellen in elf Dateien lesen die Menge (gemessen). Dieselbe
Summe neunzehnmal hingeschrieben heisst: neunzehn Stellen, an denen sie beim
naechsten Mal leicht anders aussieht. Genau so ist in diesem Baum schon
`is_spare` an sechs Stellen in vier Lesarten zerfallen (utils/validate.ts),
und genau deshalb gibt es dort ersatzteilSql() — dieselbe Bauart wie hier.

── Zwei Formen, EINE Rechnung ──────────────────────────────────────────────

`mengeJoin()` haengt eine gruppierte Quelle an. `mengeSkalar()` setzt eine
Unterabfrage in die Spaltenliste. Welche von beiden passt, haengt an der
Abfrage, nicht am Geschmack:

  * Eine Abfrage ueber EINE Zeile (Set-Detail, Verschieben) nimmt
    mengeSkalar(): ein Indexzugriff ueber idx_acq_user_set.
  * Eine Abfrage ueber VIELE Zeilen nimmt mengeJoin(). Der Aufbau der
    Teile-Zusammenfassung laeuft ueber 171'000 Teilezeilen; eine
    Unterabfrage je Zeile waere dort 171'000 Indexzugriffe statt EINER
    Gruppierung ueber set_acquisitions (wenige Tausend Zeilen) plus einem
    Hash-Join. Die Zahlen zum Aufbau stehen in utils/partsSummary.ts.

Die SUMME selbst steht nur einmal da (SUMME unten) — die beiden Formen
unterscheiden sich im Weg, nicht im Ergebnis.
```

<a id="mengejoin"></a>
## `mengeJoin`

```text
Stückzahl als gruppierte JOIN-Quelle, fuer Abfragen ueber viele Zeilen.

LEFT JOIN und nicht JOIN: Eine Bestandszeile ohne Erfassung soll nicht aus
dem Ergebnis fallen. Es sollte sie nicht geben (Migration 0032 traegt fuer
jede eine Erfassung nach), aber ein fehlender Eintrag darf eine Liste nicht
leeren — er darf nur eine 0 bedeuten.

@param bezug Alias der Zeile, zu der die Menge gehoert.
@param alias Name der JOIN-Quelle; der Aufrufer liest daraus `<alias>.menge`.
```

<a id="mengeaus"></a>
## `mengeAus`

```text
Die Mengenspalte zur JOIN-Quelle aus [mengeJoin].

Eigene Funktion und nicht nur ein Kommentar: Ohne COALESCE liefert der LEFT
JOIN NULL, und NULL in `p.quantity * s.menge` macht die ganze Zeile zu NULL.
`COALESCE(s.quantity, 1)` stand vorher an sieben Stellen — die 1 war dort
die „Menge eines Sets, das wir nicht kennen". Diese Lesart bleibt, der
Aufrufer waehlt sie ueber `fehlt`.

@param fehlt Was gilt, wenn es keine Erfassung gibt. 0 fuer eine Stueckzahl,
             1 fuer einen Faktor in einer Multiplikation.
```

<a id="mengesummesql"></a>
## `mengeSummeSql`

```text
Die Stückzahl eines Sets über ein ganzes BLICKFELD, als fertige Abfrage.

Dritte Form, und zwar aus Not: utils/setService.ts braucht die Summe nicht
je Bestandszeile, sondern über MEHRERE Konten hinweg („wie viele Exemplare
hält der Haushalt?"). Dafür passt weder mengeSkalar (eine Zeile) noch
mengeJoin (eine Zeile je Konto). Ohne diese Funktion stand derselbe Satz
dreimal in derselben Datei — genau die Lage, aus der `is_spare` hier schon
in vier Lesarten zerfallen ist.

Der JOIN auf `sets` ist nicht Zierrat: Er hält die Einschränkung „nur Konten,
die das Set wirklich halten". Eine Erfassung ohne Bestandszeile (etwa nach
einem Verschieben) soll nicht mitzählen.

Parameter der Abfrage: $1 Konto bzw. Kontenliste, $2 Setnummer.

@param konten 'eines' für eine Konto-ID, 'blickfeld' für eine Liste.
```

<a id="mengedessets"></a>
## `mengeDesSets`

```text
Die Stückzahl EINER Set-Zeile — als Zahl, nicht als SQL-Schnipsel.

── Warum es diese Funktion braucht ─────────────────────────────────────────

routes/api_v1/acquisitions.ts entscheidet nach jedem Bearbeiten einer
Erfassung, ob die Bestandszeile noch einen Bestand hat
(raeumeLeerenBestand). Dafür braucht es die Zahl in JavaScript, nicht in
einer Abfrage — und es braucht die UNTERSCHEIDUNG:

  null → es gibt die Bestandszeile nicht (mehr)
  0    → die Zeile ist da, hat aber keine Erfassung mehr → aufräumen

Genau diese zwei Fälle gingen beim Umbau verloren: Der Aufruf lief über
mengeNeuRechnen(), das seit Migration 0036 nur noch Teile und Figuren
kennt. Für ein Set fiel er in den Figuren-Zweig, traf dort keine Zeile und
gab null zurück — woraufhin raeumeLeerenBestand die Set-Zeile LÖSCHTE,
obwohl noch eine Erfassung dastand. GEMESSEN an
test/empty-holding-cleanup-db.test.js: „das Set wurde gelöscht, obwohl noch
eine Erfassung übrig ist".

Kein UPDATE mehr, nur ein SELECT — es gibt nichts zu schreiben.
```

<a id="bestandsart"></a>
## `Bestandsart`

```text
═══════════════════════════════════════════════════════════════════════════
Teile und Minifiguren — zwei Bedeutungen, EINE Fallunterscheidung
═══════════════════════════════════════════════════════════════════════════

── Marcos Befund ─────────────────────────────────────────────────────────

  „Bei den Minifigs und parts gibt es noch immer ein quantity"

Richtig, und es war ein ZWISCHENSTAND mit Ansage: Die Spalte trug ZWEI
Bedeutungen, und deshalb ging sie nicht mit sets.quantity zusammen weg.

  source='manual'  wie viele ich besitze    → Summe der Erfassungen
  source='set'     wie viele im SET stecken → set_parts_catalog.quantity
                                               bzw. set_minifigs_catalog

Fuer Set-Teile gibt es keinen eigenen Kauf (gekauft wurde das Set), also
auch keine Erfassung. Ihre Stueckzahl ist eine KATALOGZAHL, und der eigene
Bestand ergibt sich beim Lesen aus Katalogmenge x Set-Menge — genau Marcos
Formel „alle set_acquisitions-Eintraege x ihre Quantity pro Set pro User".

Beide Zweige waren Abschriften, GEMESSEN: utils/partsImport.ts schrieb
denselben Wert in DERSELBEN Schleife nach parts.quantity und nach
set_parts_catalog.quantity, utils/minifigsImport.ts wortgleich fuer die
Figuren. Und mengeNeuRechnen() hier war fuer die manuellen Positionen der
einzige Schreiber — es rechnete die Summe der Erfassungen.

Migration 0038 loescht die beiden Spalten. Was bleibt, ist diese
Fallunterscheidung, einmal hingeschrieben.
```

<a id="teilmengejoin"></a>
## `teilmengeJoin`

```text
Die beiden JOIN-Quellen fuer die Stückzahl einer Bestandszeile.

ZWEI Quellen und kein CASE mit Unterabfragen: Die Teileliste laeuft ueber
171'000 Zeilen (die Zahl steht in utils/partsSummary.ts). Eine korrelierte
Unterabfrage je Zeile waere dort 171'000 Indexzugriffe statt EINER
Gruppierung ueber die Erfassungen plus einem Hash-Join auf den Katalog.
Dieselbe Abwaegung wie bei mengeJoin() weiter oben, aus demselben Grund.

@param bezug Alias der Bestandszeile, z. B. `p` oder `m`
@param alias Grundname; angelegt werden `<alias>_e` (Erfassungen) und
             `<alias>_k` (Katalog)
```

<a id="teilmengeaus"></a>
## `teilmengeAus`

```text
Die Stückzahl der Bestandszeile — die Fallunterscheidung selbst.

`COALESCE(source,'set')`: Die Spalte hat keinen NOT-NULL-Zwang, und alte
Zeilen tragen dort NULL. Dieselbe Lesart steht an jeder Filterstelle im
Baum (`COALESCE(p.source,'set') <> 'manual'`) — hier genauso, damit eine
Zeile nicht je nach Abfrage in den anderen Zweig faellt.

Der Rückfall 1 im Set-Zweig heisst „Katalogzeile fehlt, trotzdem zaehlen".
Es sollte sie nicht geben (Migration 0038 traegt fuer jede Set-Zeile eine
nach und prueft das danach), aber eine fehlende Zeile darf eine Liste nicht
leeren.

Der Rückfall 0 im manuellen Zweig heisst „keine Erfassung, also kein
Bestand" — dort ist 0 die richtige Antwort und 1 waere ein erfundenes
Exemplar.
```

<a id="mengederposition"></a>
## `mengeDerPosition`

```text
Die Stückzahl EINER manuellen Position — als Zahl, nicht als Schnipsel.

Dieselbe Aufgabe wie [mengeDesSets] fuer die Sets, und dieselbe
Unterscheidung:

  null → es gibt die Bestandszeile nicht (mehr)
  0    → die Zeile ist da, hat aber keine Erfassung mehr → aufräumen

`source='manual'` in der Bedingung: Die eine Stelle, die das braucht
(raeumeLeerenBestand in routes/api_v1/acquisitions.ts), entscheidet nur
ueber manuelle Positionen — ihr cleanupWhenEmpty ruft loescheManuellesTeil
bzw. loescheManuelleFigur. Ein Set-Teil hat keine eigene Erfassung und
duerfte hier nie als „leer" herauskommen.

Hier stand mengeNeuRechnen(), das die Spalte NEU BERECHNETE und dabei
schrieb. Es gibt nichts mehr zu schreiben: ein SELECT, kein UPDATE.
```
