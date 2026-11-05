# Begründungen zu `test/gutschein-pdf-auszug.test.js`

Die ausführlichen Kommentare aus `test/gutschein-pdf-auszug.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die drei Werte eines Gutscheins aus seinem PDF lesen.

── Warum hier KEIN echter Gutschein liegt ──────────────────────────────────

Marco hat ein echtes Gutschein-PDF beigelegt (400 CHF, Nummer
5045076374450011166, PIN 5225). Der Auszug wurde daran GEMESSEN und
lieferte alle vier Werte richtig — am 06.10., einmalig, ausserhalb des
Baums.

Diese Datei liegt trotzdem nicht bei, und das ist kein Versehen: Das
Repository ist OEFFENTLICH (nachgesehen: private=false). Nummer und PIN
sind alles, was zum Einloesen noetig ist — ein Commit haette den Gutschein
verschenkt, und zwar unwiderruflich, weil Git sich alles merkt.

Der Test erzeugt deshalb sein PDF selbst, mit erfundenen Zahlen. Was er
damit prueft, ist die Zuordnung „welche Zahl ist was" — genau der Teil, der
schiefgehen kann. Dass das Verfahren an einem ECHTEN LEGO-PDF
funktioniert, kann nur die einmalige Messung oben sagen; ein Test kann es
ohne die Datei nicht, und diese Grenze wird hier benannt statt kaschiert.
```

<a id="buf-stelle"></a>
## `const buf = await pdfMit([`

```text
── Diese Zusicherung gibt es wegen einer GEGENPROBE ──────────────────

Der Test darueber sollte die Laengengrenze (>= 13 Stellen) absichern.
Die Gegenprobe zeigte, dass er das nicht tat: Die Grenze von 13 auf 3
herunterzusetzen liess ihn gruen — er bestand allein wegen des
PIN-Ausschlusses, also aus einem anderen Grund als behauptet.

Hier stehen deshalb Zahlen, die KEIN PIN sind und trotzdem keine
Kartennummer sein duerfen. Mit einer zu niedrigen Grenze wuerde eine
davon stillschweigend zur Nummer.
```
