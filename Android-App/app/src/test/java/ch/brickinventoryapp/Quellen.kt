package ch.brickinventoryapp

import java.io.File

/**
 * Gemeinsame Fassung für alle Tests, die QUELLTEXT lesen statt Verhalten
 * auszuführen.
 *
 * ── Warum es diese Datei gibt (Nachtrag 115) ────────────────────────────────
 *
 * 41 von 47 Testdateien lesen Quelltext — unvermeidlich, solange hier ohne
 * Android-SDK gearbeitet wird. Der Preis dafür stand bis jetzt verstreut in
 * jeder einzelnen Datei:
 *
 *  - `lies()` und `code()` standen zeichengleich in mehreren Dateien, der Pfad
 *    `src/main/java/ch/brickinventoryapp/…` wurde 29-mal neu gebaut.
 *  - Mindestens zwölf Stellen schnitten ein FESTES ZEICHENFENSTER
 *    (`substring(i, i + 400)`). Genau diese Konstruktion ist in dieser Reihe
 *    viermal gebrochen, sobald ein Erklärkommentar wuchs — zuletzt in
 *    data-layout, ImageClientLogging, PartsMinifigsFullResBypassProxy und
 *    image-thumb-fallback. Ein Test, der korrekten Code anmeckert, wird
 *    abgeschaltet statt befolgt.
 *
 * Das Gegenmittel ist beide Male dasselbe: erst Kommentare ausblenden, dann
 * schneiden — und in ZEILEN messen statt in Zeichen, weil eine zusätzliche
 * Kommentarzeile dann gar nicht erst mitzählt.
 *
 * Der Manager hat dafür seit hardened-131 test/helpers/sources.js; das hier ist
 * das Gegenstück.
 */
object Quellen {

    val wurzel: File = File("src/main/java/ch/brickinventoryapp")

    /** Eine Quelldatei, relativ zu ch/brickinventoryapp/. */
    fun lies(rel: String): String = File(wurzel, rel).readText()

    /**
     * Alle Kotlin-Quelldateien des Hauptbaums.
     *
     * ── Mit Untergrenze, und das ist der Punkt (Nachtrag 118) ───────────────
     * Quelltextlesende Tests haben fast alle dieselbe Form: Verstösse in eine
     * Liste sammeln, am Ende `assert(fehler.isEmpty())`. Findet der Dateilauf
     * nichts — falscher Pfad, umbenannter Ordner, geänderte Endung —, ist die
     * Liste leer und der Test GRÜN, ohne etwas geprüft zu haben. Ein Test, der
     * bei kaputtem Werkzeug schweigt, ist schlimmer als keiner: Er erzeugt das
     * Vertrauen, ohne es zu verdienen.
     *
     * Die Grenze steht hier statt in einundzwanzig Testmethoden, weil sie so
     * an genau einer Stelle gepflegt wird. Der Wert ist grosszügig gewählt —
     * er soll „gar nichts gefunden" fangen, nicht das Löschen einer Datei
     * verbieten.
     */
    fun alle(): List<File> {
        val dateien = wurzel.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        check(dateien.size >= 60) {
            "Nur ${'$'}{dateien.size} Kotlin-Dateien unter ${'$'}{wurzel.absolutePath} gefunden. " +
                "Das ist zu wenig — vermutlich stimmt der Pfad nicht mehr. Alle Prüfungen, " +
                "die darauf aufbauen, wären sonst stillschweigend grün."
        }
        return dateien
    }

    /**
     * Alle Quelldateien unterhalb eines Unterordners, z. B. `"ui"` oder
     * `"ui/screens"`.
     *
     * Vergleicht über [File.invariantSeparatorsPath], NICHT über `path`
     * (Nachtrag 118): Auf Windows — und dort wird dieses Projekt gebaut —
     * liefert `path` Backslashes, ein `path.contains("/ui/")` findet also
     * NICHTS. Der Test wäre dann grün, weil er keine Datei geprüft hat. Genau
     * die Falle, gegen die die Untergrenze in [alle] gebaut ist; sie greift
     * hier über die Prüfung unten mit.
     */
    fun unter(ordner: String): List<File> {
        val muster = "/${'$'}{ordner.trim('/')}/"
        val treffer = alle().filter { it.invariantSeparatorsPath.contains(muster) }
        check(treffer.isNotEmpty()) {
            "Keine Kotlin-Dateien unter '${'$'}ordner' gefunden — Ordner umbenannt? " +
                "Eine leere Liste würde jede darauf aufbauende Prüfung stillschweigend bestehen."
        }
        return treffer
    }

    /**
     * Kommentare ausblenden — ZEILENWEISE und bewusst konservativ.
     *
     * KEIN Blockkommentar-Muster über die ganze Datei: Kotlin erlaubt
     * VERSCHACHTELTE Blockkommentare (anders als Java), und ein Sternchen in
     * einem Pfad oder einer Regex innerhalb eines Kommentars öffnet dort einen
     * zweiten, der nie geschlossen wird. In dieser Reihe hat genau das schon
     * einmal eine ganze Datei ab Zeile 78 verschluckt (Nachtrag 39b), und im
     * Manager hat dieselbe Regex 28 von 53 KB weggerissen.
     *
     * Deshalb wird nur entfernt, was eine ZEILE beginnt. Ein nachgestellter
     * Kommentar am Zeilenende bleibt stehen — er ist harmlos, weil die
     * Prüfungen nach Code suchen, nicht nach dessen Abwesenheit.
     *
     * Die Zeilen bleiben als leere Zeilen erhalten, damit Zeilennummern in
     * Fehlermeldungen weiterhin stimmen.
     */
    fun ohneKommentare(quelle: String): String = quelle.lines().joinToString("\n") { zeile ->
        val t = zeile.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else zeile
    }

