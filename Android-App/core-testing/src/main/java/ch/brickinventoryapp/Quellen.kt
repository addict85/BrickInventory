package ch.brickinventoryapp

import java.io.File

/**
 * Gemeinsame Fassung für alle Tests, die QUELLTEXT lesen statt Verhalten
 * auszuführen.
 * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#quellen
 */
object Quellen {

    /** Android-App/, gefunden von jedem Modulordner aus, in dem Gradle die Tests startet. */
    val projekt: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .firstOrNull { File(it, "settings.gradle.kts").isFile }
        ?: error("settings.gradle.kts nicht gefunden über ${File("").absolutePath}")

    /** Die Gradle-Module mit Quelltext, jedes als Ordner unter [projekt]. */
    val module: List<File> = projekt.listFiles { f -> File(f, "build.gradle.kts").isFile }.orEmpty().sortedBy { it.name }

    /**
     * Alle Hauptquellen unter ch/brickinventoryapp, über die Module zusammengelegt.
     * Die Prüfungen fragen nach Regeln der App, nicht nach dem Modul, in dem eine
     * Datei gerade liegt; eine Kopie je Testlauf erspart jeder Prüfung die Suche.
     */
    val wurzel: File by lazy { vereint("src/main/java/ch/brickinventoryapp", "quellen") }

    /** Alle Ressourcen (app/ und core-ressourcen/), ebenso zusammengelegt. */
    val res: File by lazy { vereint("src/main/res", "res") }

    /** Die Tests aller Module (ohne core-testing, dessen Hilfen Hauptquellen sind). */
    val tests: File by lazy { vereint("src/test/java/ch/brickinventoryapp", "tests") }

    /** Das Manifest der App — das einzige; die Bibliotheken bringen keins mit. */
    val manifest: File get() = File(projekt, "app/src/main/AndroidManifest.xml")

    private fun vereint(unterpfad: String, name: String): File {
        val ziel = kotlin.io.path.createTempDirectory("bim-$name-").toFile().apply { deleteOnExit() }
        var n = 0
        for (m in module) {
            val quelle = File(m, unterpfad)
            if (!quelle.isDirectory) continue
            quelle.walkTopDown().filter { it.isFile }.forEach { f ->
                val rel = f.relativeTo(quelle).path
                val z = File(ziel, rel)
                check(!z.exists()) { "$rel liegt in zwei Modulen" }
                f.copyTo(z); n++
            }
        }
        check(n > 0) { "Keine Dateien unter */$unterpfad in ${projekt.absolutePath}" }
        return ziel
    }

    /**
     * Der Android-Workflow, ohne Kommentarzeilen.
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#workflow
     */
    fun workflow(): String {
        val f = File("../../.github/workflows/android.yml")
        check(f.isFile) {
            "android.yml nicht gefunden unter ${f.absolutePath}. Ohne die Datei " +
                "pruefen die Tests darauf nichts und waeren trotzdem gruen."
        }
        return f.readLines().filterNot { it.trimStart().startsWith("#") }.joinToString("\n")
    }

    /** Eine Quelldatei, relativ zu ch/brickinventoryapp/. */
    fun lies(rel: String): String = File(wurzel, rel).readText()

    /**
     * Das Hilt-Modul samt Netz: AppModule, NetzModule und der gemeinsame
     * Interceptor (ServerClient) liegen getrennt unter di/; wer eine Regel des
     * Netzwegs prüft, liest alle drei.
     */
    fun di(): String {
        val dateien = File(wurzel, "di").listFiles { f -> f.name.endsWith(".kt") }.orEmpty().sortedBy { it.name }
        check(dateien.size >= 3) { "Nur ${dateien.size} Dateien unter di/ gefunden" }
        return dateien.joinToString("\n") { it.readText() }
    }

    /**
     * Alle Zustandsklassen: Sie liegen je Bereich in ui/Zustand*.kt. Mit
     * Untergrenze, sonst prüfte ein umbenannter Ordner nichts und wäre grün.
     */
    fun zustaende(): String {
        val dateien = File(wurzel, "ui").listFiles { f -> f.name.startsWith("Zustand") && f.name.endsWith(".kt") }
            .orEmpty().sortedBy { it.name }
        check(dateien.size >= 5) { "Nur ${dateien.size} Zustandsdateien unter ui/ gefunden" }
        return dateien.joinToString("\n") { it.readText() }
    }

