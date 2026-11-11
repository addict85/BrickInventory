package ch.brickinventoryapp.testing

import java.io.File

/**
 * Gemeinsame Pfade und Schnitte für Strukturprüfungen (Modulgrenzen, Manifest, Build,
 * Verbote). Verhalten prüft ein Test, indem er den Code ausführt, nicht hier.
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
     * Der Android-Workflow, ohne Kommentarzeilen: Ein Kommentar, der eine alte Schreibweise
     * erklärt, nennt sie und wäre sonst selbst ein Fund. Der Pfad gilt, weil Gradle die
     * Tests aus dem Modulordner startet.
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
     * Die Galerie, nach Abschnitten auf Geschwisterdateien verteilt: Eine Regel des
     * Bildschirms gilt für alle, gleich in welcher Datei der Abschnitt gerade steht.
     */
    fun galerie(): String = listOf("GalleryScreen.kt", "GalerieFilter.kt", "GalerieKarte.kt", "GalerieErfassen.kt")
        .joinToString("\n") { lies("sammlung/ui/screens/$it") }

    /** Bildschirme, die wie die Galerie auf Geschwisterdateien verteilt sind, mit ihren Teilen. */
    private val verteilt = mapOf(
        "teile/ui/screens/PartsScreen.kt" to listOf("TeileFilterBlatt.kt", "TeileKarte.kt"),
        "teile/ui/screens/MinifigsScreen.kt" to listOf("FigurenKarte.kt", "FigurenErfassen.kt"),
        "teile/ui/screens/PartsListScreen.kt" to listOf("BaulisteZeilen.kt"),
        "katalog/ui/screens/CatalogScreen.kt" to listOf("KatalogScrubber.kt", "KatalogKarte.kt"),
        "sammlung/ui/screens/MerklisteScreen.kt" to listOf("MerklisteDialoge.kt", "MerklisteZeile.kt"),
        "finanzen/ui/screens/GutscheineCard.kt" to listOf("GutscheinFormular.kt", "GutscheinKarte.kt"),
        "finanzen/ui/screens/PdfViewerScreen.kt" to listOf("PdfSeiten.kt"),
        "anmeldung/ui/screens/LoginScreen.kt" to listOf("LoginAnmelden.kt", "LoginRegistrieren.kt"),
        "anmeldung/ui/screens/SetupScreen.kt" to listOf("SetupQr.kt"),
    )

    /** Die Pfade eines Bildschirms samt seinen Teilen; für einen unverteilten nur er selbst. */
    fun bildschirmDateien(rel: String): List<String> =
        listOf(rel) + verteilt[rel].orEmpty().map { rel.substringBeforeLast('/') + "/" + it }

    /**
     * Ein Bildschirm samt seinen Teilen als ein Text: Eine Regel des ganzen Bildschirms
     * gilt für alle Teile, gleich in welcher Datei ein Abschnitt gerade steht.
     */
    fun bildschirm(rel: String): String = bildschirmDateien(rel).joinToString("\n") { lies(it) }

    /**
     * Das Hilt-Modul samt Netz: AppModule, NetzModule und der gemeinsame
     * Interceptor (ServerClient) liegen getrennt in den di/-Ordnern der Module; wer eine Regel des
     * Netzwegs prüft, liest alle drei.
     */
    fun di(): String {
        val dateien = alle().filter { it.parentFile?.name == "di" }.sortedBy { it.name }
        check(dateien.size >= 3) { "Nur ${dateien.size} Dateien in */di/ gefunden" }
        return dateien.joinToString("\n") { it.readText() }
    }

    /**
     * Alle Zustandsklassen: Sie liegen je Bereich in <stamm>/ui/Zustand*.kt. Mit
     * Untergrenze, sonst prüfte ein umbenannter Ordner nichts und wäre grün.
     */
    fun zustaende(): String {
        val dateien = alle().filter { it.parentFile?.name == "ui" && it.name.startsWith("Zustand") }
            .sortedBy { it.name }
        check(dateien.size >= 5) { "Nur ${dateien.size} Zustandsdateien in */ui/ gefunden" }
        return dateien.joinToString("\n") { it.readText() }
    }

    /**
     * Alle Kotlin-Quelldateien des Hauptbaums, mit Untergrenze: Fände ein falscher Pfad
     * nichts, bestünde jede Sammelprüfung darauf grün, ohne etwas geprüft zu haben.
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
     * Alle Quelldateien unterhalb eines Unterordners, z. B. `"ui/screens"`. Verglichen über
     * invariantSeparatorsPath, weil `path` unter Windows Backslashes liefert und dann nichts fände.
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
     * Kommentare und Zeichenketten durch Leerzeichen ersetzt, Zeilen und Spalten
     * bleiben: Ein Fund zeigt so auf die echte Stelle, und ein Dateiname in einem
     * Text ist kein Aufruf.
     */
    fun entkleide(src: String): String {
        val out = StringBuilder(src.length)
        var i = 0
        while (i < src.length) {
            val ende = endeVonKommentarOderText(src, i)
            if (ende == i) out.append(src[i++])
            else { for (c in src.substring(i, ende)) out.append(if (c == '\n') '\n' else ' '); i = ende }
        }
        return out.toString()
    }

    /** Wo ein Kommentar oder eine Zeichenkette ab [i] endet; [i], wenn dort keine beginnt. */
    private fun endeVonKommentarOderText(src: String, i: Int): Int = when {
        src.startsWith("//", i) -> src.indexOf('\n', i).let { if (it < 0) src.length else it }
        src.startsWith("/*", i) -> src.indexOf("*/", i + 2).let { if (it < 0) src.length else it + 2 }
        src.startsWith("\"\"\"", i) -> src.indexOf("\"\"\"", i + 3).let { if (it < 0) src.length else it + 3 }
        src[i] == '"' -> endeDerZeichenkette(src, i)
        else -> i
    }

    private fun endeDerZeichenkette(src: String, i: Int): Int {
        var j = i + 1
        while (j < src.length && src[j] != '"') j += if (src[j] == '\\') 2 else 1
        return minOf(j + 1, src.length)
    }

    /**
     * Kommentare ausblenden, zeilenweise: Kotlin verschachtelt Blockkommentare, und ein
     * Muster über die ganze Datei verschluckte ab einem Sternchen nach einem Schrägstrich
     * in einem Kommentar den Rest.
     */
    fun ohneKommentare(quelle: String): String = quelle.lines().joinToString("\n") { zeile ->
        val t = zeile.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else zeile
    }

    /**
     * Ein Ausschnitt ab dem ersten Vorkommen von [ab], gemessen in Zeilen ohne Kommentare:
     * Ein Absatz Erklärung mehr über der Fundstelle verschiebt so nichts.
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
     */
    fun funktion(quelle: String, signatur: String): String {
        val sauber = ohneKommentare(quelle)
        val i = sauber.indexOf(signatur)
        if (i < 0) return ""
        val rest = sauber.substring(i).lines()
        // Einrückung der Signaturzeile, nicht der Fundstelle: Vor `fun` kann `internal` stehen.
        val zeilenBeginn = sauber.lastIndexOf('\n', i) + 1
        val einzug = sauber.substring(zeilenBeginn).takeWhile { it == ' ' }
        val ende = rest.drop(1).indexOfFirst { it == "$einzug}" }
        return if (ende < 0) rest.joinToString("\n") else rest.take(ende + 2).joinToString("\n")
    }

    /**
     * Ein Kamerabildschirm samt allem, was zu seiner Kamera gehört: Die Kamera besteht aus
     * mehreren Dateien, und wer nur eine liest, findet die halbe Regel.
     */
    fun kameraQuelle(rel: String): String = buildString {
        append(bildschirm(rel))
        if (rel.endsWith("BarcodeScannerScreen.kt")) {
            append("\n"); append(lies("sammlung/ui/screens/BarcodeAnalyzer.kt"))
        }
        append("\n"); append(lies("ui/screens/KameraAufbau.kt"))
    }
}
