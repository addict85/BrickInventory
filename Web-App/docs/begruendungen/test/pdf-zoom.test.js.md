# Begründungen zu `test/pdf-zoom.test.js`

Die ausführlichen Kommentare aus `test/pdf-zoom.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der PDF-Betrachter kann zoomen — und verliert dabei weder die Stelle noch
die linke Seitenhaelfte.

── Woher diese Datei kommt ─────────────────────────────────────────────────

Marcos Wunsch: „Kannst du bei den PDF Viewer in der Android App und der
Webapp dass man Zoom kann?" Anleitungen sind der Hauptfall — und wer in einer
Anleitung zoomt, will eine Teilenummer lesen, nicht die Seite wechseln.

── Was hier geprueft wird, und was NICHT ───────────────────────────────────

Geprueft wird der echte public/js/12-pdfviewer.js in jsdom. jsdom rechnet
kein Layout, deshalb werden clientWidth/clientHeight und die Rollstaende hier
ausdruecklich gesetzt — ohne das waeren alle Masse 0 und jede Rechnung ginge
trivial auf. Ebenso gestellt: IntersectionObserver (gibt es in jsdom nicht)
und PDF.js.

NICHT geprueft wird hier die FLEXBOX-Falle, also ob die linke Seitenhaelfte
beim Hineinzoomen erreichbar bleibt — dazu braucht es eine Maschine, die
Layout rechnet. Die liegt dem Kommentar in _pdfMassPlatzhalter() zugrunde und
wurde in Chromium 142 gemessen:

                             Seite 1200px breit in 400px-Behaelter
                             scrollWidth   linker Rand erreichbar bei
  align-items:center (vorher)        800                        −400
  center + margin:0 auto            1200                           0

Hier bleibt davon nur die Zusicherung, dass die auto-Raender ueberhaupt
gesetzt werden (Fall „Platzhalter traegt die auto-Raender"). Das ist eine
Aussage ueber den Bauteil, nicht ueber die Wirkung — die Wirkung steht oben
und ist gemessen. Eine schwaechere Zusicherung als die Messung, aber die
einzige, die in dieser Werkbank ueberhaupt etwas bedeutet.

── Die Gegenprobe laeuft MIT ───────────────────────────────────────────────

Fall „Gegenprobe: ohne Ankerrechnung springt es" nimmt genau die beiden
Zeilen heraus, die den Ankerpunkt wiederherstellen, und besteht darauf, dass
die Stelle dann WEGLAEUFT. Ohne das hiesse „der Anker haelt" nur, dass in
dieser Werkbank gar nichts rollt — der haeufigste Weg, auf dem sich eine
Messung selbst bestaetigt.

Ausserdem in Chromium 142 von Hand nachgefahren (playwright-core, echtes
Layout, gefaelschtes PDF.js, 20 Seiten A4): Anker haelt auf 0,30 px genau;
bei 477 % sind linker und rechter Seitenrand beide erreichbar (scrollWidth
2728 = volle Seitenbreite); Strg+Rad zoomt, Rad ohne Strg rollt weiter
(scrollTop 82 → 382); Tasten +/−/0 wirken; zwei Finger auseinander 100 % →
142 %, zusammen 244 % → 209 %; der Leinwandriegel greift bei 16,0 MPixel
(3363 x 4758). Das steht hier, weil playwright-core keine Abhaengigkeit
dieses Projekts ist und der Lauf deshalb nicht Teil der Testreihe sein kann.
```

<a id="beobachtet"></a>
## `const beobachtet = [];`

```text
Gestellter IntersectionObserver — jsdom hat keinen.

Der Rueckruf kommt ASYNCHRON, und das ist nicht Bequemlichkeit, sondern der
Punkt: Der echte Observer liefert seine Meldungen als eigene Aufgabe nach
dem Layout, nie im observe()-Aufruf selbst. Eine erste Fassung dieser
Werkbank rief synchron zurueck — damit lief der neue Renderauftrag an,
BEVOR ein veralteter seine Leinwand einhaengen konnte, und die Gegenprobe
zum Generationszaehler konnte gar nichts zeigen. Der Fehler sass in der
Werkbank, nicht im Betrachter.

Der erste Rueckruf nach observe() ist dagegen echtes Verhalten: Darauf
beruht, dass der Betrachter nach einem Zoom neu anmeldet statt zu hoffen.
```
