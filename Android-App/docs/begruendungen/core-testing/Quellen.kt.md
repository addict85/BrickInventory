# Begründungen zu `core-testing/Quellen.kt`

Die ausführlichen Kommentare aus `core-testing/src/main/java/ch/brickinventoryapp/Quellen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="quellen"></a>
## `Quellen`

```text
Gemeinsame Fassung für alle Tests, die QUELLTEXT lesen statt Verhalten
auszuführen.

── Warum es diese Datei gibt (Nachtrag 115) ────────────────────────────────

41 von 47 Testdateien lesen Quelltext — unvermeidlich, solange hier ohne
Android-SDK gearbeitet wird. Der Preis dafür stand bis jetzt verstreut in
jeder einzelnen Datei:

 - `lies()` und `code()` standen zeichengleich in mehreren Dateien, der Pfad
   `src/main/java/ch/brickinventoryapp/…` wurde 29-mal neu gebaut.
 - Mindestens zwölf Stellen schnitten ein FESTES ZEICHENFENSTER
   (`substring(i, i + 400)`). Genau diese Konstruktion ist in dieser Reihe
   viermal gebrochen, sobald ein Erklärkommentar wuchs — zuletzt in
   data-layout, ImageClientLogging, PartsMinifigsFullResBypassProxy und
   image-thumb-fallback. Ein Test, der korrekten Code anmeckert, wird
   abgeschaltet statt befolgt.

Das Gegenmittel ist beide Male dasselbe: erst Kommentare ausblenden, dann
schneiden — und in ZEILEN messen statt in Zeichen, weil eine zusätzliche
Kommentarzeile dann gar nicht erst mitzählt.

Der Manager hat dafür seit hardened-131 test/helpers/sources.js; das hier ist
das Gegenstück.
```

<a id="workflow"></a>
## `workflow`

```text
Der Android-Workflow, ohne Kommentarzeilen.

── Warum das hier steht und nicht zweimal daneben ───────────────────────
ApkNameTest las ihn ueber `../../.github/…`, SelbstUpdateTest ueber
`../.github/…` — eine Ebene zu wenig. Der Lauf hat es gemeldet (Lauf 131),
aber erst nach neun Minuten, und die oertliche Gegenprobe war blind
dafuer: Sie lief aus `Android-App/`, wo der kuerzere Pfad zufaellig
stimmt. Gradle-Tests laufen aus `Android-App/app`.

Eine Pfadangabe in zwei Schreibweisen ist dieselbe Fehlerart wie eine
Regel in zwei Kopien: Sie faellt nicht auf, solange beide zufaellig
dasselbe treffen.

Kommentarzeilen sind draussen, weil ein Absatz, der eine alte
Schreibweise ERKLAERT, sie zwangslaeufig nennt — und damit selbst zum
vermeintlichen Verstoss wuerde.
```

<a id="alle"></a>
## `alle`

```text
Alle Kotlin-Quelldateien des Hauptbaums.

── Mit Untergrenze, und das ist der Punkt (Nachtrag 118) ───────────────
Quelltextlesende Tests haben fast alle dieselbe Form: Verstösse in eine
Liste sammeln, am Ende `assert(fehler.isEmpty())`. Findet der Dateilauf
nichts — falscher Pfad, umbenannter Ordner, geänderte Endung —, ist die
Liste leer und der Test GRÜN, ohne etwas geprüft zu haben. Ein Test, der
bei kaputtem Werkzeug schweigt, ist schlimmer als keiner: Er erzeugt das
Vertrauen, ohne es zu verdienen.

Die Grenze steht hier statt in einundzwanzig Testmethoden, weil sie so
an genau einer Stelle gepflegt wird. Der Wert ist grosszügig gewählt —
er soll „gar nichts gefunden" fangen, nicht das Löschen einer Datei
verbieten.
```

<a id="unter"></a>
## `unter`

```text
Alle Quelldateien unterhalb eines Unterordners, z. B. `"ui"` oder
`"ui/screens"`.

