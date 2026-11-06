# Begründungen zu `test/finanzen-filter-gleich.test.js`

Die ausführlichen Kommentare aus `test/finanzen-filter-gleich.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Kategoriefilter der Finanzen steht in BEIDEN Oberflaechen — gleich.

── Woher das kommt ─────────────────────────────────────────────────────────
Marcos Vorgabe fuer dieses Projekt: „ansonsten sollen die Funktion identisch
sein". Beim Nachsehen des Finanzen-Filters (den er in der App gemeldet
hatte) ist aufgefallen, dass es ihn in der Webapp gar nicht gab — vier Chips
in der App, nichts im Browser.

── Was hier geprueft wird, und was nicht ───────────────────────────────────
Nicht das Aussehen und nicht die Beschriftungen — die stehen in den
Uebersetzungsdateien und duerfen sich unterscheiden. Geprueft wird, dass
BEIDE dieselben vier Arten kennen und dieselbe Regel anwenden:

  1. Dieselben Schluessel: sets, parts, figs — plus „alle" als das Raeumen
     der Auswahl.
  2. Dieselbe Regel „leere Auswahl heisst alle". Sie steht in der App als
     FinanceUiState.zeigt(); in der Webapp muss sie GENAUSO lauten, sonst
     zeigen die beiden bei derselben Auswahl Verschiedenes.
  3. Additiv in beiden: ein Klick auf eine gewaehlte Art nimmt sie wieder
     weg, statt die uebrigen zu ersetzen.

Der Test liest beide Quellen. Er kann nicht pruefen, dass es im Browser auch
so AUSSIEHT — dafuer gibt es keinen Browser hier. Er kann pruefen, dass die
Regel nicht an einer der beiden Stellen still auseinanderlaeuft, und das ist
die Fehlerart, die dieses Projekt bisher gehabt hat.

Ausfuehren: npm test
```

<a id="ab-stelle"></a>
## `const ab = web.indexOf("setzeHtml(G('fin-tbl'), html'${setsTabelle(");`

```text
── 4. Der Filter ueberlebt das Neuzeichnen ──────────────────────────────

Ohne das stuenden nach jedem „Preise laden" wieder alle Abschnitte da,
waehrend die Chips daneben eine Auswahl anzeigen. Dieselbe Fehlerart wie
in der App, nur an anderer Stelle: eine Anzeige, die etwas behauptet.
Der Ausschnitt endet am Ende von loadFinance() — nicht am Dateiende.

Genau das hat die Gegenprobe zu diesem Test aufgedeckt: `finFilterAnwenden()`
steht zweimal in der Datei (hier und im Klick-Handler). Ein Ausschnitt bis
zum Dateiende fand deshalb IMMER einen Treffer — auch nachdem ich den
Aufruf aus loadFinance() entfernt hatte. Die Pruefung war gruen und
pruefte nichts.
```