    /**
     * Alle Kotlin-Quelldateien des Hauptbaums.
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#alle
     */
    fun alle(): List<File> {
        val dateien = wurzel.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        check(dateien.size >= 60) {
            "Nur ${dateien.size} Kotlin-Dateien unter ${wurzel.absolutePath} gefunden. " +
                "Das ist zu wenig — vermutlich stimmt der Pfad nicht mehr. Alle Prüfungen, " +
                "die darauf aufbauen, wären sonst stillschweigend grün."
        }
        return dateien
    }

    /**
     * Alle Quelldateien unterhalb eines Unterordners, z. B. `"ui"` oder
     * `"ui/screens"`.
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#unter
     */
    fun unter(ordner: String): List<File> {
        val muster = "/${ordner.trim('/')}/"
        val treffer = alle().filter { it.invariantSeparatorsPath.contains(muster) }
        check(treffer.isNotEmpty()) {
            "Keine Kotlin-Dateien unter '$ordner' gefunden — Ordner umbenannt? " +
                "Eine leere Liste würde jede darauf aufbauende Prüfung stillschweigend bestehen."
        }
        return treffer
    }

    /**
     * Kommentare ausblenden — ZEILENWEISE und bewusst konservativ.
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#ohnekommentare
     */
    fun ohneKommentare(quelle: String): String = quelle.lines().joinToString("\n") { zeile ->
        val t = zeile.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else zeile
    }

    /**
     * Welcher öffentliche Zustandsfluss des ViewModels trägt welchen Typ?
     * Ergebnis z. B. `catalogState -> CatalogUiState`.
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#zustandsfluesse
     */
    fun zustandsFluesse(): Map<String, String> {
        val src = lies("ui/AppViewModel.kt") + "\n" + lies("ui/viewmodel/BereichsViewModel.kt")
        // Zweite Form: ein Fluss, den eine eigene Klasse hält (Galerie), steht
        // mit seinem Typ da — `val galleryState: StateFlow<GalleryUiState> = …`.
        return (Regex("""_(\w+)\s*=\s*MutableStateFlow\((\w+UiState)\(""").findAll(src) +
                Regex("""val\s+(\w+)\s*:\s*[\w.]*StateFlow<(\w+UiState)>""").findAll(src))
            .associate { it.groupValues[1] to it.groupValues[2] }
    }

    /**
     * Dasselbe für JEDES ViewModel: Klasse → (öffentlicher Flussname → Typ).
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#fluessejeviewmodel
     */
    fun fluesseJeViewModel(): Map<String, Map<String, String>> {
        val ergebnis = mutableMapOf<String, Map<String, String>>()
        val erbt = mutableListOf<String>()
        for (datei in alle().filter { it.name.endsWith("ViewModel.kt") }) {
            val src = ohneKommentare(datei.readText())
            val klasse = Regex("""class (\w+ViewModel)""").find(src)?.groupValues?.get(1) ?: continue
            // privater Feldname (ohne Unterstrich) → UiState-Klasse
            val privat = Regex("""(_\w+)\s*=\s*MutableStateFlow\((\w+UiState)\(""")
                .findAll(src).associate { it.groupValues[1] to it.groupValues[2] }
            val namen = mutableMapOf<String, String>()
            privat.forEach { (feld, typ) -> namen[feld.removePrefix("_")] = typ }
            Regex("""\bval\s+(\w+)\s*=\s*(_\w+)\.asStateFlow\(\)""").findAll(src).forEach { m ->
                privat[m.groupValues[2]]?.let { namen[m.groupValues[1]] = it }
            }
            // Mit Typ ausgeschrieben, z. B. `val partsState: StateFlow<PartsUiState> = teile.state`.
            Regex("""\bval\s+(\w+)\s*:\s*[\w.]*StateFlow<(\w+UiState)>""").findAll(src).forEach { m ->
                namen[m.groupValues[1]] = m.groupValues[2]
            }
            // Was die Grundlage der Bereiche anbietet, haben alle Bereiche.
            if (src.contains(": BereichsViewModel(")) erbt += klasse
            ergebnis[klasse] = namen
        }
        val grundlage = ergebnis["BereichsViewModel"].orEmpty()
        for (k in erbt) ergebnis[k] = grundlage + ergebnis.getValue(k)
        return ergebnis
    }

