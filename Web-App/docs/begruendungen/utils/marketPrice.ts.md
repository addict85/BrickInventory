# Begründungen zu `utils/marketPrice.ts`

Die ausführlichen Kommentare aus `utils/marketPrice.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="getcurrentmarketprice"></a>
## `getCurrentMarketPrice`

```text
Der aktuelle Marktpreis eines Sets.

── Warum nicht mehr in routes/sets.ts (Nachtrag 125) ───────────────────────
Sieben Aufrufer, keiner konnte sie importieren: Der Router schliesst mit
parts/minifigs/jobs mehrere Kreise, also holten alle sie per spätem
`require()` — und damit ungeprüft. Genau diese Sorte Aufruf hat in Nachtrag
131 zwei 500er verursacht.

Hier ist sie ein Blatt: db, priceJob, setValue, settings — kein Rückbezug.
Das späte `require('../utils/setValue')` im Rumpf konnte dabei ebenfalls
durch einen echten Import ersetzt werden.
```

<a id="abschnitt"></a>
## Abschnitt

```text
── Warum die Teile- und Figurenpreise jetzt AUCH hier stehen ───────────────

Diese Datei fuehrte den Marktpreis fuer SETS. Die Pendants fuer Teile und
Minifiguren wohnten in routes/parts.ts und routes/minifigs.ts — dieselbe
Frage, dreimal beantwortet, an drei Orten in zwei Schichten. Wer die Regel
aendert (etwa avg_price statt qty_avg_price, oder die Behandlung eines
Zustands-Rueckfalls), aendert sie an einem Ort und uebersieht die anderen:
genau die Bauart von Fehler, gegen die dieser Baum sonst ueberall angeht.

Sichtbar wurde es daran, dass jobs/purchasePriceBackfill.ts und
utils/financeCalc.ts aus einer ROUTE importieren mussten, um an einen Preis
zu kommen.
```

<a id="marktpreiseauscachefuerfiguren"></a>
## `marktpreiseAusCacheFuerFiguren`

```text
Marktpreise fuer eine ganze LISTE — nur aus dem Cache, ohne einen einzigen
Abruf bei BrickLink.

── Warum es das gibt ───────────────────────────────────────────────────────

Marcos Befund: „Bei den manuell erfassten Minifiguren wird kein Marktpreis
angezeigt."

Der Detailbildschirm der App liest ihn aus `avgPrice`
(ManualItemDetailScreen.kt), und diese Liste kommt aus
/api/v1/minifigs/manual — einem `SELECT * FROM minifigs`. Die Bestandszeile
fuehrt unit_price und purchase_price, aber KEINEN Marktpreis; der liegt in
minifig_price_cache. Das Feld war also immer leer.

Das ist die Folge einer frueheren, richtigen Entscheidung: Die App holte
diese Listen einmal aus der BEWERTUNG und lud dabei jedes Mal alle
Marktpreis-Abfragen mit. Beim Umzug auf die schlanke Quelle ist uebersehen
worden, dass der Detailbildschirm mehr zeigt als die Kachel.

── Warum NUR aus dem Cache ─────────────────────────────────────────────────

Genau deshalb. Ein Live-Abruf je Eintrag waere der Zustand, von dem der
Umzug wegfuehren sollte — und er ginge auf das Tageskontingent bei
BrickLink. Was im Cache liegt, ist umsonst; was nicht drinsteht, bleibt
leer, bis die Bewertung es das naechste Mal holt. Eine Zeile ohne Preis ist
besser als eine Liste, die auf zwanzig Netzabrufe wartet.

EINE Abfrage je Liste, unabhaengig von ihrer Laenge.
```

<a id="marktpreiseauscachefuerteile"></a>
## `marktpreiseAusCacheFuerTeile`

```text
Dasselbe fuer manuell erfasste TEILE — siehe die Begruendung oben.

Ein Unterschied zu den Figuren: Der Teile-Cache ist ueber die
BRICKLINK-Nummer UND die BrickLink-Farbnummer verschluesselt (fetchPartPrice
uebersetzt beides, bevor es liest oder schreibt). Beide Uebersetzungen sind
seit dem Performance-Durchgang billig — die Farbtabelle wird als Ganzes
gemerkt, die Teilenummern holt ladeBlNummernVor() in zwei Abfragen fuer die
ganze Liste.
```

<a id="marktpreismitherkunft"></a>
## `marktpreisMitHerkunft`

```text
Marktpreis eines Teils SAMT Herkunft.

Zwei Funktionen statt einer: Die allermeisten Aufrufer (Bewertung,
Nachtrag-Job, Erfassungs-Route) wollen eine Zahl und nichts weiter — ihnen
eine Herkunft aufzuzwingen, die sie wegwerfen, machte sechs Aufrufstellen
umstaendlicher, damit eine es bequemer hat. Nur der Weg „von Hand erfassen"
kennzeichnet den Rueckfall, und nur er fragt hier.
```

<a id="marktpreismitherkunft-2"></a>
## Abschnitt

```text
── Der Rückfall wird übernommen, aber benannt (Nachtrag 167) ───────────

In Nachtrag 166 stand hier `if (priceData?.is_fallback) return null` —
als Antwort auf Marcos Befund, dass der Zustand keinen Einfluss auf den
Preis hat. Der Befund stimmte, die Folge war zu scharf: Marco meldete
darauf „teilweise wird der Kaufpreis nicht direkt geladen", weil
BrickLink zu vielen Teilen nur einen der beiden Zustände führt.

