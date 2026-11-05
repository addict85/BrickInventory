# Begründungen zu `public/js/04-finance.js`

Die ausführlichen Kommentare aus `public/js/04-finance.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="pricestatusbadge"></a>
## `priceStatusBadge`

```text
Plakette in der letzten Spalte der Finanztabelle: Ist für diese Zeile ein
Marktpreis da oder nicht?

── Warum nur noch ZWEI Zustände ────────────────────────────────────────────
Vorher waren es drei: ⚡ (Preis aus dem Cache), 🔴 (gerade frisch von
BrickLink geholt) und „Err". Die Unterscheidung Cache/frisch ist eine
Innensicht des Servers — für die Frage „stimmt die Zahl in dieser Zeile?"
macht sie keinen Unterschied, beide Wege liefern denselben Preis. Dazu kam,
dass ausgerechnet der Normalfall (Cache) einen Blitz bekam und der seltene
Fall einen roten Punkt, der wie eine Warnung aussieht. Jetzt: Haken = Preis
da, Warndreieck = Preis fehlt.

Beide tragen title UND aria-label — ohne beides sind es zwei unerklärte
Zeichen, und Vorleseprogramme sagten bisher nur „Blitz" bzw. „roter Kreis".
Beim Fehlerfall hängt die Meldung des Servers mit im Tooltip; sichtbar steht
sie ohnehin in der Summenspalte.
```

<a id="gesamtguv"></a>
## `gesamtGuv`

```text
Die Kachel „Ø Marktpreis" (qty_avg) ist entfallen.

Sie zeigte den MENGENGEWICHTETEN Schnitt aus dem BrickLink-Preisführer, die
Gewinn-und-Verlust-Rechnung darunter rechnete aber schon länger mit avg —
Zahl und Prozentangabe daneben bezogen sich also auf verschiedene Werte.
Statt zwei Mittelwerte nebeneinander zu zeigen, deren Unterschied niemand
erklärt, bleibt der einfache Schnitt (avg): derselbe Wert, auf dem auch die
Bewertung und die Entwicklung beruhen.
Ohne vergleichbaren Posten keine G&V — auch nicht die vom letzten Filter.
```

<a id="condbadge"></a>
## `condBadge`

```text
── Teile & Minifiguren: einzeln auflisten, analog zur Sets-Tabelle ─────────
(fliesst bereits in "extra"/Gesamtsumme oben ein — hier zusätzlich transparent
als eigene Zeilen mit Kaufpreis, aktuellem Wert und G&V ausgewiesen)
Feste Spaltenbreiten (colgroup + table-layout:fixed): Bild/Name/Anz. sowie
ein Platzhalter (entspricht der Erfasst-Spalte der Sets-Tabelle) sorgen
dafür, dass Kaufpreis/Marktpreis/Gesamt/G&V exakt an der gleichen Stelle
wie in der Sets-Tabelle beginnen (nicht nur gleich breit sind).
Eine Plakette für den Zustand DIESER Zeile — gemeinsame Fassung in
02-gallery.js (dort für Kacheln mit mehreren Zuständen).
```

<a id="manargs"></a>
## `manArgs`

```text
Wie bei den Sets: eine VOLLSTÄNDIGE Zeile je Kaufpreis-Erfassung, jede mit
dem Marktpreis ihres Zustands und ihrer eigenen Entwicklung. Ein Teil, das
einmal neu und einmal gebraucht gekauft wurde, steht mit zwei Zeilen da.
Ohne Erfassungen (Altbestand) bleibt es bei der einen Zeile.
Die Zeile öffnet denselben Detail-Dialog wie die Kachel im jeweiligen
Reiter (openManDetail) — analog zur Set-Zeile, die openModal ruft.
Vorher waren Teile- und Minifiguren-Zeilen die einzigen in dieser Tabelle,
die auf einen Klick nicht reagierten.
```

<a id="setrow"></a>
## `setRow`

```text
── Eine Zeile JE KAUFPREIS-ERFASSUNG ───────────────────────────────────────

Ein Set mit einem Kaufpreis für „Neu" und einem für „Gebraucht" steht
jetzt mit ZWEI Zeilen in der Tabelle, jede mit dem Marktpreis ihres
Zustands. Vorher gab es eine Zeile je Set — und weil eine einzige
Gebraucht-Erfassung das ganze Set als gebraucht führte, wurde auch das neu
gekaufte Exemplar mit dem Gebrauchtpreis bewertet.

Bewusst OHNE zusätzliche Summenzeile je Set: Die Einzelzeilen sind die
Wahrheit, eine Summe daneben wäre eine zweite Darstellung derselben Zahlen.
Die Gesamtsumme steht wie bisher im Tabellenfuss.

Sets mit genau einer (oder ohne) Erfassung sehen unverändert aus.

JEDE Zeile ist vollständig — mit Bild, Nummer, Name und Jahr. Die erste
Fassung sparte diese vier Spalten in den Folgezeilen und rückte stattdessen
mit „↳" ein. Das las sich wie eine Unterposition und damit wie eine
Aufschlüsselung einer Summe darüber; genau das ist es aber nicht — die
Zeilen sind gleichrangig, jede steht für einen eigenen Kauf mit eigenem
Zustand, eigenem Marktpreis und eigener Entwicklung.

Zusammengehalten werden sie durch die Zustands-Plakette am Namen, die
ohnehin jede Zeile trägt.
```

<a id="grandtotal"></a>
## `grandTotal`

```text
── Gesamtwert kommt vom Server ─────────────────────────────

Hier stand `setsQtyAvg + extra` — und in FinanceSections.kt derselbe
Ausdruck noch einmal. Die Regel „was zählt zum Gesamtwert" lag damit an
drei Stellen, und /finance/pnl liefert sie ohnehin schon: `totals.grand_total`
wird dort aus den Preisen JE ZEILE gebildet statt aus drei gerundeten
Endsummen.

Der Rückfall auf die eigene Addition bleibt für den Fall, dass die
pnl-Abfrage scheitert — dann steht lieber eine leicht abweichende Zahl da
als gar keine.
```

<a id="finkategorien"></a>
## `finKategorien`

```text
── Kategoriefilter: dieselbe Regel wie in der Android-App ──────────────────

Marcos Vorgabe, dass die Funktionen in beiden Apps dieselben sein sollen.
Der Reiter hatte den Filter bisher nur in der App.

LEERE Auswahl heisst ALLE — das ist kein Sonderfall, sondern der Normalfall:
Wer nichts einschraenkt, sieht alles, und der Chip „Alle" ist genau dann
gewaehlt. Ausformuliert steht die Ueberlegung in FinanceUiState.kategorien
(Android-App); hier steht sie absichtlich NICHT noch einmal aus.

Gefiltert wird durch Ein- und Ausblenden, nicht durch Neuzeichnen: Die
Summen unten sollen sich NICHT aendern — sie beschreiben den Bestand, nicht
die Auswahl. Genau so haelt es die App auch (die Kacheln ueber der Liste
bleiben dort ebenfalls stehen).
```