    /**
     * Welcher Name in dieser Datei hält welches ViewModel?
     *
     * Aus Parametern (`katalog: CatalogViewModel`) und aus dem Einhängen
     * (`val mon: MonitoringViewModel = hiltViewModel()`).
     */
    fun viewModelNamen(quelle: String): Map<String, String> {
        val sauber = ohneKommentare(quelle)
        val namen = mutableMapOf<String, String>()
        Regex("""\b(\w+)\s*:\s*(?:[\w.]*\.)?(\w+ViewModel)\b""").findAll(sauber).forEach {
            namen[it.groupValues[1]] = it.groupValues[2]
        }
        return namen
    }

    /**
     * Was bietet eine `…UiState`-Datenklasse an — Felder UND abgeleitete
     * Mitglieder?
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#mitgliederjeuistate
     */
    fun mitgliederJeUiState(): Map<String, Set<String>> {
        val quelle = zustaende()
        val namen = Regex("""val\s+(\w+)\s*[:=]""")
        val methoden = Regex("""fun\s+(\w+)\s*\(""")
        return Regex("""data class (\w+UiState)\((.*?)\n\)(?: \{(.*?)\n\})?""",
                     RegexOption.DOT_MATCHES_ALL)
            .findAll(quelle)
            .associate { m ->
                val rumpf = m.groupValues[3]
                m.groupValues[1] to (namen.findAll(m.groupValues[2]) +
                                     namen.findAll(rumpf) +
                                     methoden.findAll(rumpf))
                    .map { it.groupValues[1] }.toSet()
            }
    }

    /**
     * Welchen Zustandstyp trägt ein Name in DIESER Datei?
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#zustandsnamen
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
        // Und dasselbe für jeden anderen Empfänger: `val state by katalog.state
        // .collectAsStateWithLifecycle()`. Welchen Typ das trägt, verrät die
        // Klasse hinter `katalog` — nicht der Name `state`.
        val vms = viewModelNamen(sauber)
        val jeVm = fluesseJeViewModel()
        Regex("""\bval\s+(\w+)\s+by\s+(\w+)\.(\w+)\.collectAsStateWithLifecycle""")
            .findAll(sauber).forEach { m ->
                val klasse = vms[m.groupValues[2]] ?: return@forEach
                jeVm[klasse]?.get(m.groupValues[3])?.let { namen[m.groupValues[1]] = it }
            }
        return namen
    }

    /**
     * Ein Ausschnitt ab dem ersten Vorkommen von [ab], gemessen in ZEILEN.
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#fenster
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
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#funktion
     */
    fun funktion(quelle: String, signatur: String): String {
        val sauber = ohneKommentare(quelle)
        val i = sauber.indexOf(signatur)
        if (i < 0) return ""
        val rest = sauber.substring(i).lines()
        // Einrückung der SIGNATURZEILE — nicht der Abstand der Fundstelle zum
        // Zeilenanfang. Bei `internal fun AppViewModel.x(` liegt zwischen
        // beidem das Wort `internal`, und der Abstand ergäbe neun Leerzeichen
        // Einzug für eine Funktion, die auf Spalte 0 steht. Ende nie gefunden,
        // Fenster wieder viel zu weit.
        val zeilenBeginn = sauber.lastIndexOf('\n', i) + 1
        val einzug = sauber.substring(zeilenBeginn).takeWhile { it == ' ' }
        val ende = rest.drop(1).indexOfFirst { it == "$einzug}" }
        return if (ende < 0) rest.joinToString("\n") else rest.take(ende + 2).joinToString("\n")
    }

    /**
     * Ein Kamerabildschirm samt allem, was zu seiner Kamera gehört.
     * Ausführlich: docs/begruendungen/core-testing/Quellen.kt.md#kameraquelle
     */
    fun kameraQuelle(rel: String): String = buildString {
        append(lies(rel))
        if (rel.endsWith("BarcodeScannerScreen.kt")) {
            append("\n"); append(lies("ui/screens/BarcodeAnalyzer.kt"))
        }
        append("\n"); append(lies("ui/screens/KameraAufbau.kt"))
    }
}