Vergleicht über [File.invariantSeparatorsPath], NICHT über `path`
(Nachtrag 118): Auf Windows — und dort wird dieses Projekt gebaut —
liefert `path` Backslashes, ein `path.contains("/ui/")` findet also
NICHTS. Der Test wäre dann grün, weil er keine Datei geprüft hat. Genau
die Falle, gegen die die Untergrenze in [alle] gebaut ist; sie greift
hier über die Prüfung unten mit.
```

<a id="ohnekommentare"></a>
## `ohneKommentare`

```text
Kommentare ausblenden — ZEILENWEISE und bewusst konservativ.

KEIN Blockkommentar-Muster über die ganze Datei: Kotlin erlaubt
VERSCHACHTELTE Blockkommentare (anders als Java), und ein Sternchen in
einem Pfad oder einer Regex innerhalb eines Kommentars öffnet dort einen
zweiten, der nie geschlossen wird. In dieser Reihe hat genau das schon
einmal eine ganze Datei ab Zeile 78 verschluckt (Nachtrag 39b), und im
Manager hat dieselbe Regex 28 von 53 KB weggerissen.

Deshalb wird nur entfernt, was eine ZEILE beginnt. Ein nachgestellter
Kommentar am Zeilenende bleibt stehen — er ist harmlos, weil die
Prüfungen nach Code suchen, nicht nach dessen Abwesenheit.

Die Zeilen bleiben als leere Zeilen erhalten, damit Zeilennummern in
Fehlermeldungen weiterhin stimmen.
```

<a id="zustandsfluesse"></a>
## `zustandsFluesse`

```text
Welcher öffentliche Zustandsfluss des ViewModels trägt welchen Typ?
Ergebnis z. B. `catalogState -> CatalogUiState`.

Gelesen aus AppViewModel.kt und BereichsViewModel.kt — die Flüsse, die
jeder Bildschirm unter `vm.` findet, egal welches ViewModel `vm` ist
(`state`, `blickfeld`, `lagerState`). Bewusst abgeleitet statt in den
Tests aufgezählt: Eine Liste dort wäre eine zweite Wahrheit.
```

<a id="fluessejeviewmodel"></a>
## `fluesseJeViewModel`

```text
Dasselbe für JEDES ViewModel: Klasse → (öffentlicher Flussname → Typ).

── Warum das nötig wurde ───────────────────────────────────────────────
Solange aller Zustand in einem ViewModel lag, genügte ein Name: `vm`. Seit
es Bildschirm-ViewModels gibt, heisst der Fluss in beiden schlicht
`state` und trägt Verschiedenes — `vm.state` ist der App-Zustand,
`katalog.state` der Katalogzustand. Der Name allein sagt es nicht mehr,
der EMPFÄNGER sagt es.

Zwei Schreibweisen werden gelesen, weil beide vorkommen:
  private val _catalogState = MutableStateFlow(CatalogUiState())
  val state = _catalogState.asStateFlow()
Ohne die zweite hiesse der Fluss hier `catalogState` und wäre unter
seinem echten Namen `state` nicht zu finden.
```

<a id="mitgliederjeuistate"></a>
## `mitgliederJeUiState`

```text
Was bietet eine `…UiState`-Datenklasse an — Felder UND abgeleitete
Mitglieder?

── Warum das hier steht und nicht zweimal in den Tests ─────────────────
Zwei Prüfungen ersetzen den fehlenden Compiler und halten jeden Zugriff
`zustand.name` gegen das, was die Klasse hat: UiStateFieldsTest und
ScreenViewModelWiringTest. Beide hatten ihre EIGENE Fassung dieser
Erfassung, und die eine kannte den Klassenrumpf, die andere nur den
Konstruktor. Genau das ist die Form, aus der still auseinanderlaufende
Regeln entstehen.