Seine Entscheidung: übernehmen und kennzeichnen. `ausZustand` trägt
deshalb den Zustand, aus dem der Wert wirklich stammt — die Oberfläche
sagt es dann dazu, statt dass eine Zahl unkommentiert dasteht.
```

<a id="estimatefigpricefromparts-ttl"></a>
## `ttl`

```text
── Erst im Cache nachsehen (Nachtrag 144) ────────────────────────────────

Marcos Auftrag: „Der geschätzte Marktpreis soll ebenfalls im Cache
gespeichert werden, damit er nicht jedes Mal neu geholt werden muss."

GESCHRIEBEN wurde er schon (unten, samt Verlaufspunkt) — GELESEN nie. Jeder
Aufruf holte deshalb erneut die Teile-Zusammensetzung von Rebrickable und
danach den BrickLink-Preis JE TEIL. Eine Minifigur mit fünfzehn Teilen
kostete fünfzehn Preisabfragen, bei jedem Öffnen der Finanzseite.

Dieselbe Frist wie beim echten Abruf (price_cache_ttl, Vorgabe 24 h): Der
Wert ist derselbe Marktpreis, nur anders ermittelt — er soll nicht länger
gelten als ein von BrickLink geholter.
```

<a id="estimatefigpricefromparts"></a>
## Abschnitt

```text
BrickLink-Nummern für Teile ohne external_ids in EINER Abfrage vorladen
(statt pro Teil eine eigene Query — vermeidet N+1).

Die Abfrage stand hier zeichengleich ein zweites Mal (jetzt
ladeBlNummernVor in utils/financeCalc.ts); test/sql-kerne.test.js hat es
gemeldet. Uebersetzt wird seither nicht mehr HIER, sondern unten in
fetchPartPrice — die Antwort liegt dann im gemeinsamen Gedaechtnis.

Ein Unterschied bleibt und ist gewollt: ladeBlNummernVor kennt neben
rb_bl_mapping auch den Rueckfall ueber parts.bl_part_number. Ein Teil,
dessen Zuordnung nur dort steht, wurde vorher NICHT uebersetzt — genau
die Luecke, die resolveBlPartNumber ueberall sonst schliesst.
```

<a id="estimatefigpricefromparts-2"></a>
## Abschnitt

```text
── Die Schätzung gehört in Cache UND Verlauf ─────────────────────────────

Gemeldet: Im Detail-Dialog einer Minifigur OHNE BrickLink-Nummer standen
bei „Marktpreis (Neu)" und „Marktpreis (Gebraucht)" nur Striche, und der
Preisverlauf blieb leer — obwohl Kaufpreise in beiden Zuständen erfasst
waren und die Finanzliste einen Wert zeigte.

Ursache: Die Schätzung wurde bei jedem Aufruf frisch gerechnet und
nirgends abgelegt. Marktpreis-Zeile und Diagramm lesen aber
minifig_price_cache bzw. minifig_price_history (utils/priceHistory.ts) —
und genau für diese Figuren blieb dort für immer alles leer. Ein echter
BrickLink-Abruf schreibt beide Tabellen seit jeher (fetchMinifigPrice);
der Schätzpfad war der einzige, der es nicht tat.

Beide Tabellen sind benutzerunabhängig — das passt: Die Schätzung stammt
aus BrickLink-Teilepreisen, nicht aus dem Bestand des Nutzers. Nur die
Währung kommt aus seinen Einstellungen und steht deshalb im Schlüssel.
```

<a id="figmarktpreismitherkunft"></a>
## Abschnitt

```text
BrickLink zuerst — und zwar auch OHNE separate bl_fig_number.

Vorher lief der Abruf nur, wenn eine abweichende BrickLink-Nummer
hinterlegt war. Bei einer manuell erfassten Figur ist das der Ausnahme-
und nicht der Regelfall: Meist stimmt die eigene Nummer (sw0001 &c.)
mit der BrickLink-Nummer überein. Der Abruf wurde dadurch übersprungen,
die Teile-Schätzung übernahm — und die liefert ohne
Teile-Zusammensetzung von Rebrickable nichts. Ergebnis: gar kein Preis.

Reihenfolge wie gewünscht: BrickLink, und nur wenn dort nichts zu holen
ist, die Schätzung über die Einzelteile.
```

<a id="figmarktpreismitherkunft-price"></a>
## `price`

```text
── Der Rueckfall wird uebernommen, aber benannt (Nachtrag 167) ───────

Marcos Befund aus Nachtrag 166: „Wenn ich eine Minifigur mit dem
Zustand neu oder gebraucht erfasse, erhaelt diese denselben Preis."
Er stimmte — fetchMinifigPrice faellt bei leerem Price Guide auf den
anderen Zustand zurueck und markiert das mit `is_fallback`, und diese
Stelle warf die Markierung weg.

Die Antwort damals war `continue` — also gar kein Preis. Darauf kam
Marcos naechster Befund: „Teilweise wird der Kaufpreis nicht direkt
geladen." Beides ist dieselbe Tatsache von zwei Seiten: BrickLink
fuehrt zu vielen Figuren nur EINEN Zustand.

Seine Entscheidung: uebernehmen und kennzeichnen. Der Wert kommt
zurueck, und mit ihm der Zustand, aus dem er wirklich stammt.
```