    /**
     * Welcher öffentliche Zustandsfluss des ViewModels trägt welchen Typ?
     * Ergebnis z. B. `catalogState -> CatalogUiState`.
     *
     * Gelesen aus den Feldern `_xyzState = MutableStateFlow(XyzUiState())` in
     * MainViewModel.kt — der öffentliche Name ist derselbe ohne Unterstrich.
     * Bewusst abgeleitet statt in den Tests aufgezählt: Eine Liste dort wäre
     * eine zweite Wahrheit, die beim nächsten neuen Zustand still veraltet.
     */
    fun zustandsFluesse(): Map<String, String> =
        Regex("""_(\w+)\s*=\s*MutableStateFlow\((\w+UiState)\(""")
            .findAll(lies("ui/MainViewModel.kt"))
            .associate { it.groupValues[1] to it.groupValues[2] }

    /**
     * Welchen Zustandstyp trägt ein Name in DIESER Datei?
     *
     * Zwei Quellen, in dieser Reihenfolge: ein Parameter `name: XyzUiState`,
     * und — seit die Bildschirme ihren Zustand selbst abholen (Nachtrag
     * 96/115) — die Zeile `val name by vm.xyzState.collectAsStateWithLifecycle()`.
     *
     * Ohne die zweite Quelle hielten die Prüfungen `state` in CatalogScreen
     * für den App-Zustand und meldeten fünfundzwanzig Fehlalarme. Ein Test,
     * der korrekten Code anmeckert, wird abgeschaltet statt befolgt.
     */
    fun zustandsNamen(quelle: String): Map<String, String> {
        val sauber = ohneKommentare(quelle)
        val fluesse = zustandsFluesse()
        val namen = mutableMapOf<String, String>()
        Regex("""\b(\w+)\s*:\s*(?:[\w.]*\.)?(\w+UiState)\b""").findAll(sauber).forEach {
            namen[it.groupValues[1]] = it.groupValues[2]
        }
        Regex("""\bval\s+(\w+)\s+by\s+vm\.(\w+)\.collectAsStateWithLifecycle""")
            .findAll(sauber).forEach { m ->
                fluesse[m.groupValues[2]]?.let { namen[m.groupValues[1]] = it }
            }
        return namen
    }

    /**
     * Ein Ausschnitt ab dem ersten Vorkommen von [ab], gemessen in ZEILEN.
     *
     * Der Ersatz für `substring(i, i + 400)`: Kommentare sind vorher weg, und
     * gezählt werden Zeilen. Ein Absatz Erklärung mehr über der Fundstelle
     * verschiebt damit nichts.
     *
     * Fehlt [ab] ganz, kommt eine leere Zeichenkette zurück — die Prüfung
     * scheitert dann an ihrer eigenen Aussage statt an einer Bereichsgrenze.
     */
    fun fenster(quelle: String, ab: String, zeilen: Int): String {
        val sauber = ohneKommentare(quelle)
        val i = sauber.indexOf(ab)
        if (i < 0) return ""
        val abZeile = sauber.substring(0, i).count { it == '\n' }
        return sauber.lines().drop(abZeile).take(zeilen).joinToString("\n")
    }

    /**
     * Der Rumpf einer Funktion, ab ihrer Signatur bis zu ihrer schliessenden
     * Klammer. Genauer als ein festes Fenster, wo es um „steht X in dieser
     * Funktion?" geht.
     *
     * Das Ende ist die schliessende Klammer auf DERSELBEN Einrückung wie die
     * Signatur — nicht in Spalte 0. Die erste Fassung nahm Spalte 0 und
     * lieferte für eine Methode INNERHALB einer Klasse den Rest der ganzen
     * Klasse: `getSets(` in BrickRepository ergab 320 statt 20 Zeilen. Die
     * Prüfung blieb grün und hätte auch dann grün bleiben können, wenn der
     * gesuchte Text in einer ganz anderen Methode gestanden hätte — ein zu
     * weites Fenster ist genauso wertlos wie ein zu enges, nur fällt es nicht
     * auf.
     */
    fun funktion(quelle: String, signatur: String): String {
        val sauber = ohneKommentare(quelle)
        val i = sauber.indexOf(signatur)
        if (i < 0) return ""
        val rest = sauber.substring(i).lines()
        // Einrückung der SIGNATURZEILE — nicht der Abstand der Fundstelle zum
        // Zeilenanfang. Bei `internal fun MainViewModel.x(` liegt zwischen
        // beidem das Wort `internal`, und der Abstand ergäbe neun Leerzeichen
        // Einzug für eine Funktion, die auf Spalte 0 steht. Ende nie gefunden,
        // Fenster wieder viel zu weit.
        val zeilenBeginn = sauber.lastIndexOf('\n', i) + 1
        val einzug = sauber.substring(zeilenBeginn).takeWhile { it == ' ' }
        val ende = rest.drop(1).indexOfFirst { it == "$einzug}" }
        return if (ende < 0) rest.joinToString("\n") else rest.take(ende + 2).joinToString("\n")
    }
}