── Warum auch Funktionen dazugehoeren ──────────────────────────────────
Der Kommentar bei der frueheren Fassung hat das schon einmal fuer
abgeleitete EIGENSCHAFTEN festgehalten: Eine Luecke im Muster, die
gewoehnliches Kotlin verbietet, ist kein Fund — sie bringt den Naechsten
dazu, schlechteren Code zu schreiben, um sie ruhig zu stellen. Fuer eine
Methode gilt dasselbe:

    data class FinanceUiState(val kategorien: Set<String> = emptySet()) {
        fun zeigt(art: String) = kategorien.isEmpty() || art in kategorien
    }

`financeState.zeigt("sets")` ist ein gueltiger Aufruf. Die Pruefung
verliert dadurch nichts: Ein VERTIPPTER Name steht ebenso wenig in der
Menge wie vorher.

Der Rumpf wird bis zur schliessenden Klammer AM ZEILENANFANG gelesen —
so kann die Erfassung nicht in die naechste Klasse hineinlaufen.
```

<a id="zustandsnamen"></a>
## `zustandsNamen`

```text
Welchen Zustandstyp trägt ein Name in DIESER Datei?

Zwei Quellen, in dieser Reihenfolge: ein Parameter `name: XyzUiState`,
und — seit die Bildschirme ihren Zustand selbst abholen (Nachtrag
96/115) — die Zeile `val name by vm.xyzState.collectAsStateWithLifecycle()`.

Ohne die zweite Quelle hielten die Prüfungen `state` in CatalogScreen
für den App-Zustand und meldeten fünfundzwanzig Fehlalarme. Ein Test,
der korrekten Code anmeckert, wird abgeschaltet statt befolgt.
```

<a id="fenster"></a>
## `fenster`

```text
Ein Ausschnitt ab dem ersten Vorkommen von [ab], gemessen in ZEILEN.

Der Ersatz für `substring(i, i + 400)`: Kommentare sind vorher weg, und
gezählt werden Zeilen. Ein Absatz Erklärung mehr über der Fundstelle
verschiebt damit nichts.

Fehlt [ab] ganz, kommt eine leere Zeichenkette zurück — die Prüfung
scheitert dann an ihrer eigenen Aussage statt an einer Bereichsgrenze.
```

<a id="funktion"></a>
## `funktion`

```text
Der Rumpf einer Funktion, ab ihrer Signatur bis zu ihrer schliessenden
Klammer. Genauer als ein festes Fenster, wo es um „steht X in dieser
Funktion?" geht.

Das Ende ist die schliessende Klammer auf DERSELBEN Einrückung wie die
Signatur — nicht in Spalte 0. Die erste Fassung nahm Spalte 0 und
lieferte für eine Methode INNERHALB einer Klasse den Rest der ganzen
Klasse: `getSets(` in BrickRepository ergab 320 statt 20 Zeilen. Die
Prüfung blieb grün und hätte auch dann grün bleiben können, wenn der
gesuchte Text in einer ganz anderen Methode gestanden hätte — ein zu
weites Fenster ist genauso wertlos wie ein zu enges, nur fällt es nicht
auf.
```

<a id="kameraquelle"></a>
## `kameraQuelle`

```text
Ein Kamerabildschirm samt allem, was zu seiner Kamera gehört.

── Warum das hier steht ────────────────────────────────────────────────
Diese Funktion hiess `mitAnalyse` und stand DREIMAL im Testbaum — in
CameraXUpgradeTest, ResourceAndCacheTest und SessionAndLifecycleTest,
jeweils mit fast gleichlautendem Erklärkommentar. Sie ist selbst ein
Beispiel für das, wogegen sie gebaut wurde: Die Kamera besteht aus
mehreren Dateien, und wer nur eine liest, findet die halbe Regel.

Seit Nachtrag 99 liegt die Bildanalyse des Scanners in
BarcodeAnalyzer.kt; seit dem Zusammenfassen des Kamera-Aufbaus liegt die
gemeinsame Einstellung (AF-Modus, Auflösung, Ausgabeformat) in
KameraAufbau.kt. Beides gehört dazu — als der Aufbau umzog, sind genau
die drei Prüfungen rot geworden, die es nicht wussten.

@param rel z. B. "ui/screens/BarcodeScannerScreen.kt"
```
