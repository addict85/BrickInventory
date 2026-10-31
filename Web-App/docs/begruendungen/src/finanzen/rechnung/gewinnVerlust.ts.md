# Begründungen zu `src/finanzen/rechnung/gewinnVerlust.ts`

Die ausführlichen Kommentare aus `src/finanzen/rechnung/gewinnVerlust.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Gewinn und Verlust — was der Bestand gekostet hat und was er heute wert ist.

── Warum das eine eigene Datei ist (Nachtrag 171) ──────────────────────────

Marcos Frage nach Architektur und Codequalitaet hatte src/finanzen/financeCalc.ts
mit 1529 Zeilen als groessten Posten. Die Datei trug DREI Aufgaben:

  1. Preisbeschaffung — BrickLink abfragen, zwischenspeichern, das
     Anfragekontingent verwalten
  2. Bewertung — was ist der Bestand heute wert
  3. Gewinn und Verlust — was hat er gekostet, was hat er gebracht

Gemessen haengen sie nur in EINE Richtung zusammen: Die Bewertung braucht
die Preise, die G&V braucht davon gar nichts ausser einem Helfer. Wer am
Anfragekontingent etwas aendert, sollte nicht in derselben Datei stehen wie
die Gewinnrechnung.

Die Aufteilung ist rein raeumlich: Kein Verhalten hat sich geaendert, und
src/finanzen/financeCalc.ts reicht alles weiterhin durch — keine einzige
Aufrufstelle musste angefasst werden.
```

<a id="computepnl"></a>
## Abschnitt

```text
DIESE Abfrage speist die P&L-Antwort und damit den in der Galerie und im
Detail-Dialog angezeigten „Marktpreis". Sie hatte zwei Fehler, die beim
ersten Preis-Fix in routes/ behoben wurden, hier aber stehen blieben:

  1. Sie las nur qty_avg_price. Die Zuweisungszeile darunter griff auf
     r.avg_price zu — das war undefined, also gewann immer der
     mengengewichtete Schnitt.
  2. ORDER BY (qty_avg_price > 0) DESC, (condition = …) DESC stellte
     „hat einen Preis" VOR „passender Zustand". Mit DISTINCT ON gewann
     damit der Gebraucht-Preis, auch für ein neues Set.

Neu: beide Zustände holen und je Set nach dessen eigenem Zustand wählen —
der globale Standardzustand passt nicht für eine gemischte Sammlung.
```

<a id="computepnl-2"></a>
## Abschnitt

```text
Je Erfassung mit dem Preis IHRES Zustands bewerten und erst danach
verdichten — dieselbe Rechnung wie im Finanzen-Reiter
(utils/acquisitionValue.ts).

Vorher galt hier EIN Zustand fürs ganze Set: eine einzige
Gebraucht-Erfassung liess den Marktpreis aller Exemplare auf den
Gebrauchtpreis fallen. Galerie-Kachel und Detail-Dialog lesen genau
diese Antwort — die Sammlung wurde damit schlagartig weniger wert, ohne
dass sich am Markt etwas geändert hätte.
```

<a id="computepnl-3"></a>
## Abschnitt

```text
Der Gesamtwert des Portfolios — Sets + manuell erfasste Teile +
Minifiguren.

── Warum ausdrücklich (Nachtrag 145) ────────────────────────────────

Marcos Frage: „Ist sichergestellt, dass die ganze Logik im Server
zentral ist und beide Clients nur rendern?"

Für diese Zahl war sie es NICHT: Webapp und Android addierten je selbst
`sets.totals.avg + parts.total_value + figs.total_value`. Die Regel
„was zählt zum Gesamtwert" stand damit an drei Stellen.

Derselbe Wert steckte schon in `current` — der wird aber aus den
Preisen JE ZEILE gebildet und ist damit die belastbarere Quelle als
eine Addition dreier gerundeter Endsummen. Er bekommt hier nur einen
Namen, der sagt, wofür er da ist. Kein zusätzlicher Abruf: Beide
Clients holen /finance/pnl ohnehin.
```
